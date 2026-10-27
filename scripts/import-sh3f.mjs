#!/usr/bin/env node
/**
 * Importe une bibliothèque de meubles Sweet Home 3D (.sh3f) depuis une URL
 * (ou un fichier local) vers public/, et génère le JSON catalogue compatible Vite.
 *
 * Documentation : scripts/import-sh3f.md
 *
 * Usage:
 *   npm run import-sh3f -- <url-ou-chemin> [--name mon-catalogue] [--register]
 *
 * Exemple:
 *   npm run import-sh3f -- https://exemple.com/Contributions.sh3f --name Contributions --register
 */
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  access,
  constants as fsConstants,
} from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import JSZip from "../src/JSZipShim.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const FURNITURE_DIR = join(ROOT, "public", "lib", "furniture");
const RESOURCES_DIR = join(ROOT, "public", "lib", "resources");
const MAIN_TS = join(ROOT, "src", "main.ts");

const CONTENT_KEYS = new Set([
  "icon",
  "planIcon",
  "model",
  "iconDigest",
  "planIconDigest",
  "modelDigest",
]);

function usage(exitCode = 1) {
  console.error(`Usage: node scripts/import-sh3f.mjs <url-ou-chemin.sh3f> [--name slug] [--register]
  --name       Nom du catalogue (défaut: nom du fichier sans extension)
  --register   Ajoute l'entrée dans src/main.ts (furnitureCatalogURLs)`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { source: null, name: null, register: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") usage(0);
    if (a === "--register") {
      args.register = true;
      continue;
    }
    if (a === "--name") {
      args.name = argv[++i];
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Option inconnue: ${a}`);
      usage();
    }
    if (args.source) {
      console.error("Une seule source attendue.");
      usage();
    }
    args.source = a;
  }
  if (!args.source) usage();
  return args;
}

function slugify(value) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.sh3f$/i, "") || "furniture-library";
}

/** Parse un fichier .properties Java (simplifié, suffisant pour les catalogues SH3D). */
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
        // whitespace separator after key
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
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  ).replace(/\\([\\=:#!tnrf])/g, (_, c) => {
    switch (c) {
      case "t": return "\t";
      case "n": return "\n";
      case "r": return "\r";
      case "f": return "\f";
      default: return c;
    }
  });
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
  // dernier segment seul (certains catalogues préfixent un dossier virtuel)
  const base = wanted.split("/").pop();
  const matches = Object.keys(files).filter(
    (n) => !files[n].dir && n.split("/").pop().toLowerCase() === base.toLowerCase()
  );
  return matches.length === 1 ? matches[0] : null;
}

function rewriteCatalogPaths(props, zipFiles, publicZipRel) {
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
      console.warn(`  chemin introuvable dans le .sh3f: ${key}=${value}`);
      continue;
    }
    out[key] = `${publicZipRel}!/${entry}`;
    rewritten++;
  }
  return { props: out, rewritten, missing };
}

/**
 * Si le buffer est un ZIP « conteneur » (pack officiel), extrait le .sh3f interne.
 * Si c'est déjà un .sh3f (PluginFurnitureCatalog.properties), le laisse tel quel.
 */
async function unwrapSh3fIfNeeded(buffer, destZip, sourceName) {
  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const hasCatalog = names.some((n) =>
    /(^|\/)PluginFurnitureCatalog\.properties$/i.test(n)
  );
  if (hasCatalog) {
    return buffer;
  }

  const sh3fEntries = names.filter((n) => /\.sh3f$/i.test(n));
  if (sh3fEntries.length === 0) {
    throw new Error(
      "Le fichier n'est ni un .sh3f valide ni un ZIP contenant un .sh3f"
    );
  }
  if (sh3fEntries.length > 1) {
    console.warn(
      `Plusieurs .sh3f trouvés, utilisation de: ${sh3fEntries[0]}`
    );
  }
  const entry = sh3fEntries[0];
  console.log(`Extraction du .sh3f interne: ${entry}`);
  const inner = await zip.file(entry).async("nodebuffer");
  await writeFile(destZip, inner);
  return inner;
}

async function downloadOrRead(source, destFile) {
  const isUrl = /^https?:\/\//i.test(source);
  if (!isUrl) {
    const abs = resolve(source);
    await access(abs, fsConstants.R_OK);
    const data = await readFile(abs);
    await writeFile(destFile, data);
    return data;
  }

  console.log(`Téléchargement: ${source}`);
  const res = await fetch(source, {
    headers: { "User-Agent": "SweetHome3DJS-import-sh3f/1.0" },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} pour ${source}`);
  }
  if (!res.body) {
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(destFile, buf);
    return buf;
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(destFile));
  return readFile(destFile);
}

function listPropertyFiles(zip) {
  return Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .filter((n) => /(^|\/)PluginFurnitureCatalog(_[a-zA-Z0-9_]+)?\.properties$/i.test(n));
}

/**
 * Les .properties Java historiques sont en ISO-8859-1 (latin1), avec éventuellement
 * des escapes \uXXXX. asText() de JSZip décode en UTF-8 et casse les accents (é → �).
 */
async function readPropertiesText(zipFile) {
  const bytes = await zipFile.async("uint8array");
  return new TextDecoder("latin1").decode(bytes);
}

async function registerInMainTs(catalogJsonPublicPath) {
  let source = await readFile(MAIN_TS, "utf8");
  const entry = `urlBase + "${catalogJsonPublicPath}",`;
  if (source.includes(catalogJsonPublicPath)) {
    console.log(`Déjà enregistré dans main.ts: ${catalogJsonPublicPath}`);
    return;
  }
  const re = /(furnitureCatalogURLs:\s*\[\s*\n)([\s\S]*?)(\n\s*\],)/;
  if (!re.test(source)) {
    throw new Error("Impossible de trouver furnitureCatalogURLs dans src/main.ts");
  }
  source = source.replace(re, (_, start, body, end) => {
    const indent = "        ";
    const trimmed = body.replace(/\s*$/, "");
    return `${start}${trimmed}\n${indent}${entry}${end}`;
  });
  await writeFile(MAIN_TS, source, "utf8");
  console.log(`Enregistré dans src/main.ts → ${catalogJsonPublicPath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceName = slugify(
    args.name || basename(args.source.split("?")[0])
  );
  const zipFileName = `${sourceName}.sh3f`;
  const publicZipRel = `lib/furniture/${zipFileName}`;
  const destZip = join(FURNITURE_DIR, zipFileName);
  const catalogBaseName = sourceName;

  await mkdir(FURNITURE_DIR, { recursive: true });
  await mkdir(RESOURCES_DIR, { recursive: true });

  let buffer = await downloadOrRead(args.source, destZip);
  // Les packs officiels sont souvent un .zip qui contient le .sh3f
  buffer = await unwrapSh3fIfNeeded(buffer, destZip, sourceName);
  console.log(`SH3F enregistré: public/${publicZipRel} (${buffer.length} octets)`);

  const zip = await JSZip.loadAsync(buffer);
  const propertyFiles = listPropertyFiles(zip);
  if (propertyFiles.length === 0) {
    throw new Error("Aucun PluginFurnitureCatalog*.properties trouvé dans le .sh3f");
  }

  let pieceCount = 0;
  for (const propPath of propertyFiles) {
    const text = await readPropertiesText(zip.file(propPath));
    const parsed = parseProperties(text);
    const { props, rewritten, missing } = rewriteCatalogPaths(
      parsed,
      zip.files,
      publicZipRel
    );

    const localeMatch = propPath.match(/PluginFurnitureCatalog(_[a-zA-Z0-9_]+)?\.properties$/i);
    const localeSuffix = localeMatch?.[1] || "";
    const outName = `${catalogBaseName}${localeSuffix}.json`;
    const outPath = join(RESOURCES_DIR, outName);
    await writeFile(outPath, JSON.stringify(props, null, 2) + "\n", "utf8");

    const names = Object.keys(props).filter((k) => /^name#\d+$/.test(k));
    pieceCount = Math.max(pieceCount, names.length);
    console.log(
      `JSON: public/lib/resources/${outName} (${names.length} meubles, ${rewritten} chemins réécrits${missing ? `, ${missing} manquants` : ""})`
    );
  }

  const catalogJsonPublic = `lib/resources/${catalogBaseName}.json`;
  if (args.register) {
    await registerInMainTs(catalogJsonPublic);
  } else {
    console.log(`
Pour activer le catalogue, ajoutez dans src/main.ts :

  furnitureCatalogURLs: [
    urlBase + "lib/resources/DefaultFurnitureCatalog.json",
    urlBase + "${catalogJsonPublic}",
  ],

Ou relancez avec --register.`);
  }

  console.log(`\nOK — ${pieceCount} meuble(s) importé(s) sous le slug "${catalogBaseName}".`);
  console.log("Relancez npm run dev et rechargez la page.");
}

main().catch((err) => {
  console.error("Échec:", err.message || err);
  process.exit(1);
});
