/*
 * Scratchomised integration for SweetHome3DJS
 * ===========================================
 *
 * Architecture (browser cannot listen on a TCP port):
 *
 *   Scratch  --ws:55125/scratchomised-->  Node bridge  <--ws/scratchomised-host--  this page
 *   (extension)                         (scripts/…-bridge.mjs)                 (ScratchomisedHost)
 *
 * Module map:
 *   ScratchomisedHost.js      WebSocket protocol + Home mutations
 *   ScratchomisedPlugin.js    window.SweetHome3DJS.plugins.scratchomised API
 *   ScratchomisedHomePane.js  Toolbar button, context menus, status dialog
 *   furnitureSerializer.js    Shared furniture wire format
 *   i18n.js                   Localized UI strings (HomePane.* keys)
 *
 * Vite starts the bridge automatically (vite-plugin-scratchomised.ts).
 * Upstream protocol: https://github.com/LyceeLivet/Scratchomised (MIT).
 */

export {
  ScratchomisedHost,
  ensureScratchomisedHost,
  getScratchomisedHost,
} from "./ScratchomisedHost.js";

export {
  installScratchomisedPlugin,
  SCRATCHOMISED_PLUGIN_ID,
  SCRATCHOMISED_PLUGIN_VERSION,
  SCRATCHOMISED_DEFAULT_PORT,
  getFurniture,
  getFurnitureById,
  setProperty,
  getProperty,
  start,
  stop,
  isActive,
  isConnected,
  on,
  getFurnitureMenuItems,
} from "./ScratchomisedPlugin.js";

export {
  initScratchomisedOnHomePane,
  createScratchomisedActions,
  createScratchomisedToggleButton,
  addScratchomisedMenu,
  refreshScratchomisedButton,
  showScratchomisedStatus,
  localizeScratchomisedActions,
} from "./ScratchomisedHomePane.js";

export {
  serializeFurniturePiece,
  listSerializedFurniture,
  detectFurnitureKinds,
  furnitureIdentity,
} from "./furnitureSerializer.js";

export { t as scratchomisedT, statusText as scratchomisedStatusText } from "./i18n.js";
