/*
 * Scratchomised localization.
 *
 * Strings live under the HomePane resource class in localization*.json, e.g.:
 *   "HomePane.SCRATCHOMISED_START.Name": "…"
 *
 * Keys passed to t() omit the "HomePane." prefix (UserPreferences adds it).
 * FALLBACKS are English strings used when preferences are missing or a key
 * is absent from the loaded locale file.
 */

/** @type {Record<string, string>} */
const FALLBACKS = {
  "SCRATCHOMISED_MENU.Name": "Scratchomised",
  "SCRATCHOMISED_START.Name": "Start Scratchomised",
  "SCRATCHOMISED_START.ShortDescription": "Enable Scratchomised / electroBlockly bridge",
  "SCRATCHOMISED_STOP.Name": "Stop Scratchomised",
  "SCRATCHOMISED_STOP.ShortDescription": "Stop Scratchomised bridge",
  "SCRATCHOMISED_STATUS.Name": "Status / exposed furniture…",
  "scratchomised.unavailable": "Scratchomised is unavailable.",
  "scratchomised.started": "Scratchomised enabled (ws://127.0.0.1:55125).\nFurniture exposed for electroBlockly.",
  "scratchomised.stopped": "Scratchomised stopped.",
  "scratchomised.statusHeader": "Scratchomised — %s",
  "scratchomised.furnitureCount": "Exposed furniture: %s",
  "scratchomised.status.notInitialized": "Not initialized",
  "scratchomised.status.connectedReady": "Connected — Scratch ready (objects synced)",
  "scratchomised.status.connectedWaiting": "Connected to bridge — waiting for Scratch (client_ready)",
  "scratchomised.status.reconnecting": "Disconnected — reconnecting…",
  "scratchomised.status.stopped": "Stopped",
};

/**
 * Localized string for a Scratchomised UI key.
 * `%s` placeholders are replaced left-to-right from `params`.
 *
 * @param {import('../UserPreferences/UserPreferences.js').UserPreferences|null|undefined} preferences
 * @param {string} key  e.g. "SCRATCHOMISED_START.Name" or "scratchomised.started"
 * @param {...*} params
 * @returns {string}
 */
export function t(preferences, key, ...params) {
  if (preferences && typeof preferences.getLocalizedString === "function") {
    try {
      return preferences.getLocalizedString("HomePane", key, ...params);
    } catch (_) {
      /* fall through to English fallback */
    }
  }
  let text = FALLBACKS[key] != null ? FALLBACKS[key] : key;
  if (params && params.length) {
    let i = 0;
    text = String(text).replace(/%s/g, () => String(params[i++] ?? ""));
  }
  return text;
}

/**
 * Human-readable connection status for the status dialog / API.
 *
 * @param {import('../UserPreferences/UserPreferences.js').UserPreferences|null|undefined} preferences
 * @param {{ isConnected: () => boolean, clientReady: boolean, wantsConnection?: () => boolean, _wanted?: boolean }|null|undefined} host
 * @returns {string}
 */
export function statusText(preferences, host) {
  if (!host) {
    return t(preferences, "scratchomised.status.notInitialized");
  }
  if (host.isConnected()) {
    return host.clientReady
      ? t(preferences, "scratchomised.status.connectedReady")
      : t(preferences, "scratchomised.status.connectedWaiting");
  }
  const reconnecting = typeof host.wantsConnection === "function"
    ? host.wantsConnection()
    : !!host._wanted;
  return reconnecting
    ? t(preferences, "scratchomised.status.reconnecting")
    : t(preferences, "scratchomised.status.stopped");
}

export { FALLBACKS as SCRATCHOMISED_I18N_FALLBACKS };
