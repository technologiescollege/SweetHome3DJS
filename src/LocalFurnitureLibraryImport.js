/**
 * Import navigateur de meubles / bibliothèques :
 * - .sh3f (ou ZIP contenant un .sh3f)
 * - ZIP contenant des modèles OBJ + MTL (+ textures)
 * - ensemble de fichiers (.obj / .mtl / images / plusieurs ZIP)
 * → IndexedDB + fusion dans le catalogue meubles actif.
 */
import JSZip from "jszip";
import {
  furnitureLibraryExists,
  getFurnitureLibrary,
  listFurnitureLibraries,
  saveFurnitureLibrary,
} from "./LocalFurnitureLibraryStore.js";

/** Chargement différé : évite de tirer tout le graphe SH3D pour la synthèse OBJ/ZIP. */
async function loadDefaultFurnitureCatalog() {
  const mod = await import("./DefaultFurnitureCatalog.js");
  return mod.DefaultFurnitureCatalog;
}

const CONTENT_KEYS = new Set([
  "icon",
  "planIcon",
  "model",
  "iconDigest",
  "planIconDigest",
  "modelDigest",
]);

const IMAGE_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;
const LOOSE_MODEL_EXT = /\.(obj|mtl|png|jpe?g|gif|bmp|webp)$/i;
const ARCHIVE_EXT = /\.(sh3f|zip)$/i;

/** PNG 1×1 gris clair (fallback hors navigateur). */
const FALLBACK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  ),
  (c) => c.charCodeAt(0)
);

/** @type {Map<string, string>} slug → object URL du .sh3f */
const activeSh3fUrls = new Map();

export function slugifyLibraryName(value) {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/\.(sh3f|zip)$/i, "") || "furniture-library"
  );
}

function normalizeZipPath(path) {
  return String(path || "")
    .replace(/^\/+/, "")
    .replace(/\\/g, "/");
}

function findZipEntry(files, requestedPath) {
  const wanted = normalizeZipPath(requestedPath);
  if (!wanted) return null;
  if (files[wanted] && !files[wanted].dir) return wanted;
  const lower = wanted.toLowerCase();
  for (const name of Object.keys(files)) {
    if (files[name].dir) continue;
    if (name.toLowerCase() === lower) return name;
    if (name.toLowerCase().endsWith("/" + lower)) return name;
  }
  const base = wanted.split("/").pop();
  const matches = Object.keys(files).filter(
    (n) => !files[n].dir && n.split("/").pop().toLowerCase() === base.toLowerCase()
  );
  return matches.length === 1 ? matches[0] : null;
}

function parseProperties(text) {
  const result = {};
  let pendingKey = null;
  let pendingValue = "";

  const flush = () => {
    if (pendingKey != null) {
      result[pendingKey] = decodePropertiesValue(pendingValue);
      pendingKey = null;
      pendingValue = "";
    }
  };

  for (let rawLine of text.split(/\r?\n/)) {
    if (pendingKey != null) {
      const cont = rawLine.replace(/\\$/, "");
      pendingValue += cont;
      if (!rawLine.endsWith("\\")) flush();
      continue;
    }

    const line = rawLine.replace(/^\uFEFF/, "");
    if (!line.trim() || line.trimStart().startsWith("#") || line.trimStart().startsWith("!")) {
      continue;
    }

    let sep = -1;
    let escaped = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === "=" || c === ":") {
        sep = i;
        break;
      }
      if ((c === " " || c === "\t") && sep < 0) {
        let j = i;
        while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
        if (j < line.length && (line[j] === "=" || line[j] === ":")) j++;
        while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
        pendingKey = decodePropertiesValue(line.slice(0, i).trimEnd());
        pendingValue = line.slice(j).replace(/\\$/, "");
        if (!line.endsWith("\\")) flush();
        sep = -2;
        break;
      }
    }
    if (sep === -2) continue;
    if (sep < 0) {
      pendingKey = decodePropertiesValue(line.trim());
      pendingValue = "";
      flush();
      continue;
    }
    pendingKey = decodePropertiesValue(line.slice(0, sep).trimEnd());
    let valueStart = sep + 1;
    while (valueStart < line.length && (line[valueStart] === " " || line[valueStart] === "\t")) {
      valueStart++;
    }
    pendingValue = line.slice(valueStart).replace(/\\$/, "");
    if (!line.endsWith("\\")) flush();
  }
  flush();
  return result;
}

function decodePropertiesValue(value) {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\([\\=:#!tnrf])/g, (_, c) => {
      switch (c) {
        case "t": return "\t";
        case "n": return "\n";
        case "r": return "\r";
        case "f": return "\f";
        default: return c;
      }
    });
}

function escapePropertiesValue(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/([=:#!])/g, "\\$1")
    .replace(/[^\x20-\x7E]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return "\\u" + code.toString(16).padStart(4, "0");
    });
}

function readPropertiesText(zipFile) {
  const bytes = zipFile.asUint8Array();
  return new TextDecoder("latin1").decode(bytes);
}

function listPropertyFiles(zip) {
  return Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .filter((n) => /(^|\/)PluginFurnitureCatalog(_[a-zA-Z0-9_]+)?\.properties$/i.test(n));
}

function listFileNames(zip) {
  return Object.keys(zip.files).filter((n) => !zip.files[n].dir);
}

function hasFurnitureCatalog(zip) {
  return listFileNames(zip).some((n) =>
    /(^|\/)PluginFurnitureCatalog\.properties$/i.test(n)
  );
}

function listObjEntries(zip) {
  return listFileNames(zip).filter((n) => /\.obj$/i.test(n));
}

/**
 * Réécrit les chemins vers `archiveRef!/entry` (archiveRef = blob URL ou nom logique).
 */
function rewriteCatalogPaths(props, zipFiles, archiveRef) {
  const out = { ...props };
  let rewritten = 0;
  let missing = 0;
  for (const [key, value] of Object.entries(props)) {
    const baseKey = key.includes("#") ? key.slice(0, key.indexOf("#")) : key;
    if (!CONTENT_KEYS.has(baseKey)) continue;
    if (baseKey.endsWith("Digest")) continue;
    if (!value || String(value).includes("!/")) continue;

    const entry = findZipEntry(zipFiles, value);
    if (!entry) {
      missing++;
      continue;
    }
    out[key] = `${archiveRef}!/${entry}`;
    rewritten++;
  }
  return { props: out, rewritten, missing };
}

/**
 * Stocke les chemins sous forme relative `!entry` pour réécriture au chargement.
 */
function rewriteCatalogPathsRelative(props, zipFiles) {
  const out = { ...props };
  for (const [key, value] of Object.entries(props)) {
    const baseKey = key.includes("#") ? key.slice(0, key.indexOf("#")) : key;
    if (!CONTENT_KEYS.has(baseKey) || baseKey.endsWith("Digest")) continue;
    if (!value || String(value).includes("!/")) continue;
    const entry = findZipEntry(zipFiles, value);
    if (entry) {
      out[key] = "!/" + entry;
    }
  }
  return sanitizeCatalogProperties(out);
}

/**
 * Corrige / neutralise des clés souvent invalides dans les .sh3f tiers
 * (ex. shelfBoxes avec un nombre de valeurs non multiple de 6).
 * @param {Object} props
 * @return {Object}
 */
function sanitizeCatalogProperties(props) {
  const out = { ...props };
  for (const [key, value] of Object.entries(props)) {
    if (!/^shelfBoxes#\d+$/i.test(key) || value == null) continue;
    const values = String(value).trim().split(/\s+/).filter((v) => v.length > 0);
    if (values.length === 0) {
      delete out[key];
      continue;
    }
    if (values.length % 6 !== 0) {
      const usable = values.length - (values.length % 6);
      if (usable === 0) {
        delete out[key];
      } else {
        out[key] = values.slice(0, usable).join(" ");
      }
    }
  }
  return out;
}

function bindArchiveUrls(props, sh3fObjectUrl) {
  const out = { ...props };
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === "string" && value.indexOf("!/") === 0) {
      out[key] = sh3fObjectUrl + value;
    } else if (typeof value === "string" && value.includes("!/")) {
      const entry = value.slice(value.indexOf("!/"));
      out[key] = sh3fObjectUrl + entry;
    }
  }
  return out;
}

function prettyModelName(objPath) {
  const base = normalizeZipPath(objPath).split("/").pop() || "meuble";
  const stem = base.replace(/\.obj$/i, "");
  return stem
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase()) || "Meuble";
}

function parentDir(path) {
  const n = normalizeZipPath(path);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(0, i) : "";
}

function findIconNear(zip, objPath) {
  const names = listFileNames(zip);
  const dir = parentDir(objPath);
  const stem = (objPath.split("/").pop() || "").replace(/\.obj$/i, "").toLowerCase();
  const candidates = names.filter((n) => IMAGE_EXT.test(n));
  const sameStem = candidates.find((n) => {
    const base = n.split("/").pop().toLowerCase();
    return base.startsWith(stem + ".") && parentDir(n) === dir;
  });
  if (sameStem) return sameStem;
  const inParent = candidates.find((n) => parentDir(n) === parentDir(dir) && n.split("/").pop().toLowerCase().startsWith(stem));
  if (inParent) return inParent;
  const inDir = candidates.find((n) => parentDir(n) === dir);
  return inDir || null;
}

/**
 * Estime largeur / profondeur / hauteur (cm) depuis les sommets OBJ.
 */
export function estimateDimensionsFromObj(objText) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let count = 0;
  const lines = String(objText || "").split(/\r?\n/);
  for (const line of lines) {
    if (line.length < 5 || line.charAt(0) !== "v" || line.charAt(1) !== " ") continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const x = parseFloat(parts[1]);
    const y = parseFloat(parts[2]);
    const z = parseFloat(parts[3]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
    count++;
  }
  if (count === 0) {
    return { width: 100, depth: 100, height: 100 };
  }
  let width = Math.abs(maxX - minX);
  let height = Math.abs(maxY - minY);
  let depth = Math.abs(maxZ - minZ);
  const maxDim = Math.max(width, height, depth);
  // OBJ souvent en mètres → cm ; si déjà en cm, ne pas multiplier.
  if (maxDim > 0 && maxDim < 20) {
    width *= 100;
    height *= 100;
    depth *= 100;
  }
  const clamp = (v) => Math.max(1, Math.round(v * 10) / 10);
  return {
    width: clamp(width || 100),
    depth: clamp(depth || 100),
    height: clamp(height || 100),
  };
}

function createPlaceholderIconBytes(label) {
  if (typeof document !== "undefined") {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#ced4da";
        ctx.fillRect(0, 0, 128, 128);
        ctx.fillStyle = "#495057";
        ctx.font = "bold 52px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(label || "?").charAt(0).toUpperCase(), 64, 68);
        const dataUrl = canvas.toDataURL("image/png");
        const b64 = dataUrl.split(",")[1];
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
      }
    } catch (_) {
      /* fallback */
    }
  }
  return FALLBACK_PNG;
}

/**
 * Liste les modèles OBJ d'un ZIP (un meuble par .obj).
 * @param {JSZip} zip
 * @return {{objPath: string, name: string, iconPath: string|null, dims: {width:number,depth:number,height:number}}[]}
 */
export function discoverObjModels(zip) {
  const objs = listObjEntries(zip);
  return objs.map((objPath) => {
    const entry = zip.file(objPath);
    const text = entry ? new TextDecoder("utf-8").decode(entry.asUint8Array()) : "";
    return {
      objPath,
      name: prettyModelName(objPath),
      iconPath: findIconNear(zip, objPath),
      dims: estimateDimensionsFromObj(text),
    };
  });
}

function buildCatalogPropertiesText(pieces, meta = {}) {
  const lines = [
    "# Generated by SweetHome3DJS local import",
    "id=" + escapePropertiesValue(meta.id || "Local#ImportedFurniture"),
    "name=" + escapePropertiesValue(meta.name || "Imported furniture"),
    "description=" + escapePropertiesValue(meta.description || "Meubles importés (OBJ/MTL)"),
    "version=1.0",
    "provider=SweetHome3DJS",
    "",
  ];
  pieces.forEach((piece, i) => {
    const n = i + 1;
    lines.push("id#" + n + "=" + escapePropertiesValue(piece.id || "Local#piece-" + n));
    lines.push("name#" + n + "=" + escapePropertiesValue(piece.name));
    lines.push("category#" + n + "=" + escapePropertiesValue(piece.category || "Importés"));
    lines.push("icon#" + n + "=" + escapePropertiesValue(piece.iconPath));
    lines.push("model#" + n + "=" + escapePropertiesValue(piece.objPath));
    lines.push("multiPartModel#" + n + "=true");
    lines.push("width#" + n + "=" + piece.dims.width);
    lines.push("depth#" + n + "=" + piece.dims.depth);
    lines.push("height#" + n + "=" + piece.dims.height);
    lines.push("movable#" + n + "=true");
    lines.push("doorOrWindow#" + n + "=false");
    lines.push("creator#" + n + "=" + escapePropertiesValue(piece.creator || "Import local"));
    lines.push("");
  });
  return lines.join("\n");
}

/**
 * Copie les entrées d'un ZIP source sous un préfixe dans le ZIP cible.
 */
function copyZipEntries(targetZip, sourceZip, prefix) {
  const map = new Map();
  for (const name of listFileNames(sourceZip)) {
    const dest = normalizeZipPath(prefix ? prefix + "/" + name : name);
    const file = sourceZip.file(name);
    if (!file) continue;
    targetZip.file(dest, file.asUint8Array());
    map.set(name, dest);
  }
  return map;
}

function ensurePieceIcons(targetZip, pieces) {
  return pieces.map((piece, i) => {
    if (piece.iconPath && targetZip.file(piece.iconPath)) {
      return piece;
    }
    const iconPath = "icons/piece-" + (i + 1) + ".png";
    targetZip.file(iconPath, createPlaceholderIconBytes(piece.name));
    return { ...piece, iconPath };
  });
}

/**
 * Remplace les icônes placeholder par une vignette 3D WebGL (navigateur uniquement).
 * Conserve les PNG déjà présents à côté des modèles.
 * @param {ArrayBuffer} sh3fBuffer
 * @return {Promise<ArrayBuffer>}
 */
export async function enrichSh3fWithModelIcons(sh3fBuffer) {
  let canRender = false;
  let renderFurnitureModelIcon = null;
  try {
    const mod = await import("./LocalFurnitureIconRenderer.js");
    canRender = mod.canRenderFurnitureIcons();
    renderFurnitureModelIcon = mod.renderFurnitureModelIcon;
  } catch (ex) {
    console.warn("Rendu vignettes meubles indisponible:", ex);
    return sh3fBuffer;
  }
  if (!canRender || typeof renderFurnitureModelIcon !== "function") {
    return sh3fBuffer;
  }

  const zip = new JSZip(sh3fBuffer);
  const propPath = listPropertyFiles(zip).find((n) =>
    /(^|\/)PluginFurnitureCatalog\.properties$/i.test(n)
  );
  if (!propPath) {
    return sh3fBuffer;
  }
  const props = parseProperties(readPropertiesText(zip.file(propPath)));
  const indices = Object.keys(props)
    .filter((k) => /^model#\d+$/.test(k))
    .map((k) => parseInt(k.slice(k.indexOf("#") + 1), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);

  if (indices.length === 0) {
    return sh3fBuffer;
  }

  const blobUrl = URL.createObjectURL(new Blob([sh3fBuffer], { type: "application/zip" }));
  let updated = false;
  /** Limite les rendus WebGL pour éviter de faire planter l'onglet sur de gros lots OBJ. */
  const MAX_RENDERED_ICONS = 24;
  let rendered = 0;
  try {
    for (const index of indices) {
      if (rendered >= MAX_RENDERED_ICONS) {
        break;
      }
      const modelPath = normalizeZipPath(props["model#" + index] || "").replace(/^\/+/, "");
      let iconPath = normalizeZipPath(props["icon#" + index] || "").replace(/^\/+/, "");
      if (!modelPath) continue;

      // Ne pas écraser une vraie vignette fournie avec le modèle
      const existingIcon = iconPath ? zip.file(iconPath) || zip.file("/" + iconPath) : null;
      const isPlaceholder =
        !iconPath ||
        /^icons\/piece-\d+\.png$/i.test(iconPath) ||
        !existingIcon;
      if (!isPlaceholder) {
        continue;
      }
      if (!iconPath || !/^icons\/piece-\d+\.png$/i.test(iconPath)) {
        iconPath = "icons/piece-" + index + ".png";
        props["icon#" + index] = "/" + iconPath;
        updated = true;
      }

      try {
        const png = await renderFurnitureModelIcon(blobUrl, modelPath, {
          iconSize: 128,
        });
        zip.file(iconPath, png);
        updated = true;
        rendered++;
        // Laisse respirer le main thread entre deux rendus WebGL
        await new Promise((r) => setTimeout(r, 0));
      } catch (ex) {
        console.warn("Vignette 3D impossible pour", modelPath, ex);
      }
    }
  } finally {
    try {
      URL.revokeObjectURL(blobUrl);
    } catch (_) {
      /* ignore */
    }
  }

  if (!updated) {
    return sh3fBuffer;
  }

  // Réécrit les propriétés si des chemins d'icônes ont été ajoutés
  zip.file(propPath, buildCatalogPropertiesTextFromProps(props));

  const bytes = zip.generate({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Reconstruit un fichier properties à partir d'un objet déjà parsé (ordre approximatif).
 * @param {Object} props
 * @return {string}
 */
function buildCatalogPropertiesTextFromProps(props) {
  const headerKeys = ["id", "name", "description", "version", "license", "provider"];
  const lines = ["# Generated by SweetHome3DJS local import"];
  for (const key of headerKeys) {
    if (props[key] != null) {
      lines.push(key + "=" + escapePropertiesValue(props[key]));
    }
  }
  lines.push("");
  const indices = Object.keys(props)
    .filter((k) => /^name#\d+$/.test(k))
    .map((k) => parseInt(k.slice(5), 10))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  const pieceKeys = [
    "id",
    "name",
    "category",
    "icon",
    "model",
    "multiPartModel",
    "width",
    "depth",
    "height",
    "movable",
    "doorOrWindow",
    "creator",
  ];
  for (const n of indices) {
    for (const key of pieceKeys) {
      const full = key + "#" + n;
      if (props[full] != null) {
        lines.push(full + "=" + escapePropertiesValue(props[full]));
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Transforme un ZIP de modèles OBJ/MTL en buffer .sh3f synthétique (+ vignettes 3D si possible).
 * @param {JSZip} zip
 * @param {{displayName?: string, idPrefix?: string, pathPrefix?: string}} [meta]
 * @return {Promise<ArrayBuffer>}
 */
export async function synthesizeSh3fFromObjZip(zip, meta = {}) {
  const discovered = discoverObjModels(zip);
  if (discovered.length === 0) {
    throw new Error("Aucun fichier .obj trouvé dans l'archive");
  }

  const out = new JSZip();
  const prefix = meta.pathPrefix ? normalizeZipPath(meta.pathPrefix) : "";
  const pathMap = copyZipEntries(out, zip, prefix);

  let pieces = discovered.map((d, i) => ({
    id: (meta.idPrefix || "Local#import") + "-" + (i + 1),
    name: d.name,
    category: meta.category || "Importés",
    objPath: pathMap.get(d.objPath) || (prefix ? prefix + "/" + d.objPath : d.objPath),
    iconPath: d.iconPath
      ? pathMap.get(d.iconPath) || (prefix ? prefix + "/" + d.iconPath : d.iconPath)
      : null,
    dims: d.dims,
    creator: meta.creator || "Import local",
  }));
  pieces = ensurePieceIcons(out, pieces);

  out.file(
    "PluginFurnitureCatalog.properties",
    buildCatalogPropertiesText(pieces, {
      id: meta.id || "Local#ImportedFurniture",
      name: meta.displayName || "Imported furniture",
      description: meta.description || "Meubles importés (OBJ/MTL)",
    })
  );

  const bytes = out.generate({ type: "uint8array" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return enrichSh3fWithModelIcons(buffer);
}

/**
 * Fusionne plusieurs archives OBJ (+ éventuellement fichiers déjà packés) en un seul .sh3f.
 * @param {{name: string, buffer: ArrayBuffer}[]} archives
 * @param {{displayName?: string}} [meta]
 * @return {Promise<ArrayBuffer>}
 */
export async function mergeObjArchivesToSh3f(archives, meta = {}) {
  const out = new JSZip();
  const allPieces = [];
  let pieceCounter = 0;

  archives.forEach((arch, archIndex) => {
    const src = new JSZip(arch.buffer);
    const models = discoverObjModels(src);
    if (models.length === 0) return;
    const prefix = "import/" + slugifyLibraryName(arch.name || "set-" + (archIndex + 1));
    const pathMap = copyZipEntries(out, src, prefix);
    models.forEach((d) => {
      pieceCounter++;
      allPieces.push({
        id: "Local#import-" + pieceCounter,
        name: d.name,
        category: "Importés",
        objPath: pathMap.get(d.objPath),
        iconPath: d.iconPath ? pathMap.get(d.iconPath) : null,
        dims: d.dims,
        creator: "Import local",
      });
    });
  });

  if (allPieces.length === 0) {
    throw new Error("Aucun modèle OBJ trouvé dans la sélection");
  }

  const withIcons = ensurePieceIcons(out, allPieces);
  out.file(
    "PluginFurnitureCatalog.properties",
    buildCatalogPropertiesText(withIcons, {
      id: "Local#ImportedFurnitureSet",
      name: meta.displayName || "Meubles importés",
      description: "Ensemble de meubles importés (OBJ/MTL)",
    })
  );

  const bytes = out.generate({ type: "uint8array" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return enrichSh3fWithModelIcons(buffer);
}

/**
 * Empaquette des fichiers lâches (.obj, .mtl, textures) en ZIP mémoire.
 * @param {File[]} files
 * @return {Promise<ArrayBuffer>}
 */
export async function packLooseModelFiles(files) {
  const zip = new JSZip();
  let objCount = 0;
  for (const file of files) {
    const name = normalizeZipPath(file.name).split("/").pop();
    if (!name) continue;
    if (/\.obj$/i.test(name)) objCount++;
    const buf = new Uint8Array(await file.arrayBuffer());
    zip.file(name, buf);
  }
  if (objCount === 0) {
    throw new Error("Sélectionnez au moins un fichier .obj (avec ses .mtl / textures)");
  }
  const bytes = zip.generate({ type: "uint8array" });
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Normalise un ArrayBuffer en .sh3f utilisable (catalogue présent).
 * @param {ArrayBuffer} arrayBuffer
 * @param {{displayName?: string}} [meta]
 * @return {Promise<ArrayBuffer>}
 */
async function ensureSh3fBuffer(arrayBuffer, meta = {}) {
  const zip = new JSZip(arrayBuffer);
  if (hasFurnitureCatalog(zip)) {
    return arrayBuffer;
  }

  const names = listFileNames(zip);
  const sh3fEntries = names.filter((n) => /\.sh3f$/i.test(n));
  if (sh3fEntries.length > 0) {
    const entry = sh3fEntries[0];
    const file = zip.file(entry);
    const bytes = file.asUint8Array();
    const nested = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return ensureSh3fBuffer(nested, meta);
  }

  if (listObjEntries(zip).length > 0) {
    return synthesizeSh3fFromObjZip(zip, {
      displayName: meta.displayName || "Meubles importés",
    });
  }

  throw new Error(
    "Format non reconnu : fournissez un .sh3f, ou un ZIP / fichiers contenant des modèles OBJ+MTL"
  );
}

/**
 * Parse un File .sh3f / .zip / (après synthèse OBJ) → enregistrement IndexedDB.
 * @param {File|Blob} file
 * @param {{slug?: string, replace?: boolean, displayName?: string}} [options]
 */
export async function parseFurnitureLibraryFile(file, options = {}) {
  if (file == null) {
    throw new Error("Aucun fichier");
  }
  const displayName = options.displayName || file.name || "library.sh3f";
  const slug = slugifyLibraryName(options.slug || displayName);
  const buffer = await file.arrayBuffer();
  const sh3fBuffer = await ensureSh3fBuffer(buffer, { displayName });
  const zip = new JSZip(sh3fBuffer);
  const propertyFiles = listPropertyFiles(zip);
  if (propertyFiles.length === 0) {
    throw new Error("Aucun PluginFurnitureCatalog*.properties trouvé dans le .sh3f");
  }

  let catalog = null;
  const locales = {};
  let pieceCount = 0;

  for (const propPath of propertyFiles) {
    const text = readPropertiesText(zip.file(propPath));
    const parsed = parseProperties(text);
    const relative = rewriteCatalogPathsRelative(parsed, zip.files);
    const localeMatch = propPath.match(/PluginFurnitureCatalog(_[a-zA-Z0-9_]+)?\.properties$/i);
    const localeSuffix = localeMatch && localeMatch[1] ? localeMatch[1] : "";
    if (!localeSuffix) {
      catalog = relative;
    } else {
      locales[localeSuffix.replace(/^_/, "")] = relative;
    }
    const names = Object.keys(relative).filter((k) => /^name#\d+$/.test(k));
    pieceCount = Math.max(pieceCount, names.length);
  }

  if (catalog == null) {
    throw new Error("PluginFurnitureCatalog.properties (sans locale) introuvable");
  }

  const exists = await furnitureLibraryExists(slug);
  if (exists && !options.replace) {
    const err = new Error("LIBRARY_EXISTS");
    err.slug = slug;
    err.displayName = displayName;
    throw err;
  }

  const sh3fBlob = new Blob([sh3fBuffer], { type: "application/zip" });
  const record = {
    name: slug,
    displayName,
    sh3f: sh3fBlob,
    catalog,
    locales,
    pieceCount,
    importedAt: Date.now(),
  };
  await saveFurnitureLibrary(record);
  return record;
}

/**
 * Détecte le type d'une archive.
 * @param {ArrayBuffer} buffer
 * @return {"sh3f"|"obj"|"unknown"}
 */
export function detectFurnitureArchiveKind(buffer) {
  try {
    const zip = new JSZip(buffer);
    if (hasFurnitureCatalog(zip)) return "sh3f";
    if (listFileNames(zip).some((n) => /\.sh3f$/i.test(n))) return "sh3f";
    if (listObjEntries(zip).length > 0) return "obj";
  } catch (_) {
    return "unknown";
  }
  return "unknown";
}

/**
 * Importe une sélection (multi-fichiers) : .sh3f, ZIP OBJ+MTL, .obj+.mtl+textures.
 * @param {File[]|FileList} files
 * @param {{slug?: string, replace?: boolean, confirmReplace?: function(string): boolean}} [options]
 * @return {Promise<object[]>}
 */
export async function parseFurnitureImportSelection(files, options = {}) {
  const list = Array.from(files || []).filter(Boolean);
  if (list.length === 0) {
    throw new Error("Aucun fichier");
  }

  const loose = [];
  const archiveFiles = [];
  for (const file of list) {
    const name = file.name || "";
    if (ARCHIVE_EXT.test(name)) {
      archiveFiles.push(file);
    } else if (LOOSE_MODEL_EXT.test(name)) {
      loose.push(file);
    } else {
      throw new Error("Type de fichier non supporté : " + name);
    }
  }

  /** @type {{name: string, buffer: ArrayBuffer, kind: string}[]} */
  const objArchives = [];
  /** @type {{name: string, buffer: ArrayBuffer}[]} */
  const sh3fArchives = [];

  for (const file of archiveFiles) {
    const buffer = await file.arrayBuffer();
    const kind = detectFurnitureArchiveKind(buffer);
    if (kind === "obj") {
      objArchives.push({ name: file.name, buffer, kind });
    } else if (kind === "sh3f") {
      sh3fArchives.push({ name: file.name, buffer });
    } else {
      throw new Error("Archive non reconnue : " + file.name);
    }
  }

  if (loose.length) {
    const packed = await packLooseModelFiles(loose);
    objArchives.push({ name: "selection-obj.zip", buffer: packed, kind: "obj" });
  }

  const records = [];

  const saveWithReplace = async (fileLike, opts) => {
    try {
      return await parseFurnitureLibraryFile(fileLike, { ...opts, replace: false });
    } catch (ex) {
      if (ex && ex.message === "LIBRARY_EXISTS") {
        const replace =
          opts.replace === true ||
          (typeof options.confirmReplace === "function"
            ? options.confirmReplace(ex.slug || fileLike.name)
            : false);
        if (!replace) {
          return null;
        }
        return parseFurnitureLibraryFile(fileLike, {
          ...opts,
          slug: ex.slug,
          replace: true,
        });
      }
      throw ex;
    }
  };

  if (objArchives.length === 1) {
    const a = objArchives[0];
    const sh3fBuf = await ensureSh3fBuffer(a.buffer, { displayName: a.name });
    const blob = new Blob([sh3fBuf], { type: "application/zip" });
    const fileLike = new File([blob], slugifyLibraryName(a.name) + ".sh3f", {
      type: "application/zip",
    });
    const rec = await saveWithReplace(fileLike, {
      slug: options.slug || slugifyLibraryName(a.name),
      displayName: a.name,
      replace: options.replace,
    });
    if (rec) records.push(rec);
  } else if (objArchives.length > 1) {
    const merged = await mergeObjArchivesToSh3f(objArchives, {
      displayName: options.displayName || "Meubles importés",
    });
    const blob = new Blob([merged], { type: "application/zip" });
    const slug = options.slug || "meubles-importes";
    const fileLike = new File([blob], slug + ".sh3f", { type: "application/zip" });
    const rec = await saveWithReplace(fileLike, {
      slug,
      displayName: options.displayName || "Meubles importés",
      replace: options.replace,
    });
    if (rec) records.push(rec);
  }

  for (const a of sh3fArchives) {
    const blob = new Blob([a.buffer], { type: "application/zip" });
    const fileLike = new File([blob], a.name, { type: "application/zip" });
    const rec = await saveWithReplace(fileLike, {
      slug: slugifyLibraryName(a.name),
      displayName: a.name,
      replace: options.replace,
    });
    if (rec) records.push(rec);
  }

  if (records.length === 0) {
    throw new Error("Aucun meuble importé");
  }
  return records;
}

/**
 * Collecte les IDs déjà présents dans le catalogue.
 * @param {FurnitureCatalog} furnitureCatalog
 * @return {string[]}
 */
function collectIdentifiedFurniture(furnitureCatalog) {
  const ids = [];
  if (furnitureCatalog == null) {
    return ids;
  }
  const categories = furnitureCatalog.getCategories();
  for (let i = 0; i < categories.length; i++) {
    const cat = categories[i];
    const furniture = cat.getFurniture();
    for (let j = 0; j < furniture.length; j++) {
      const piece = furniture[j];
      if (piece.getId && piece.getId() != null) {
        ids.push(piece.getId());
      }
    }
  }
  return ids;
}

/**
 * Fusionne un enregistrement bibliothèque dans le catalogue des préférences.
 * @param {UserPreferences} preferences
 * @param {object} record
 * @return {{pieceCount: number, slug: string, displayName: string}}
 */
export async function mergeFurnitureLibraryIntoPreferences(preferences, record) {
  if (preferences == null || record == null) {
    throw new Error("Préférences ou bibliothèque manquantes");
  }
  let sh3fUrl = activeSh3fUrls.get(record.name);
  if (sh3fUrl) {
    try {
      URL.revokeObjectURL(sh3fUrl);
    } catch (_) {
      /* ignore */
    }
  }
  sh3fUrl = URL.createObjectURL(record.sh3f);
  activeSh3fUrls.set(record.name, sh3fUrl);

  const DefaultFurnitureCatalog = await loadDefaultFurnitureCatalog();
  const props = bindArchiveUrls(record.catalog, sh3fUrl);
  const identified = collectIdentifiedFurniture(preferences.getFurnitureCatalog());
  const temp = new DefaultFurnitureCatalog([], null);
  temp.readFurniture([props], null, null, identified);

  // Laisse le navigateur peindre avant d'injecter des centaines de meubles (évite freeze / crash onglet)
  await new Promise((r) => setTimeout(r, 0));

  const target = preferences.getFurnitureCatalog();
  let added = 0;
  const categories = temp.getCategories();
  for (let i = 0; i < categories.length; i++) {
    const category = categories[i];
    const furniture = category.getFurniture();
    for (let j = 0; j < furniture.length; j++) {
      target.add(category, furniture[j]);
      added++;
      if (added % 80 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  }
  return { pieceCount: added, slug: record.name, displayName: record.displayName };
}

/**
 * Charge toutes les bibliothèques IndexedDB dans le catalogue courant.
 * @param {UserPreferences} preferences
 * @return {Promise<{loaded: number, pieces: number}>}
 */
export async function loadUserFurnitureLibraries(preferences) {
  const list = await listFurnitureLibraries();
  let pieces = 0;
  for (const record of list) {
    try {
      const result = await mergeFurnitureLibraryIntoPreferences(preferences, record);
      pieces += result.pieceCount;
    } catch (ex) {
      console.warn("Impossible de charger la bibliothèque", record && record.name, ex);
    }
  }
  return { loaded: list.length, pieces };
}

/**
 * Import UI : sélecteur multi-fichiers (.sh3f, ZIP OBJ+MTL, .obj/.mtl) + fusion.
 * @param {UserPreferences} preferences
 * @param {{showMessage?: function, showError?: function, confirmReplace?: function(string): boolean}} [ui]
 * @return {Promise<object|null>}
 */
export function pickAndImportFurnitureLibrary(preferences, ui = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".sh3f,.zip,.obj,.mtl,.png,.jpg,.jpeg,application/zip";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      document.body.removeChild(input);
      const files = input.files ? Array.from(input.files) : [];
      if (files.length === 0) {
        resolve(null);
        return;
      }
      try {
        const records = await parseFurnitureImportSelection(files, {
          confirmReplace: ui.confirmReplace,
        });
        let pieceCount = 0;
        const names = [];
        for (const record of records) {
          const result = await mergeFurnitureLibraryIntoPreferences(preferences, record);
          pieceCount += result.pieceCount;
          names.push(result.displayName || result.slug);
        }
        const summary = {
          pieceCount,
          slug: records.map((r) => r.name).join(", "),
          displayName: names.join(", "),
          libraries: records.length,
        };
        if (typeof ui.showMessage === "function") {
          ui.showMessage(summary);
        }
        resolve(summary);
      } catch (ex) {
        console.error(ex);
        if (typeof ui.showError === "function") {
          ui.showError(ex);
        }
        resolve(null);
      }
    });
    input.click();
  });
}

// Réexport utile pour tests
export const __test__ = {
  parseProperties,
  rewriteCatalogPaths,
  slugifyLibraryName,
  bindArchiveUrls,
  getFurnitureLibrary,
  estimateDimensionsFromObj,
  discoverObjModels,
  detectFurnitureArchiveKind,
};
