/**
 * Smoke test local : construit un .sh3x minimal, vérifie le ZIP + Home.xml,
 * et que les patches SAX (super) sont bien appliqués.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  ensureSh3xFileName,
  formatHomeOpenError,
  isHomeArchiveFileName,
  isValidSaveAsFileName,
} from "../src/LocalFileHelpers.js";
import { estimateCacheEntryBytes } from "../src/LocalResourceCache.js";
import {
  normalizeThemePreference,
  resolveEffectiveTheme,
  THEME_LIGHT,
  THEME_SYSTEM,
} from "../src/ThemeManager.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".smoke-tmp");
let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function fail(msg) {
  console.error(`✗ ${msg}`);
  failed++;
}

function assert(cond, msg) {
  if (cond) ok(msg);
  else fail(msg);
}

// --- 1. Patches SAX ---
const saxBase = join(root, "node_modules", "@flyskypie", "xml-sax-parser", "jssaxparser");
const reader = readFileSync(join(saxBase, "Reader.js"), "utf8");
const filter = readFileSync(join(saxBase, "XMLFilterImpls.js"), "utf8");
const exceptions = readFileSync(join(saxBase, "exceptions", "index.js"), "utf8");

assert(reader.includes("super();") && reader.includes("class StringReader"), "StringReader appelle super()");
assert(filter.includes("super(parent)") && !filter.includes("XMLFilterImpl.call(this"), "XMLFilterImpl2 appelle super(parent)");
assert(exceptions.includes("class SAXParseException") && exceptions.includes("super(msg || '')"), "SAXParseException appelle super()");

// --- 2. Construire un .sh3x ---
mkdirSync(tmpDir, { recursive: true });
const xml = `<?xml version='1.0'?>
<home version='7200' name='smoke' wallHeight='250.0' camera='top'>
  <camera attribute='topCamera' lens='PINHOLE' yaw='0' pitch='0.5' fieldOfView='1.1' x='0' y='0' z='100' time='0'/>
  <observerCamera attribute='observerCamera' lens='PINHOLE' yaw='0' pitch='0' fieldOfView='1.1' x='50' y='50' z='170' time='0' fixedSize='false'/>
  <environment groundColor='FF996666' skyColor='00CCE0FF' lightColor='00FFFFFF' ceillingLightColor='00FFFFFF' photoWidth='400' photoHeight='300' photoAspectRatio='VIEW_3D_RATIO' photoQuality='0' videoWidth='320' videoAspectRatio='RATIO_4_3' videoQuality='0' videoFrameRate='25'/>
  <compass x='0' y='0' diameter='100' northDirection='0' latitude='0.8' longitude='0' timeZone='Europe/Paris' visible='true'/>
  <wall id='wall1' xStart='0' yStart='0' xEnd='200' yEnd='0' height='250' thickness='10'/>
</home>`;

const zip = new JSZip();
zip.file("Home.xml", xml);
const sh3xPath = join(tmpDir, "smoke.sh3x");
const buf = zip.generate({ type: "nodebuffer" });
writeFileSync(sh3xPath, buf);
assert(existsSync(sh3xPath) && buf.length > 100, `Fichier smoke.sh3x créé (${buf.length} octets)`);

// --- 3. Relire le ZIP ---
const reopened = new JSZip(readFileSync(sh3xPath));
const entry = reopened.file("Home.xml");
assert(entry != null, "Entrée Home.xml présente");
const homeXml = entry.asText();
assert(homeXml.includes("<home") && homeXml.includes("observerCamera") && homeXml.includes("<wall"), "Home.xml contient home / camera / wall");
assert(!homeXml.includes("\uFEFF"), "Home.xml sans BOM");

// --- 4. Modules locaux critiques ---
assert(existsSync(join(root, "src", "LocalResourceCache.js")), "LocalResourceCache.js présent");
assert(existsSync(join(root, "scripts", "patch-xml-sax-parser.mjs")), "patch-xml-sax-parser.mjs présent");

const wall3d = readFileSync(join(root, "src", "Wall3D.js"), "utf8");
assert(wall3d.includes("import { ModelManager }"), "Wall3D importe ModelManager");
assert(wall3d.includes("constructor(area, doorsOrWindows)"), "DoorOrWindowArea a un constructeur");

const app = readFileSync(join(root, "src", "SweetHome3DJSApplication.js"), "utf8");
assert(app.includes("localFileObjectUrl") || app.includes("stillLinked"), "Open local gère la révocation blob");
assert(app.includes("openFromFile") && app.includes("openDroppedFile"), "Open local : openFromFile + openDroppedFile");
assert(app.includes("pickHomeFileToOpen") && app.includes("writeBlobToFileHandle"), "Open/Save : File System Access API");
assert(app.includes("confirmRecoverHome") && !app.includes("confirm(application.getUserPreferences"), "Auto-recovery via JSDialog (pas confirm natif)");
assert(app.includes("local-save-as-name") || app.includes("pickHomeFileToSave"), "Save As local (dialogue ou FSA)");
assert(app.includes("formatHomeOpenError") && app.includes("new JSDialog"), "Erreurs Open via JSDialog + formatHomeOpenError");
assert(!/homeError:\s*function[^{]*\{[^}]*\balert\s*\(/.test(app.replace(/\s+/g, " ")), "Aucun alert dans homeError");
assert(existsSync(join(root, "src", "LocalFileAccess.js")), "LocalFileAccess.js présent");
assert(existsSync(join(root, "src", "LocalFurnitureLibraryImport.js")), "LocalFurnitureLibraryImport.js présent");
assert(existsSync(join(root, "src", "LocalFurnitureLibraryStore.js")), "LocalFurnitureLibraryStore.js présent");
assert(
  readFileSync(join(root, "src", "HomePane.js"), "utf8").includes("pickAndImportFurnitureLibrary"),
  "HomePane branche l'import .sh3f local"
);

const homePane = readFileSync(join(root, "src", "HomePane.js"), "utf8");
assert(homePane.includes("showError(message)") && homePane.includes("#dialogBodyFromMessage"), "HomePane.showError via JSDialog");

assert(existsSync(join(root, "src", "localizeDialogTemplates.js")), "localizeDialogTemplates.js présent");
assert(existsSync(join(root, "src", "LocalFileHelpers.js")), "LocalFileHelpers.js présent");

const main = readFileSync(join(root, "src", "main.ts"), "utf8");
assert(main.includes("writeCacheResourceURL") && main.includes("pruneIndexedDBResourceCache"), "main.ts : cache IndexedDB + purge");
assert(main.includes("localizeDialogTemplates"), "main.ts localise les templates de dialogue");
assert(main.includes("openDroppedFile") && main.includes("dragover"), "main.ts : drag-and-drop Open");
assert(main.includes("initThemeFromStorage"), "main.ts initialise le thème");
assert(existsSync(join(root, "src", "ThemeManager.js")), "ThemeManager.js présent");
assert(readFileSync(join(root, "index.html"), "utf8").includes("theme-select"), "Préférences : sélecteur de thème");
assert(
  readFileSync(join(root, "public", "lib", "resources", "localization_fr.json"), "utf8").includes("themeLabel"),
  "i18n FR : themeLabel"
);

// --- 5. Helpers fichier local ---
assert(ensureSh3xFileName("plan", ".sh3d", ".sh3x") === "plan.sh3x", "ensureSh3xFileName ajoute .sh3x");
assert(ensureSh3xFileName("plan.SH3D", ".sh3d", ".sh3x") === "plan.sh3x", "ensureSh3xFileName remplace .sh3d");
assert(ensureSh3xFileName("plan.sh3x", ".sh3d", ".sh3x") === "plan.sh3x", "ensureSh3xFileName conserve .sh3x");
assert(formatHomeOpenError(new TypeError("boom")).includes("boom"), "formatHomeOpenError extrait le message");
assert(isHomeArchiveFileName("a.sh3x") && !isHomeArchiveFileName("a.txt"), "isHomeArchiveFileName");
assert(isValidSaveAsFileName("plan.sh3x") && !isValidSaveAsFileName("../x") && !isValidSaveAsFileName("  "), "isValidSaveAsFileName");
assert(estimateCacheEntryBytes({ content: "abcd" }) >= 4, "estimateCacheEntryBytes");
assert(normalizeThemePreference("nope") === THEME_SYSTEM, "normalizeThemePreference fallback system");
assert(
  readFileSync(join(root, "src", "style.css"), "utf8").includes("about-third-party-licenses"),
  "thème : contraste dialogue À propos"
);
assert(
  readFileSync(join(root, "src", "style.css"), "utf8").includes("texture-chooser-dialog .texture-catalog-list"),
  "thème : listes blanches legacy en sombre"
);
assert(
  readFileSync(join(root, "src", "ThemeManager.js"), "utf8").includes("THEME_CHANGE_EVENT"),
  "thème : événement de changement pour le plan 2D"
);
assert(
  readFileSync(join(root, "src", "PlanComponent.js"), "utf8").includes("applyThemeColors"),
  "plan 2D se met à jour au changement de thème"
);
assert(resolveEffectiveTheme(THEME_LIGHT) === THEME_LIGHT, "resolveEffectiveTheme light");
const furnitureImport = readFileSync(join(root, "src", "LocalFurnitureLibraryImport.js"), "utf8");
assert(furnitureImport.includes("slugifyLibraryName"), "slugifyLibraryName exporté");
assert(furnitureImport.includes("synthesizeSh3fFromObjZip"), "synthèse SH3F depuis ZIP OBJ+MTL");
assert(furnitureImport.includes("parseFurnitureImportSelection"), "import multi-fichiers / ensemble");
assert(furnitureImport.includes("packLooseModelFiles"), "emballage .obj/.mtl lâches");
assert(furnitureImport.includes("estimateDimensionsFromObj"), "dimensions depuis OBJ");
assert(furnitureImport.includes("input.multiple"), "sélecteur multi-fichiers");
assert(furnitureImport.includes("enrichSh3fWithModelIcons"), "génération vignettes 3D à l'import");
assert(existsSync(join(root, "src", "LocalFurnitureIconRenderer.js")), "LocalFurnitureIconRenderer.js présent");
assert(
  readFileSync(join(root, "src", "DefaultFurnitureCatalog.js"), "utf8").includes("truncating to"),
  "shelfBoxes invalides tolérés à l'import"
);
assert(
  readFileSync(join(root, "src", "DefaultFurnitureCatalog.js"), "utf8").includes("Skipping furniture #"),
  "meubles mal formés ignorés sans bloquer la bibliothèque"
);
assert(
  readFileSync(join(root, "src", "URLContent.js"), "utf8").includes("BASE_URL") &&
    readFileSync(join(root, "src", "URLContent.js"), "utf8").includes("lib/"),
  "getScriptFolder respecte la base Vite (lib/resources)"
);
assert(
  readFileSync(join(root, "src", "FurnitureCatalogListPanel.js"), "utf8").includes("IntersectionObserver"),
  "icônes catalogue en lazy-load (évite crash après gros import)"
);
assert(
  furnitureImport.includes("MAX_RENDERED_ICONS"),
  "plafond de vignettes WebGL à l'import OBJ"
);

assert(existsSync(join(root, "src", "scratchomised", "ScratchomisedHost.js")), "ScratchomisedHost.js présent");
assert(existsSync(join(root, "src", "scratchomised", "ScratchomisedPlugin.js")), "ScratchomisedPlugin.js (API eBlockly) présent");
assert(existsSync(join(root, "src", "scratchomised", "ScratchomisedHomePane.js")), "ScratchomisedHomePane.js (UI) présent");
assert(existsSync(join(root, "scripts", "scratchomised-bridge.mjs")), "scratchomised-bridge.mjs présent");
assert(existsSync(join(root, "public", "scratchomised", "Scratchomised.js")), "extension Scratchomised.js servie");
assert(existsSync(join(root, "public", "lib", "resources", "actions", "scratchomised-start.svg")), "icône start Scratchomised");
assert(existsSync(join(root, "public", "lib", "resources", "actions", "scratchomised-stop.svg")), "icône stop Scratchomised");
assert(homePane.includes("initScratchomisedOnHomePane"), "HomePane branche Scratchomised");
assert(homePane.includes("createScratchomisedToggleButton"), "toolbar Scratchomised start/stop");
assert(
  readFileSync(join(root, "src", "scratchomised", "ScratchomisedHomePane.js"), "utf8").includes("installScratchomisedPlugin"),
  "plugin exposé pour electroBlockly"
);
assert(
  readFileSync(join(root, "vite.config.ts"), "utf8").includes("scratchomisedBridgePlugin"),
  "Vite démarre le bridge Scratchomised"
);
assert(
  readFileSync(join(root, "src", "scratchomised", "ScratchomisedPlugin.js"), "utf8").includes("getFurnitureMenuItems"),
  "API getFurnitureMenuItems pour blocs eBlockly"
);
assert(existsSync(join(root, "src", "scratchomised", "i18n.js")), "i18n Scratchomised présent");
assert(
  readFileSync(join(root, "public", "lib", "resources", "localization.json"), "utf8").includes(
    "HomePane.SCRATCHOMISED_START.Name"
  ),
  "clés i18n Scratchomised (EN)"
);
assert(
  readFileSync(join(root, "public", "lib", "resources", "localization_fr.json"), "utf8").includes(
    "HomePane.SCRATCHOMISED_START.Name"
  ),
  "clés i18n Scratchomised (FR)"
);
const scratchUi = readFileSync(join(root, "src", "scratchomised", "ScratchomisedHomePane.js"), "utf8");
assert(scratchUi.includes("from \"./i18n.js\"") || scratchUi.includes("from './i18n.js'"),
  "UI Scratchomised utilise les chaînes localisées");
assert(scratchUi.includes("scratchomisedToolBarPopup") || scratchUi.includes("JSPopupMenu"),
  "menu clic-droit sur le bouton Scratchomised");
assert(scratchUi.includes("scratchomised-active"), "état actif visible sur le bouton Scratchomised");
assert(
  readFileSync(join(root, "src", "scratchomised", "ScratchomisedHost.js"), "utf8").includes("defineProperty("),
  "Host expose defineProperty (API publique)"
);

// cleanup
rmSync(tmpDir, { recursive: true, force: true });

if (failed > 0) {
  console.error(`\nSmoke test échoué : ${failed} assertion(s).`);
  process.exit(1);
}
console.log("\nSmoke test OK.");
