/*
 * LocalAppBase.js
 *
 * Fork-only: resolve the app base URL under Vite (BASE_URL) or location.pathname.
 * Used by ZIPTools.getScriptFolder() so URLContent.js stays closer to upstream.
 */

/**
 * Returns the application base path ending with `/`
 * (e.g. `/` or `/SweetHome3DJS/`).
 * @returns {string}
 */
export function getAppBasePath() {
  let basePath = "/";
  try {
    if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) {
      basePath = String(import.meta.env.BASE_URL);
    } else if (typeof window !== "undefined" && window.location) {
      let path = window.location.pathname || "/";
      if (/\.html?$/i.test(path)) {
        path = path.substring(0, path.lastIndexOf("/") + 1);
      } else if (!path.endsWith("/")) {
        path = path.substring(0, path.lastIndexOf("/") + 1) || "/";
      }
      basePath = path;
    }
  } catch (_) {
    basePath = "/";
  }
  if (!basePath.endsWith("/")) {
    basePath += "/";
  }
  return basePath;
}

/**
 * Absolute URL to the static `lib/` folder (resources, catalogs, icons).
 * @returns {string}
 */
export function getLibFolderUrl() {
  const origin =
    typeof window !== "undefined" && window.location && window.location.origin
      ? window.location.origin
      : "http://localhost";
  return new URL(getAppBasePath() + "lib/", origin).toString();
}
