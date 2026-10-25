/*
 * Scratchomised host client (browser side).
 *
 * Connects to the local Node WebSocket bridge (scripts/scratchomised-bridge.mjs)
 * with subprotocol "scratchomised-host", then:
 *   - receives define_property / client_ready from Scratch
 *   - pushes update_objects / update_observer_position to Scratch
 *
 * Furniture listeners stay attached even when the bridge is stopped so that
 * electroBlockly (window.SweetHome3DJS.plugins.scratchomised) still sees a
 * live furniture list.
 *
 * Protocol: compatible with https://github.com/LyceeLivet/Scratchomised (MIT).
 */

import { CollectionEvent, HomeLight, HomePieceOfFurniture } from "../SweetHome3D";
import { furnitureIdentity, listSerializedFurniture } from "./furnitureSerializer.js";
import { statusText as scratchomisedStatusText } from "./i18n.js";

const DEFAULT_URL = "ws://127.0.0.1:55125";
const HOST_PROTOCOL = "scratchomised-host";
const LOG_PREFIX = "[Scratchomised] ";
const RECONNECT_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} propertyName
 * @returns {string}
 */
function setterName(propertyName) {
  return "set" + propertyName.charAt(0).toUpperCase() + propertyName.slice(1);
}

/**
 * Coerce a Scratch string value to a JS type suitable for a SH3D setter.
 *
 * @param {*} valueStr
 * @param {'int'|'float'|'boolean'|'string'|'nullable-int'|'nullable-float'} kind
 * @returns {*}
 */
function coerceValue(valueStr, kind) {
  if (valueStr == null) {
    return null;
  }
  const raw = String(valueStr);
  if (raw === "" || raw.toLowerCase() === "null") {
    if (kind === "nullable-int" || kind === "nullable-float" || kind === "string") {
      return null;
    }
    throw new Error("Cannot set null for " + kind);
  }
  if (kind === "int" || kind === "nullable-int") {
    if (/^0x/i.test(raw) || raw.startsWith("#")) {
      return parseInt(raw.replace(/^0x/i, "").replace(/^#/, ""), 16);
    }
    return parseInt(raw, 10);
  }
  if (kind === "float" || kind === "nullable-float") {
    return parseFloat(raw);
  }
  if (kind === "boolean") {
    return raw === true || raw === "true" || raw === "1";
  }
  return raw;
}

/**
 * Parse Scratch's "id|label" object token into id and label parts.
 * @param {*} objectToken
 * @returns {{ raw: string, id: string, label: string }}
 */
function parseObjectToken(objectToken) {
  const raw = String(objectToken == null ? "" : objectToken);
  const pipeIdx = raw.indexOf("|");
  if (pipeIdx < 0) {
    return { raw, id: raw, label: raw };
  }
  return {
    raw,
    id: raw.substring(0, pipeIdx),
    label: raw.substring(pipeIdx + 1),
  };
}

/**
 * True if a Home piece matches a Scratch object token (id, label, or id|label).
 * @param {*} piece
 * @param {{ raw: string, id: string, label: string }} token
 * @returns {boolean}
 */
function pieceMatchesToken(piece, token) {
  const identity = furnitureIdentity(piece);
  return token.id === identity.id
    || token.raw === identity.id
    || token.label === identity.label
    || token.raw === identity.label
    || token.raw === identity.exportEntry;
}

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

/**
 * Browser-side Scratchomised host bound to one Home model.
 */
export class ScratchomisedHost {
  /**
   * @param {import('../SweetHome3D').Home} home
   * @param {{ url?: string, autoConnect?: boolean }} [options]
   */
  constructor(home, options = {}) {
    this.home = home;
    this.url = options.url || DEFAULT_URL;

    /** @type {WebSocket|null} */
    this.socket = null;
    /** Scratch sent client_ready / welcome_ack — objects may be pushed. */
    this.clientReady = false;

    /** @private @type {ReturnType<typeof setTimeout>|null} */
    this._reconnectTimer = null;
    /** User asked to stay connected (reconnect until disconnect()). */
    this._wanted = false;

    /** @type {Set<(ev: { type: string, furniture?: object[], connected?: boolean }) => void>} */
    this._listeners = new Set();
    /** @type {Set<*>} pieces with a property-change listener attached */
    this._boundPieces = new Set();

    this._furnitureListener = (ev) => this._onFurnitureCollection(ev);
    this._propertyListener = () => this._onPiecePropertyChanged();
    this._observerListener = (ev) => this._onObserverMoved(ev);

    // Always watch furniture so the public API stays up to date when stopped.
    this._attachHomeListeners();

    if (options.autoConnect === true) {
      this.connect();
    }
  }

  // ---- Public state -------------------------------------------------------

  /** @returns {boolean} WebSocket is OPEN */
  isConnected() {
    return !!(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  /**
   * True while the user wants the bridge on (connected or reconnecting).
   * Used by the toolbar to show the "stop" / active icon.
   * @returns {boolean}
   */
  isActive() {
    return this._wanted || this.isConnected();
  }

  /**
   * True if connect() was called and disconnect() has not been called since.
   * @returns {boolean}
   */
  wantsConnection() {
    return this._wanted;
  }

  /**
   * Furniture snapshot for Scratch menus / electroBlockly.
   * @returns {object[]}
   */
  getFurniture() {
    return listSerializedFurniture(this.home);
  }

  /**
   * @param {import('../UserPreferences/UserPreferences.js').UserPreferences|null|undefined} [preferences]
   * @returns {string}
   */
  getStatusText(preferences) {
    return scratchomisedStatusText(preferences, this);
  }

  // ---- Connection ---------------------------------------------------------

  /** Open (or keep) the WebSocket to the local bridge. */
  connect() {
    this._wanted = true;
    if (this.socket &&
        (this.socket.readyState === WebSocket.OPEN ||
         this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this._clearReconnect();
    try {
      this.socket = new WebSocket(this.url, HOST_PROTOCOL);
    } catch (err) {
      console.warn(LOG_PREFIX + "WebSocket create failed:", err);
      this._scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      console.info(LOG_PREFIX + "host connected to " + this.url);
      this._attachHomeListeners();
      this._emit({ type: "connection", connected: true, furniture: this.getFurniture() });
    });

    this.socket.addEventListener("message", (ev) => {
      this._onMessage(ev.data);
    });

    this.socket.addEventListener("close", () => {
      console.info(LOG_PREFIX + "host disconnected");
      this.clientReady = false;
      // Keep furniture listeners so electroBlockly still receives updates.
      this._emit({ type: "connection", connected: false, furniture: this.getFurniture() });
      if (this._wanted) {
        this._scheduleReconnect();
      }
    });

    this.socket.addEventListener("error", () => {
      // A close event follows; reconnect is handled there.
    });
  }

  /** Close the WebSocket and stop auto-reconnect. */
  disconnect() {
    this._wanted = false;
    this._clearReconnect();
    this.clientReady = false;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (_) {
        /* ignore */
      }
      this.socket = null;
    }
    this._emit({ type: "connection", connected: false, furniture: this.getFurniture() });
  }

  /**
   * Rebind to another Home (e.g. after File → Open).
   * @param {import('../SweetHome3D').Home} home
   */
  setHome(home) {
    this._detachHomeListeners();
    this.home = home;
    this._attachHomeListeners();
    this._emit({ type: "furniture", furniture: this.getFurniture(), connected: this.isConnected() });
    if (this.isConnected() && this.clientReady) {
      this.sendUpdateObjects();
    }
  }

  // ---- Change listeners (UI + electroBlockly) -----------------------------

  /**
   * @param {(ev: { type: string, furniture?: object[], connected?: boolean }) => void} listener
   */
  addChangeListener(listener) {
    if (typeof listener === "function") {
      this._listeners.add(listener);
    }
  }

  /**
   * @param {(ev: { type: string, furniture?: object[], connected?: boolean }) => void} listener
   */
  removeChangeListener(listener) {
    this._listeners.delete(listener);
  }

  /**
   * @param {{ type: string, furniture?: object[], connected?: boolean }} ev
   * @private
   */
  _emit(ev) {
    for (const listener of this._listeners) {
      try {
        listener(ev);
      } catch (err) {
        console.warn(LOG_PREFIX + "listener error", err);
      }
    }
    try {
      window.dispatchEvent(new CustomEvent("sweethome3d:scratchomised", { detail: ev }));
    } catch (_) {
      /* ignore (non-browser) */
    }
  }

  // ---- Home model listeners -----------------------------------------------

  /** @private */
  _scheduleReconnect() {
    this._clearReconnect();
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._wanted) {
        this.connect();
      }
    }, RECONNECT_DELAY_MS);
  }

  /** @private */
  _clearReconnect() {
    if (this._reconnectTimer != null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }

  /** @private */
  _attachHomeListeners() {
    if (!this.home) {
      return;
    }
    try {
      this.home.addFurnitureListener(this._furnitureListener);
    } catch (err) {
      console.warn(LOG_PREFIX + "addFurnitureListener failed", err);
    }
    const furniture = this.home.getFurniture() || [];
    for (let i = 0; i < furniture.length; i++) {
      this._watchPiece(furniture[i]);
    }
    const observer = this.home.getObserverCamera && this.home.getObserverCamera();
    if (observer && observer.addPropertyChangeListener) {
      try {
        observer.addPropertyChangeListener("X", this._observerListener);
        observer.addPropertyChangeListener("Y", this._observerListener);
        observer.addPropertyChangeListener("YAW", this._observerListener);
      } catch (_) {
        /* ignore */
      }
    }
  }

  /** @private */
  _detachHomeListeners() {
    if (this.home) {
      try {
        this.home.removeFurnitureListener(this._furnitureListener);
      } catch (_) {
        /* ignore */
      }
      const observer = this.home.getObserverCamera && this.home.getObserverCamera();
      if (observer && observer.removePropertyChangeListener) {
        try {
          observer.removePropertyChangeListener("X", this._observerListener);
          observer.removePropertyChangeListener("Y", this._observerListener);
          observer.removePropertyChangeListener("YAW", this._observerListener);
        } catch (_) {
          /* ignore */
        }
      }
    }
    for (const piece of this._boundPieces) {
      try {
        piece.removePropertyChangeListener(this._propertyListener);
      } catch (_) {
        /* ignore */
      }
    }
    this._boundPieces.clear();
  }

  /** @private */
  _watchPiece(piece) {
    if (!piece || this._boundPieces.has(piece)) {
      return;
    }
    try {
      piece.addPropertyChangeListener(this._propertyListener);
      this._boundPieces.add(piece);
    } catch (_) {
      /* ignore */
    }
  }

  /** @private */
  _onFurnitureCollection(ev) {
    try {
      if (ev && ev.getType && ev.getType() === CollectionEvent.Type.ADD && ev.getItem) {
        this._watchPiece(ev.getItem());
      }
    } catch (_) {
      /* ignore */
    }
    this._emit({ type: "furniture", furniture: this.getFurniture(), connected: this.isConnected() });
    if (this.clientReady) {
      this.sendUpdateObjects();
    }
  }

  /** @private */
  _onPiecePropertyChanged() {
    this._emit({ type: "furniture", furniture: this.getFurniture(), connected: this.isConnected() });
    if (this.clientReady) {
      this.sendUpdateObjects();
    }
  }

  /** @private */
  _onObserverMoved(ev) {
    if (!this.clientReady) {
      return;
    }
    const name = ev && ev.getPropertyName ? ev.getPropertyName() : null;
    if (name === "X" || name === "Y" || name === "YAW") {
      this.sendObserverPosition();
    }
  }

  // ---- Protocol (incoming) ------------------------------------------------

  /** @private */
  _onMessage(raw) {
    let request;
    try {
      request = JSON.parse(raw);
    } catch (_) {
      console.warn(LOG_PREFIX + "bad JSON:", String(raw).slice(0, 120));
      return;
    }
    if (!request || !request.action) {
      return;
    }
    const args = request.args || {};
    switch (request.action) {
      case "client_ready":
        this.clientReady = true;
        this.sendUpdateObjects();
        break;
      case "test_ack":
        break;
      case "welcome_ack":
        // Scratch was already connected before this host; treat as ready.
        this.clientReady = true;
        this.sendUpdateObjects();
        break;
      case "define_property":
        this.defineProperty(args);
        break;
      default:
        // Host ignores Scratch-only / unknown actions.
        break;
    }
  }

  /**
   * Apply a property change requested by Scratch or by the public plugin API.
   * Object token may be id, "name(description)", or "id|name(description)".
   *
   * @param {{ object?: *, property?: *, value?: * }} args
   * @returns {boolean} true if a matching piece was updated
   */
  defineProperty(args) {
    if (!this.home || !args) {
      return false;
    }
    const token = parseObjectToken(args.object);
    const furniture = this.home.getFurniture() || [];

    for (let i = 0; i < furniture.length; i++) {
      const piece = furniture[i];
      if (!(piece instanceof HomePieceOfFurniture) && !(piece && piece.getId)) {
        continue;
      }
      if (!pieceMatchesToken(piece, token)) {
        continue;
      }
      const propertyName = String(args.property == null ? "" : args.property);
      try {
        this.applyProperty(piece, propertyName, args.value);
        this.sendUpdateObjects();
        return true;
      } catch (err) {
        console.warn(LOG_PREFIX + "define_property failed:", err && err.message ? err.message : err);
        return false;
      }
    }
    console.warn(LOG_PREFIX + "no furniture matched object '" + token.raw + "'");
    return false;
  }

  /**
   * Call the SH3D setter for `propertyName` after typed coercion.
   *
   * @param {*} piece
   * @param {string} propertyName
   * @param {*} valueStr
   */
  applyProperty(piece, propertyName, valueStr) {
    const method = setterName(propertyName);
    if (typeof piece[method] !== "function") {
      throw new Error("No setter " + method);
    }

    let value;
    switch (propertyName) {
      case "x":
      case "y":
      case "elevation":
      case "angle":
      case "width":
      case "depth":
      case "height":
      case "shininess":
      case "power":
        value = coerceValue(valueStr, propertyName === "shininess" ? "nullable-float" : "float");
        break;
      case "color":
      case "lightColor":
        value = coerceValue(valueStr, "nullable-int");
        break;
      case "visible":
      case "modelMirrored":
      case "movable":
      case "doorOrWindow":
        value = coerceValue(valueStr, "boolean");
        break;
      case "name":
      case "description":
      case "information":
        value = coerceValue(valueStr, "string");
        break;
      default: {
        // Unknown property: best-effort parse (null → bool → int/hex → float → string).
        const raw = String(valueStr);
        if (raw.toLowerCase() === "null" || raw === "") {
          value = null;
        } else if (raw === "true" || raw === "false") {
          value = raw === "true";
        } else if (/^0x|^#/i.test(raw) || /^-?\d+$/.test(raw)) {
          value = coerceValue(raw, "nullable-int");
        } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
          value = coerceValue(raw, "float");
        } else {
          value = raw;
        }
        break;
      }
    }

    if (propertyName === "power" && !(piece instanceof HomeLight) && typeof piece.setPower !== "function") {
      throw new Error("power only on HomeLight");
    }
    piece[method](value);
  }

  // ---- Protocol (outgoing) ------------------------------------------------

  /**
   * @param {string} action
   * @param {object} [args]
   * @private
   */
  _send(action, args = {}) {
    if (!this.isConnected()) {
      return;
    }
    try {
      this.socket.send(JSON.stringify({ action, args }));
    } catch (err) {
      console.warn(LOG_PREFIX + "send failed:", err);
    }
  }

  /** Push the full furniture list (+ observer pose) to Scratch. */
  sendUpdateObjects() {
    if (!this.home || !this.isConnected()) {
      return;
    }
    /** @type {Record<string, any>} */
    const args = { objects: listSerializedFurniture(this.home) };
    const observer = this.home.getObserverCamera && this.home.getObserverCamera();
    if (observer) {
      Object.assign(args, this._observerArgs(observer));
    }
    this._send("update_objects", args);
  }

  /** Push only the virtual visitor pose. */
  sendObserverPosition() {
    if (!this.home || !this.isConnected()) {
      return;
    }
    const observer = this.home.getObserverCamera && this.home.getObserverCamera();
    if (!observer) {
      return;
    }
    this._send("update_observer_position", this._observerArgs(observer));
  }

  /**
   * Map observer camera to Scratch SVG coordinates
   * (same defaults as the Java plugin when no export ran).
   *
   * @param {*} observerCamera
   * @returns {object}
   * @private
   */
  _observerArgs(observerCamera) {
    const svgWidth = 480;
    const svgHeight = 360;
    const offsetX = 200;
    const offsetY = 60;
    const scale = Math.min(480 / svgWidth, 360 / svgHeight);
    const padX = (480 - svgWidth * scale) / 2;
    const padY = (360 - svgHeight * scale) / 2;
    const x = observerCamera.getX();
    const y = observerCamera.getY();
    const yaw = observerCamera.getYaw();
    return {
      observerX: -240 + padX + (x + offsetX) * scale,
      observerY: 180 - (padY + (y + offsetY) * scale),
      observerDirection: (yaw * 180 / Math.PI) - 90,
      svgWidth,
      svgHeight,
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton (one host per page)
// ---------------------------------------------------------------------------

/** @type {ScratchomisedHost | null} */
let sharedHost = null;

/**
 * Create or rebind the singleton host to `home`.
 *
 * @param {import('../SweetHome3D').Home} home
 * @param {{ url?: string, autoConnect?: boolean }} [options]
 * @returns {ScratchomisedHost}
 */
export function ensureScratchomisedHost(home, options) {
  if (sharedHost) {
    sharedHost.setHome(home);
    return sharedHost;
  }
  sharedHost = new ScratchomisedHost(home, options);
  return sharedHost;
}

/** @returns {ScratchomisedHost | null} */
export function getScratchomisedHost() {
  return sharedHost;
}
