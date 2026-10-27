/*
 * HomePaneFork.js
 *
 * Fork-only wiring for HomePane: Scratchomised bridge + local furniture library import.
 * Keep HomePane.js limited to thin calls so upstream ports stay easier.
 */

import { pickAndImportFurnitureLibrary } from "./LocalFurnitureLibraryImport.js";
import {
  initScratchomisedOnHomePane,
  createScratchomisedActions,
  createScratchomisedToggleButton,
  addScratchomisedMenu,
} from "./scratchomised/ScratchomisedHomePane.js";

/**
 * Install fork UI hooks on a HomePane instance (constructor).
 * @param {*} homePane
 * @param {*} home
 */
export function installHomePaneFork(homePane, home) {
  initScratchomisedOnHomePane(homePane, home);
  homePane.createScratchomisedActions = () => createScratchomisedActions(homePane);
  homePane.createScratchomisedToggleButton = (additionalClass) =>
    createScratchomisedToggleButton(homePane, additionalClass);
  homePane.addScratchomisedMenu = (builder, options) =>
    addScratchomisedMenu(homePane, builder, options);
}

/**
 * Local async furniture library import (.sh3f / ZIP OBJ+MTL / multi-files).
 * Replaces the official server-backed chooser when running without readHomeURL.
 * @param {*} homePane
 * @returns {null}
 */
export function showImportFurnitureLibraryDialogFork(homePane) {
  const preferences = homePane.preferences;
  pickAndImportFurnitureLibrary(preferences, {
    confirmReplace: (slug) => homePane.confirmReplaceFurnitureLibrary(slug),
    showMessage: (result) => {
      const name = (result && (result.displayName || result.slug)) || "";
      const count = result && result.pieceCount != null ? result.pieceCount : "";
      let message;
      try {
        message = preferences.getLocalizedString(
          "HomeController",
          "importedFurnitureLibraryMessage",
          name
        );
      } catch (_) {
        message = "Meubles importés : " + name;
      }
      if (count !== "") {
        message += " — " + count + " meuble(s)";
      }
      homePane.showMessage(message);
    },
    showError: (error) => {
      let message;
      try {
        message = preferences.getLocalizedString(
          "HomeController",
          "importFurnitureLibraryError",
          error && error.message ? error.message : String(error)
        );
      } catch (_) {
        message =
          "Erreur d'import : " + (error && error.message ? error.message : error);
      }
      homePane.showError(message);
    },
  });
  return null;
}
