/**
 * UI theme: light / dark / system (OS preference).
 *
 * applyThemePreference() sets data-theme on <html> and dispatches
 * "sweethome3d:themechange" so canvases (plan) can refresh colors.
 */

export const THEME_LIGHT = "light";
export const THEME_DARK = "dark";
export const THEME_SYSTEM = "system";

/** CustomEvent name fired after data-theme is updated. */
export const THEME_CHANGE_EVENT = "sweethome3d:themechange";

const STORAGE_KEY = "SweetHome3DJS.uiTheme";
const VALID = new Set([THEME_LIGHT, THEME_DARK, THEME_SYSTEM]);

let systemWatchInstalled = false;

/**
 * @param {string} value
 * @return {"light"|"dark"|"system"}
 */
export function normalizeThemePreference(value) {
  if (value != null && VALID.has(String(value))) {
    return String(value);
  }
  return THEME_SYSTEM;
}

/**
 * @return {"light"|"dark"|"system"}
 */
export function getStoredThemePreference() {
  try {
    return normalizeThemePreference(localStorage.getItem(STORAGE_KEY));
  } catch (_) {
    return THEME_SYSTEM;
  }
}

/**
 * @param {"light"|"dark"|"system"} preference
 * @return {"light"|"dark"}
 */
export function resolveEffectiveTheme(preference) {
  const pref = normalizeThemePreference(preference);
  if (pref === THEME_LIGHT || pref === THEME_DARK) {
    return pref;
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? THEME_DARK
      : THEME_LIGHT;
  }
  return THEME_DARK;
}

/**
 * @param {"light"|"dark"|"system"} preference
 * @param {{persist?: boolean}} [options]
 */
export function applyThemePreference(preference, options = {}) {
  const pref = normalizeThemePreference(preference);
  const effective = resolveEffectiveTheme(pref);
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", effective);
    document.documentElement.setAttribute("data-theme-preference", pref);
    document.documentElement.style.colorScheme = effective;
    try {
      document.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, {
        detail: { theme: effective, preference: pref },
      }));
    } catch (_) {
      /* ignore */
    }
  }
  if (options.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch (_) {
      /* ignore */
    }
  }
  return effective;
}

/**
 * Réapplique le thème si la préférence est « system » quand l’OS change.
 * @param {() => string} [getPreference]
 */
export function watchSystemTheme(getPreference) {
  if (systemWatchInstalled || typeof window === "undefined" || !window.matchMedia) {
    return;
  }
  systemWatchInstalled = true;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    const pref = normalizeThemePreference(
      typeof getPreference === "function" ? getPreference() : getStoredThemePreference()
    );
    if (pref === THEME_SYSTEM) {
      applyThemePreference(THEME_SYSTEM, { persist: false });
    }
  };
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", onChange);
  } else if (typeof mq.addListener === "function") {
    mq.addListener(onChange);
  }
}

/**
 * Initialise le thème au plus tôt (avant chargement IndexedDB).
 */
export function initThemeFromStorage() {
  applyThemePreference(getStoredThemePreference(), { persist: false });
  watchSystemTheme(getStoredThemePreference);
}
