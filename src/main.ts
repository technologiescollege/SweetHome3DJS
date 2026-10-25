import '@flyskypie/j4ts-awtgeom';
import '@flyskypie/j4ts-batik-svgpathparser';
import '@flyskypie/j4ts-swingundo';

import { SweetHome3DJSApplication } from "./SweetHome3DJSApplication.js";
import { pruneIndexedDBResourceCache } from "./LocalResourceCache.js";
import { localizeDialogTemplates } from "./localizeDialogTemplates.js";
import { isHomeArchiveFileName } from "./LocalFileHelpers.js";
import { JSDialog } from "./toolkit.js";
import {
    initThemeFromStorage,
    watchSystemTheme,
    getStoredThemePreference,
} from "./ThemeManager.js";
import './style.css';

// Appliquer le thème immédiatement (localStorage) pour éviter un flash.
initThemeFromStorage();

var urlBase = window.location.href.substring(
    0,
    window.location.href.lastIndexOf("/") + 1
);

// Mode fichier local : pas de readHomeURL → LocalFileHomeController
// (Open = sélecteur de fichier, Save = téléchargement .sh3x).
// Préférences + auto-recovery en IndexedDB (sans PHP).
var application = new SweetHome3DJSApplication({
    writePreferencesURL:
        "indexeddb://SweetHome3DJS/Data?keyPathField=name&contentField=content&name=preferences.json",
    readPreferencesURL:
        "indexeddb://SweetHome3DJS/Data/content?name=preferences.json",
    // Cache des ressources extraites des .sh3x (modèles, icônes) — requis pour
    // remplacer les HomeURLContent liés au blob temporaire après ouverture.
    writeCacheResourceURL:
        "indexeddb://SweetHome3DJS/Cache?keyPathField=name&contentField=content&dateField=date&name=%s&digest=%s",
    readCacheResourceURL:
        "indexeddb://SweetHome3DJS/Cache/content?name=%s",
    listCacheResourcesURL:
        "indexeddb://SweetHome3DJS/Cache?name=.*",
    furnitureCatalogURLs: [
        urlBase + "lib/resources/DefaultFurnitureCatalog.json",
        urlBase + "lib/resources/Trees.json",
    ],
    furnitureResourcesURLBase: urlBase,
    texturesCatalogURLs: [
        urlBase + "lib/resources/DefaultTexturesCatalog.json",
    ],
    texturesResourcesURLBase: urlBase,
    writeHomeWithWorker: true,
    compressionLevel: 5,
    autoRecovery: true,
    defaultHomeName: "Maison",
});

function runResourceCachePrune(options?: { maxEntries?: number; maxBytes?: number }) {
    return pruneIndexedDBResourceCache({
        maxEntries: 200,
        maxBytes: 80 * 1024 * 1024,
        ...options,
    }).then((stats) => {
        if (stats.deleted > 0) {
            console.info(
                `[SweetHome3DJS] Cache ressources IndexedDB : ${stats.deleted} entrée(s) purgée(s), ${stats.kept} conservée(s)`
            );
        }
        return stats;
    });
}

(globalThis as any).__sh3dPruneResourceCache = runResourceCachePrune;
runResourceCachePrune();

setTimeout(function () {
    const preferences = application.getUserPreferences();
    const refreshLocaleTemplates = () => localizeDialogTemplates(preferences);
    refreshLocaleTemplates();
    // IndexedDB peut arriver après le 1er tick : relocaliser + suivre la langue
    setTimeout(refreshLocaleTemplates, 400);
    if (typeof preferences.addPropertyChangeListener === "function") {
        preferences.addPropertyChangeListener("LANGUAGE", refreshLocaleTemplates);
    }
    if (typeof preferences.getUiTheme === "function") {
        watchSystemTheme(() => preferences.getUiTheme());
    } else {
        watchSystemTheme(getStoredThemePreference);
    }
    // Les bibliothèques .sh3f locales sont rechargées via RecordedUserPreferences.updateDefaultCatalogs
    application.addHome(application.createHome());
});

function getActiveLocalController(): { openDroppedFile?: (file: File) => void } | null {
    const homes = application.getHomes();
    if (homes.length === 0) {
        return null;
    }
    return application.getHomeController(homes[homes.length - 1]) as {
        openDroppedFile?: (file: File) => void;
    };
}

function showDropIgnoredMessage(fileName: string) {
    const preferences = application.getUserPreferences();
    if (preferences == null) {
        return;
    }
    const title =
        preferences.getLocalizedString("SweetHome3DJSApplication", "dropIgnored.title")
        || preferences.getLocalizedString("HomePane", "message.title");
    const message =
        preferences.getLocalizedString("SweetHome3DJSApplication", "dropIgnored.message")
        || "Only .sh3x / .sh3d home files can be opened by drag-and-drop.";
    new JSDialog(
        preferences,
        title,
        message
            + (fileName
                ? "<br><pre style='margin-top:0.5em'>" + String(fileName).replace(/</g, "&lt;") + "</pre>"
                : ""),
        { size: "small" }
    ).displayView();
}

// Drag & drop d’un .sh3x / .sh3d sur la fenêtre
window.addEventListener("dragover", function (ev) {
    if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes("Files")) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        document.documentElement.classList.add("sh3d-file-drag");
    }
});
window.addEventListener("dragleave", function (ev) {
    if (ev.relatedTarget == null || ev.relatedTarget === document.documentElement) {
        document.documentElement.classList.remove("sh3d-file-drag");
    }
});
window.addEventListener("drop", function (ev) {
    document.documentElement.classList.remove("sh3d-file-drag");
    if (!ev.dataTransfer || !ev.dataTransfer.files || ev.dataTransfer.files.length === 0) {
        return;
    }
    const file = ev.dataTransfer.files[0];
    if (!isHomeArchiveFileName(file.name)) {
        if (ev.dataTransfer.types && Array.from(ev.dataTransfer.types).includes("Files")) {
            ev.preventDefault();
            showDropIgnoredMessage(file.name);
        }
        return;
    }
    ev.preventDefault();
    const controller = getActiveLocalController();
    if (controller && typeof controller.openDroppedFile === "function") {
        controller.openDroppedFile(file);
    }
});

window.addEventListener("beforeunload", function (ev) {
    const homes = application.getHomes();
    if (
        homes.length > 0 &&
        (homes[0].isModified() || homes[0].isRecovered())
    ) {
        ev.preventDefault();
        // Navigateurs modernes : message générique, mais preventDefault active l’avertissement
        ev.returnValue = "";
    }
});
