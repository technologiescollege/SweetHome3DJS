/*
 * Public Scratchomised plugin façade for electroBlockly (and other embeds).
 *
 * After installScratchomisedPlugin(), callers use:
 *   window.SweetHome3DJS.plugins.scratchomised
 *   window.SweetHome3DJS.scratchomised          // shortcut
 *
 * Typical electroBlockly flow:
 *   1. plugin.start()                         // open bridge (or use the toolbar)
 *   2. plugin.getFurnitureMenuItems({kind})   // fill Blockly dropdowns
 *   3. plugin.setProperty(id, "power", 0.5)   // drive Home from blocks
 *   4. plugin.on("furniture", cb)             // react to Home changes
 */

import { ensureScratchomisedHost, getScratchomisedHost } from "./ScratchomisedHost.js";
import { listSerializedFurniture } from "./furnitureSerializer.js";
import { statusText } from "./i18n.js";

export const SCRATCHOMISED_PLUGIN_ID = "scratchomised";
export const SCRATCHOMISED_PLUGIN_VERSION = "1.0.0";

/** Default bridge port (must match scripts/scratchomised-bridge.mjs). */
export const SCRATCHOMISED_DEFAULT_PORT = 55125;

/** @type {import('../UserPreferences/UserPreferences.js').UserPreferences|null} */
let cachedPreferences = null;

/**
 * @typedef {object} ScratchomisedFurniture
 * @property {string|null} id
 * @property {string|null} name
 * @property {string|null} catalogId
 * @property {string} label
 * @property {string} exportEntry  "id|name(description)" for Scratch / Blockly menus
 * @property {string[]} kinds  e.g. ["furniture","light"]
 * @property {number|null} [x]
 * @property {number|null} [y]
 * @property {number|null} [color]
 * @property {number|null} [power]
 */

/** @returns {import('./ScratchomisedHost.js').ScratchomisedHost|null} */
function host() {
  return getScratchomisedHost();
}

/** @returns {ScratchomisedFurniture[]} */
function getFurniture() {
  const h = host();
  return h ? h.getFurniture() : [];
}

/**
 * Find one furniture entry by id, label, name, or "id|label" export entry.
 * @param {string} objectId
 * @returns {ScratchomisedFurniture|null}
 */
function getFurnitureById(objectId) {
  const raw = String(objectId == null ? "" : objectId);
  let id = raw;
  let label = raw;
  const pipe = raw.indexOf("|");
  if (pipe >= 0) {
    id = raw.slice(0, pipe);
    label = raw.slice(pipe + 1);
  }
  const list = getFurniture();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.id === id
        || item.id === raw
        || item.label === label
        || item.label === raw
        || item.exportEntry === raw
        || item.name === raw) {
      return item;
    }
  }
  return null;
}

/**
 * Set a property on a Home piece (same semantics as Scratch define_property).
 * @param {string} objectId
 * @param {string} property
 * @param {*} value
 * @returns {boolean}
 */
function setProperty(objectId, property, value) {
  const h = host();
  if (!h || !h.home) {
    return false;
  }
  try {
    return h.defineProperty({ object: objectId, property, value });
  } catch (err) {
    console.warn("[Scratchomised] setProperty failed", err);
    return false;
  }
}

/**
 * Read a property from the last serialized furniture snapshot.
 * @param {string} objectId
 * @param {string} property
 * @returns {*}
 */
function getProperty(objectId, property) {
  const item = getFurnitureById(objectId);
  return item ? item[property] : undefined;
}

/**
 * Subscribe to host events (`furniture`, `connection`, or `*` for all).
 * @param {'furniture'|'connection'|string} event
 * @param {(detail: object) => void} callback
 * @returns {() => void} unsubscribe
 */
function on(event, callback) {
  if (typeof callback !== "function") {
    return () => undefined;
  }
  const h = host();
  if (h) {
    const wrapped = (ev) => {
      if (!event || ev.type === event || event === "*") {
        callback(ev);
      }
    };
    h.addChangeListener(wrapped);
    return () => h.removeChangeListener(wrapped);
  }
  // Host not ready yet — fall back to the window CustomEvent bus.
  const listener = (ce) => {
    const detail = ce && ce.detail ? ce.detail : {};
    if (!event || detail.type === event || event === "*") {
      callback(detail);
    }
  };
  window.addEventListener("sweethome3d:scratchomised", listener);
  return () => window.removeEventListener("sweethome3d:scratchomised", listener);
}

function start() {
  const h = host();
  if (!h) {
    return false;
  }
  h.connect();
  return true;
}

function stop() {
  const h = host();
  if (!h) {
    return false;
  }
  h.disconnect();
  return true;
}

function isActive() {
  const h = host();
  return !!(h && h.isActive());
}

function isConnected() {
  const h = host();
  return !!(h && h.isConnected());
}

/**
 * @param {import('../UserPreferences/UserPreferences.js').UserPreferences|null|undefined} [preferences]
 * @returns {string}
 */
function getStatus(preferences) {
  return statusText(preferences ?? cachedPreferences, host());
}

/**
 * Dropdown entries for Blockly / Scratch object menus.
 * @param {{ kind?: string }} [filter]  e.g. { kind: "light" }
 * @returns {{ text: string, value: string }[]}
 */
function getFurnitureMenuItems(filter) {
  const kind = filter && filter.kind ? String(filter.kind) : null;
  return getFurniture()
    .filter((item) => !kind || (item.kinds && item.kinds.indexOf(kind) !== -1))
    .map((item) => ({
      text: item.name || item.label || String(item.id),
      value: item.exportEntry || item.id,
    }));
}

/**
 * Install / refresh the global plugin handle.
 *
 * @param {import('../SweetHome3D').Home} [home]
 * @param {{ autoConnect?: boolean, url?: string, preferences?: import('../UserPreferences/UserPreferences.js').UserPreferences }} [options]
 * @returns {object} the plugin API object
 */
export function installScratchomisedPlugin(home, options) {
  if (options && options.preferences) {
    cachedPreferences = options.preferences;
  }
  if (home) {
    ensureScratchomisedHost(home, { autoConnect: false, ...options });
  }

  const api = {
    id: SCRATCHOMISED_PLUGIN_ID,
    name: "Scratchomised",
    version: SCRATCHOMISED_PLUGIN_VERSION,
    defaultPort: SCRATCHOMISED_DEFAULT_PORT,
    start,
    stop,
    isActive,
    isConnected,
    getStatus,
    getFurniture,
    getFurnitureById,
    setProperty,
    getProperty,
    on,
    getFurnitureMenuItems,
  };

  const root = typeof window !== "undefined" ? window : globalThis;
  root.SweetHome3DJS = root.SweetHome3DJS || {};
  root.SweetHome3DJS.plugins = root.SweetHome3DJS.plugins || {};
  root.SweetHome3DJS.plugins.scratchomised = api;
  root.SweetHome3DJS.scratchomised = api;

  return api;
}

export {
  getFurniture,
  getFurnitureById,
  setProperty,
  getProperty,
  listSerializedFurniture,
  start,
  stop,
  isActive,
  isConnected,
  on,
  getFurnitureMenuItems,
};
