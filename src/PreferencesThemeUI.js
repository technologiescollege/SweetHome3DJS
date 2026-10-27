/*
 * PreferencesThemeUI.js
 *
 * Fork-only: theme combo in the User Preferences dialog.
 * Keeps ThemeManager wiring out of JSViewFactory.js for easier upstream ports.
 */

import {
  applyThemePreference,
  getStoredThemePreference,
  normalizeThemePreference,
} from "./ThemeManager.js";

/**
 * @param {*} preferences
 * @returns {"light"|"dark"|"system"}
 */
function readCurrentTheme(preferences) {
  return normalizeThemePreference(
    typeof preferences.getUiTheme === "function"
      ? preferences.getUiTheme()
      : getStoredThemePreference()
  );
}

/**
 * Populate #theme-select, live-preview on change, restore on cancel.
 * @param {*} dialog JSDialog instance
 * @param {*} preferences
 * @param {{ createOptionElement: Function }} ui
 */
export function wirePreferencesThemeSelect(dialog, preferences, ui) {
  dialog.themeSelect = dialog.getElement("theme-select");
  if (dialog.themeSelect == null) {
    return;
  }
  dialog._themeCommitted = false;
  const currentTheme = readCurrentTheme(preferences);
  const themeOptions = [
    ["light", preferences.getLocalizedString("UserPreferencesPanel", "themeComboBox.light.text") || "Light"],
    ["dark", preferences.getLocalizedString("UserPreferencesPanel", "themeComboBox.dark.text") || "Dark"],
    ["system", preferences.getLocalizedString("UserPreferencesPanel", "themeComboBox.system.text") || "System"],
  ];
  for (let t = 0; t < themeOptions.length; t++) {
    dialog.themeSelect.appendChild(
      ui.createOptionElement(themeOptions[t][0], themeOptions[t][1], themeOptions[t][0] === currentTheme)
    );
  }
  dialog.registerEventListener(dialog.themeSelect, "change", () => {
    const opt = dialog.themeSelect.options[dialog.themeSelect.selectedIndex];
    if (opt != null) {
      applyThemePreference(opt.value, { persist: false });
    }
  });
  const previousBehaviorDisposer = dialog.disposer;
  dialog.disposer = (d) => {
    if (!dialog._themeCommitted) {
      applyThemePreference(readCurrentTheme(preferences), { persist: false });
    }
    if (typeof previousBehaviorDisposer === "function") {
      previousBehaviorDisposer(d);
    }
  };
}

/**
 * Commit theme from the preferences dialog applier.
 * @param {*} dialog
 * @param {*} preferences
 * @param {(el: *) => boolean} isElementVisible
 */
export function commitPreferencesTheme(dialog, preferences, isElementVisible) {
  if (dialog.themeSelect == null || !isElementVisible(dialog.themeSelect)) {
    return;
  }
  const selectedThemeOption = dialog.themeSelect.options[dialog.themeSelect.selectedIndex];
  const themeValue = selectedThemeOption != null ? selectedThemeOption.value : "system";
  dialog._themeCommitted = true;
  if (typeof preferences.setUiTheme === "function") {
    preferences.setUiTheme(themeValue);
  }
  applyThemePreference(themeValue, { persist: true });
}

/**
 * Restore UI theme when loading recorded preferences (IndexedDB / JSON).
 * @param {*} preferences UserPreferences with setUiTheme
 * @param {string|null} themeFromPrefs
 */
export function applyRecordedUiTheme(preferences, themeFromPrefs) {
  const uiTheme = normalizeThemePreference(
    themeFromPrefs != null ? themeFromPrefs : getStoredThemePreference()
  );
  preferences.setUiTheme(uiTheme);
  applyThemePreference(uiTheme);
}

/**
 * Keep DOM theme in sync when UI_THEME preference changes.
 * @param {*} preferences
 */
export function bindUiThemePropertyPersistence(preferences) {
  preferences.addPropertyChangeListener("UI_THEME", (ev) => {
    applyThemePreference(ev.getNewValue());
  });
}
