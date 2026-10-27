/*
 * Scratchomised UI helpers for HomePane.
 *
 * Keeps toolbar actions, the start/stop toggle button, context-menu items and
 * status dialog out of HomePane.js so the bridge feature stays easy to find
 * and maintain. HomePane only calls the thin wrappers below.
 *
 * Layout of responsibilities:
 *   - ScratchomisedHost     → WebSocket protocol + Home mutations
 *   - ScratchomisedPlugin   → window.SweetHome3DJS.plugins.scratchomised API
 *   - ScratchomisedHomePane → toolbar / menus / messages (this file)
 *   - i18n.js               → localized strings (HomePane.* keys)
 */

import { AbstractAction } from "../graphics2d.js";
import { ResourceAction } from "../ResourceAction.js";
import { JSPopupMenu } from "../toolkit.js";
import { ZIPTools } from "../URLContent.js";
import { ensureScratchomisedHost, getScratchomisedHost } from "./ScratchomisedHost.js";
import { installScratchomisedPlugin } from "./ScratchomisedPlugin.js";
import { t, statusText } from "./i18n.js";

/** Relative icon paths (resolved via ZIPTools.getScriptFolder() → …/lib/). */
const ICON = {
  start: "resources/actions/scratchomised-start.svg",
  stop: "resources/actions/scratchomised-stop.svg",
};

/** Cache-bust query for toolbar SVGs (bump when icons change). */
const ICON_CACHE_VERSION = "4";

/** How many furniture lines to show in the status dialog. */
const STATUS_FURNITURE_PREVIEW_LIMIT = 8;

/**
 * Resolve a relative action icon to an absolute URL under the SH3D script folder.
 * @param {string|null|undefined} relativePath
 * @returns {string|null}
 */
function resolveActionIconUrl(relativePath) {
  if (!relativePath) {
    return null;
  }
  if (String(relativePath).indexOf("://") !== -1) {
    return relativePath;
  }
  return ZIPTools.getScriptFolder() + relativePath;
}

/**
 * Give an AbstractAction the getURL(key) helper used by toolbar / popup menus.
 * @param {AbstractAction} action
 */
function bindActionIconResolver(action) {
  action.getURL = (key) => resolveActionIconUrl(action.getValue(key));
}

/**
 * @param {*} homePane
 * @returns {import('./ScratchomisedHost.js').ScratchomisedHost|null}
 */
function resolveHost(homePane) {
  return getScratchomisedHost() || homePane.scratchomisedHost || null;
}

/**
 * Boot the host + public plugin API, then create toolbar actions.
 * Safe to call once from the HomePane constructor (errors are logged, not thrown).
 *
 * @param {*} homePane  HomePane instance (needs .home, .preferences, .showMessage)
 * @param {import('../SweetHome3D').Home} home
 * @returns {boolean} true if init succeeded
 */
export function initScratchomisedOnHomePane(homePane, home) {
  try {
    homePane.scratchomisedHost = ensureScratchomisedHost(home, { autoConnect: false });
    installScratchomisedPlugin(home, {
      autoConnect: false,
      preferences: homePane.preferences,
    });
    createScratchomisedActions(homePane);
    return true;
  } catch (err) {
    console.warn("[Scratchomised] host init failed", err);
    homePane.scratchomisedHost = null;
    return false;
  }
}

/**
 * Build Start / Stop AbstractActions, register them on the action map,
 * and keep labels in sync with the current language.
 *
 * @param {*} homePane
 */
export function createScratchomisedActions(homePane) {
  const startAction = new AbstractAction();
  startAction.putValue(AbstractAction.SMALL_ICON, ICON.start);
  startAction.putValue(ResourceAction.TOOL_BAR_ICON, ICON.start);
  startAction.putValue(ResourceAction.RESOURCE_PREFIX, "SCRATCHOMISED_START");
  bindActionIconResolver(startAction);
  startAction.actionPerformed = () => startBridge(homePane);

  const stopAction = new AbstractAction();
  stopAction.putValue(AbstractAction.SMALL_ICON, ICON.stop);
  stopAction.putValue(ResourceAction.TOOL_BAR_ICON, ICON.stop);
  stopAction.putValue(ResourceAction.RESOURCE_PREFIX, "SCRATCHOMISED_STOP");
  bindActionIconResolver(stopAction);
  stopAction.actionPerformed = () => stopBridge(homePane);

  homePane.scratchomisedStartAction = startAction;
  homePane.scratchomisedStopAction = stopAction;
  homePane.getActionMap()["SCRATCHOMISED_START"] = startAction;
  homePane.getActionMap()["SCRATCHOMISED_STOP"] = stopAction;

  localizeScratchomisedActions(homePane);
  ensureLanguageListener(homePane);
  ensureHostUiListener(homePane);
}

/**
 * Connect the bridge and refresh the toolbar button.
 * @param {*} homePane
 */
function startBridge(homePane) {
  const host = resolveHost(homePane);
  if (!host) {
    homePane.showMessage(t(homePane.preferences, "scratchomised.unavailable"));
    return;
  }
  host.setHome(homePane.home);
  installScratchomisedPlugin(homePane.home, { preferences: homePane.preferences });
  host.connect();
  refreshScratchomisedButton(homePane);
  homePane.showMessage(t(homePane.preferences, "scratchomised.started"));
}

/**
 * Disconnect the bridge and refresh the toolbar button.
 * @param {*} homePane
 */
function stopBridge(homePane) {
  const host = resolveHost(homePane);
  if (host) {
    host.disconnect();
  }
  refreshScratchomisedButton(homePane);
  homePane.showMessage(t(homePane.preferences, "scratchomised.stopped"));
}

/**
 * Apply Name / ShortDescription from localization*.json (or English fallbacks).
 * @param {*} homePane
 */
export function localizeScratchomisedActions(homePane) {
  const prefs = homePane.preferences;
  const start = homePane.scratchomisedStartAction;
  const stop = homePane.scratchomisedStopAction;
  if (start) {
    start.putValue(AbstractAction.NAME, t(prefs, "SCRATCHOMISED_START.Name"));
    start.putValue(AbstractAction.SHORT_DESCRIPTION, t(prefs, "SCRATCHOMISED_START.ShortDescription"));
  }
  if (stop) {
    stop.putValue(AbstractAction.NAME, t(prefs, "SCRATCHOMISED_STOP.Name"));
    stop.putValue(AbstractAction.SHORT_DESCRIPTION, t(prefs, "SCRATCHOMISED_STOP.ShortDescription"));
  }
}

/**
 * Re-localize toolbar tooltips when the user changes language.
 * @param {*} homePane
 */
function ensureLanguageListener(homePane) {
  if (homePane._scratchomisedLanguageListener) {
    return;
  }
  homePane._scratchomisedLanguageListener = () => {
    localizeScratchomisedActions(homePane);
    refreshScratchomisedButton(homePane);
  };
  if (homePane.preferences && typeof homePane.preferences.addPropertyChangeListener === "function") {
    homePane.preferences.addPropertyChangeListener("LANGUAGE", homePane._scratchomisedLanguageListener);
  }
}

/**
 * Keep the toolbar icon in sync when the host connects / disconnects.
 * @param {*} homePane
 */
function ensureHostUiListener(homePane) {
  const host = resolveHost(homePane);
  if (host && host.addChangeListener && !homePane._scratchomisedHostUiListener) {
    homePane._scratchomisedHostUiListener = () => refreshScratchomisedButton(homePane);
    host.addChangeListener(homePane._scratchomisedHostUiListener);
  }
}

/**
 * Toolbar toggle button:
 *   - left-click → start or stop (current action)
 *   - right-click → Start / Stop / Status menu
 *   - CSS class `scratchomised-active` when the bridge is wanted/connected
 *
 * @param {*} homePane
 * @param {string} [additionalClass]
 * @returns {HTMLButtonElement|null}
 */
export function createScratchomisedToggleButton(homePane, additionalClass) {
  if (!homePane.scratchomisedStartAction || !homePane.scratchomisedStopAction) {
    return null;
  }

  const button = document.createElement("button");
  button.id = "toolbar-button-SCRATCHOMISED";
  button.type = "button";
  button.classList.add("toolbar-button", "scratchomised-toolbar-button");
  if (additionalClass) {
    button.classList.add(additionalClass);
  }
  button.tabIndex = -1;

  const img = document.createElement("img");
  img.alt = "";
  img.width = 16;
  img.height = 16;
  img.draggable = false;
  img.style.display = "block";
  img.style.margin = "0";
  img.style.pointerEvents = "none";
  button.appendChild(img);

  button.setAction = (action) => {
    button.action = action;
    const iconUrl = action.getURL(ResourceAction.TOOL_BAR_ICON)
      || action.getURL(AbstractAction.SMALL_ICON);
    if (iconUrl) {
      const sep = iconUrl.indexOf("?") >= 0 ? "&" : "?";
      img.src = iconUrl + sep + "v=" + ICON_CACHE_VERSION;
    }
    const tip = action.getValue(AbstractAction.SHORT_DESCRIPTION)
      || action.getValue(AbstractAction.NAME);
    if (tip) {
      button.title = tip;
      button.setAttribute("aria-label", tip);
    }
    button.disabled = !action.isEnabled();
  };

  button.addEventListener("click", (ev) => {
    if (button.action && button.action.actionPerformed) {
      button.action.actionPerformed(ev);
    }
  });

  // Right-click menu (no leading separator — this menu is Scratchomised-only).
  homePane.scratchomisedToolBarPopup = new JSPopupMenu(
    homePane.preferences,
    button,
    (builder) => addScratchomisedMenu(homePane, builder, { noSeparator: true })
  );

  homePane.scratchomisedToolBarButton = button;
  refreshScratchomisedButton(homePane);
  return button;
}

/**
 * Swap start/stop icon and active styling from the current host state.
 * @param {*} homePane
 */
export function refreshScratchomisedButton(homePane) {
  const button = homePane.scratchomisedToolBarButton;
  if (!button || !button.setAction) {
    return;
  }
  if (!homePane.scratchomisedStartAction || !homePane.scratchomisedStopAction) {
    return;
  }
  const host = resolveHost(homePane);
  const active = !!(host && host.isActive());
  button.setAction(active ? homePane.scratchomisedStopAction : homePane.scratchomisedStartAction);
  button.classList.toggle("scratchomised-active", active);
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

/**
 * Dialog: connection status + short furniture preview.
 * @param {*} homePane
 */
export function showScratchomisedStatus(homePane) {
  const prefs = homePane.preferences;
  const host = resolveHost(homePane);
  const furniture = listExposedFurniture();
  const preview = furniture
    .slice(0, STATUS_FURNITURE_PREVIEW_LIMIT)
    .map((f) => {
      const kinds = f.kinds && f.kinds.length ? " [" + f.kinds.join(", ") + "]" : "";
      return "• " + (f.name || f.id) + kinds;
    })
    .join("\n");

  let message = t(prefs, "scratchomised.statusHeader", statusText(prefs, host))
    + "\n" + t(prefs, "scratchomised.furnitureCount", furniture.length);
  if (preview) {
    message += "\n" + preview;
  }
  if (furniture.length > STATUS_FURNITURE_PREVIEW_LIMIT) {
    message += "\n…";
  }
  homePane.showMessage(message);
}

/**
 * @returns {object[]}
 */
function listExposedFurniture() {
  const plugin = typeof window !== "undefined"
    && window.SweetHome3DJS
    && window.SweetHome3DJS.plugins
    && window.SweetHome3DJS.plugins.scratchomised;
  if (plugin && typeof plugin.getFurniture === "function") {
    return plugin.getFurniture();
  }
  return [];
}

/**
 * Append Start / Stop / Status items to a JSPopupMenu builder.
 * Used by the toolbar right-click menu and by the 3D / application menus.
 *
 * @param {*} homePane
 * @param {*} builder  JSPopupMenuBuilder
 * @param {{ noSeparator?: boolean }} [options]
 */
export function addScratchomisedMenu(homePane, builder, options) {
  if (!homePane.scratchomisedStartAction) {
    createScratchomisedActions(homePane);
  } else {
    localizeScratchomisedActions(homePane);
  }

  const prefs = homePane.preferences;
  const startIcon = resolveActionIconUrl(ICON.start);
  const stopIcon = resolveActionIconUrl(ICON.stop);

  if (!(options && options.noSeparator)) {
    builder.addSeparator();
  }

  // Flat items (not a submenu) so they are immediately visible on right-click.
  // Three-arg form: addMenuItem(iconUrl, label, callback).
  builder.addMenuItem(startIcon, t(prefs, "SCRATCHOMISED_START.Name"), () => {
    homePane.scratchomisedStartAction.actionPerformed();
  });
  builder.addMenuItem(stopIcon, t(prefs, "SCRATCHOMISED_STOP.Name"), () => {
    homePane.scratchomisedStopAction.actionPerformed();
  });
  builder.addMenuItem(startIcon, t(prefs, "SCRATCHOMISED_STATUS.Name"), () => {
    showScratchomisedStatus(homePane);
  });
}
