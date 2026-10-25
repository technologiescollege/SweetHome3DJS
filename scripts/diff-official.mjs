/**
 * Aide au portage depuis SweetHome3DJS officiel (SourceForge).
 *
 * Compare deux arbres officiels (--from / --to), ou un officiel avec src/ local (--to seul),
 * et produit un rapport des fichiers à porter + chemins locaux suggérés.
 *
 * Exemples :
 *   node scripts/diff-official.mjs --from .official/7.5.2 --to .official/7.6.0
 *   node scripts/diff-official.mjs --to .official/7.5.2
 *   node scripts/diff-official.mjs --download 7.5.2 --download 7.6.0
 *   node scripts/diff-official.mjs --download 7.5.2 --to .official/SweetHome3DJS-7.5.2
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src");
const cacheDir = join(root, ".official-cache");

const OFFICIAL_SRC_GLOBS = ["src", "lib/generated", "deploy"];

function parseArgs(argv) {
  const out = { from: null, to: null, downloads: [], out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--from") out.from = argv[++i];
    else if (a === "--to") out.to = argv[++i];
    else if (a === "--download") out.downloads.push(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else throw new Error(`Argument inconnu: ${a}`);
  }
  return out;
}

function usage() {
  console.log(`Usage:
  npm run diff-official -- --from <dir-officiel-A> --to <dir-officiel-B>
  npm run diff-official -- --to <dir-officiel>
  npm run diff-official -- --download 7.5.2 [--download 7.x.y]

Options:
  --from DIR       Ancienne version officielle (extraite)
  --to DIR         Nouvelle version officielle (extraite)
  --download VER   Télécharge SweetHome3DJS-VER.zip depuis SourceForge vers .official-cache/
  --out FILE       Rapport Markdown (défaut: scripts/diff-official-report.md)
  --help           Aide
`);
}

function walkFiles(dir, base = dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkFiles(full, base, acc);
    else if (/\.(js|ts|properties|css|html|json)$/i.test(name)) {
      acc.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
  return acc;
}

function sha1(file) {
  return createHash("sha1").update(readFileSync(file)).digest("hex");
}

function collectOfficialTree(officialRoot) {
  const files = new Map(); // relPath -> absPath
  const roots = [];
  for (const sub of OFFICIAL_SRC_GLOBS) {
    const d = join(officialRoot, sub);
    if (existsSync(d)) roots.push({ sub, d });
  }
  // Fallback: whole tree if no classic layout
  if (roots.length === 0) roots.push({ sub: "", d: officialRoot });

  for (const { sub, d } of roots) {
    for (const rel of walkFiles(d)) {
      const key = sub ? `${sub}/${rel}` : rel;
      files.set(key, join(d, rel));
    }
  }
  return files;
}

/** Index local src/ by basename (without ext) and by basename with ext. */
function buildLocalIndex() {
  const byBase = new Map(); // "Wall3D" -> [rel paths]
  const byName = new Map(); // "Wall3D.js" -> [rel paths]
  for (const rel of walkFiles(srcRoot)) {
    const name = basename(rel);
    const base = name.replace(/\.(js|ts)$/i, "");
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(rel);
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base).push(rel);
  }
  return { byBase, byName };
}

function mapOfficialToLocal(officialRel, localIndex) {
  const name = basename(officialRel);
  const base = name.replace(/\.(js|ts)$/i, "");
  const candidates = [];
  if (localIndex.byName.has(name)) candidates.push(...localIndex.byName.get(name));
  // SweetHome3D.js officiel → SweetHome3D.ts local
  if (extname(name).toLowerCase() === ".js") {
    const tsName = base + ".ts";
    if (localIndex.byName.has(tsName)) candidates.push(...localIndex.byName.get(tsName));
  }
  if (candidates.length === 0 && localIndex.byBase.has(base)) {
    candidates.push(...localIndex.byBase.get(base));
  }
  // Prefer same relative path under src/
  const uniq = [...new Set(candidates)];
  uniq.sort((a, b) => {
    const score = (p) => (p === name || p.endsWith("/" + name) || p === base + ".ts" ? 0 : 1);
    return score(a) - score(b) || a.localeCompare(b);
  });
  return uniq;
}

async function downloadVersion(version) {
  mkdirSync(cacheDir, { recursive: true });
  const zipName = `SweetHome3DJS-${version}.zip`;
  const zipPath = join(cacheDir, zipName);
  const extractDir = join(cacheDir, `SweetHome3DJS-${version}`);

  if (!existsSync(zipPath)) {
    const url = `https://downloads.sourceforge.net/project/sweethome3d/SweetHome3DJS/${zipName}`;
    console.log(`Téléchargement ${url} …`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) throw new Error(`Échec téléchargement ${version}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(zipPath, buf);
    console.log(`  → ${zipPath} (${buf.length} octets)`);
  } else {
    console.log(`ZIP déjà présent: ${zipPath}`);
  }

  if (!existsSync(extractDir)) {
    mkdirSync(extractDir, { recursive: true });
    console.log(`Extraction vers ${extractDir} …`);
    try {
      execFileSync("tar", ["-xf", zipPath, "-C", extractDir], { stdio: "inherit" });
    } catch {
      // Windows: tar gère les zip ; sinon PowerShell
      execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`],
        { stdio: "inherit" }
      );
    }
  }

  // Si le zip contient un dossier racine unique, le remonter
  const kids = readdirSync(extractDir).filter((n) => !n.startsWith("."));
  if (kids.length === 1 && statSync(join(extractDir, kids[0])).isDirectory()) {
    return join(extractDir, kids[0]);
  }
  return extractDir;
}

function compareTrees(fromMap, toMap) {
  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const [rel, toPath] of toMap) {
    if (!fromMap.has(rel)) added.push(rel);
    else if (sha1(fromMap.get(rel)) !== sha1(toPath)) changed.push(rel);
    else unchanged.push(rel);
  }
  for (const rel of fromMap.keys()) {
    if (!toMap.has(rel)) removed.push(rel);
  }
  return { added, removed, changed, unchanged };
}

function compareOfficialToLocal(toMap, localIndex) {
  const rows = [];
  for (const [rel, abs] of toMap) {
    if (!/\.(js|ts)$/i.test(rel)) continue;
    // Ignore noise
    if (rel.includes("test/") || rel.includes("node_modules/")) continue;
    const locals = mapOfficialToLocal(rel, localIndex);
    let status = "missing-local";
    let detail = "";
    if (locals.length > 0) {
      const localAbs = join(srcRoot, locals[0]);
      if (existsSync(localAbs)) {
        const oh = sha1(abs);
        const lh = sha1(localAbs);
        status = oh === lh ? "identical" : "differs";
        detail = locals.map((p) => `src/${p}`).join(", ");
      }
    }
    rows.push({ official: rel, status, local: detail || "(aucun)" });
  }
  return rows;
}

function renderReport({ mode, fromLabel, toLabel, diff, localRows, localIndex }) {
  const lines = [];
  lines.push(`# Rapport diff officiel → fork TS`);
  lines.push("");
  lines.push(`Généré: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Mode: **${mode}**`);
  if (fromLabel) lines.push(`- From: \`${fromLabel}\``);
  if (toLabel) lines.push(`- To: \`${toLabel}\``);
  lines.push("");
  lines.push("Voir aussi: [sync-official.md](./sync-official.md)");
  lines.push("");

  if (diff) {
    lines.push(`## Changements entre versions officielles`);
    lines.push("");
    lines.push(`| Type | Nombre |`);
    lines.push(`|------|--------|`);
    lines.push(`| Modifiés | ${diff.changed.length} |`);
    lines.push(`| Ajoutés | ${diff.added.length} |`);
    lines.push(`| Supprimés | ${diff.removed.length} |`);
    lines.push(`| Identiques | ${diff.unchanged.length} |`);
    lines.push("");

    const section = (title, list) => {
      if (!list.length) return;
      lines.push(`### ${title}`);
      lines.push("");
      for (const rel of list.sort()) {
        const locals = mapOfficialToLocal(rel, localIndex);
        const hint = locals.length ? locals.map((p) => `src/${p}`).join(", ") : "_(pas de correspondance locale)_";
        lines.push(`- \`${rel}\` → ${hint}`);
      }
      lines.push("");
    };
    section("Fichiers modifiés (à porter en priorité)", diff.changed);
    section("Fichiers ajoutés", diff.added);
    section("Fichiers supprimés", diff.removed);
  }

  if (localRows) {
    lines.push(`## Correspondance officiel ↔ \`src/\``);
    lines.push("");
    const differs = localRows.filter((r) => r.status === "differs");
    const missing = localRows.filter((r) => r.status === "missing-local");
    const identical = localRows.filter((r) => r.status === "identical");
    lines.push(`| Statut | Nombre |`);
    lines.push(`|--------|--------|`);
    lines.push(`| Diffère du local | ${differs.length} |`);
    lines.push(`| Absent du local | ${missing.length} |`);
    lines.push(`| Identique (hash) | ${identical.length} |`);
    lines.push("");
    if (differs.length) {
      lines.push(`### Diffère (porter / vérifier)`);
      lines.push("");
      for (const r of differs.sort((a, b) => a.official.localeCompare(b.official))) {
        lines.push(`- \`${r.official}\` ↔ \`${r.local}\``);
      }
      lines.push("");
    }
    if (missing.length) {
      lines.push(`### Absent localement`);
      lines.push("");
      for (const r of missing.sort((a, b) => a.official.localeCompare(b.official))) {
        lines.push(`- \`${r.official}\``);
      }
      lines.push("");
    }
  }

  lines.push(`## Rappel portage`);
  lines.push("");
  lines.push(`1. Ouvrir le fichier officiel modifié et l'équivalent \`src/\`.`);
  lines.push(`2. Réappliquer la logique en ESM (\`import\`/\`export\`), pas en collage global.`);
  lines.push(`3. Préserver Open/Save local, cache IndexedDB, patch xml-sax-parser.`);
  lines.push(`4. \`npm run build\` + test ouverture .sh3x/.sh3d.`);
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.from && !args.to && args.downloads.length === 0)) {
    usage();
    process.exit(args.help ? 0 : 1);
  }

  const downloaded = [];
  for (const ver of args.downloads) {
    downloaded.push({ ver, path: await downloadVersion(ver) });
  }

  let fromDir = args.from ? resolve(args.from) : null;
  let toDir = args.to ? resolve(args.to) : null;

  if (downloaded.length === 1 && !toDir) toDir = downloaded[0].path;
  if (downloaded.length >= 2) {
    fromDir = fromDir || downloaded[0].path;
    toDir = toDir || downloaded[downloaded.length - 1].path;
  }

  if (!toDir || !existsSync(toDir)) {
    throw new Error(`Répertoire --to introuvable: ${toDir}`);
  }
  if (fromDir && !existsSync(fromDir)) {
    throw new Error(`Répertoire --from introuvable: ${fromDir}`);
  }

  const localIndex = buildLocalIndex();
  const toMap = collectOfficialTree(toDir);
  let diff = null;
  let mode = "official-vs-local";

  if (fromDir) {
    mode = "official-A-vs-official-B";
    const fromMap = collectOfficialTree(fromDir);
    diff = compareTrees(fromMap, toMap);
  }

  const localRows = compareOfficialToLocal(toMap, localIndex);
  const reportPath = resolve(args.out || join(root, "scripts", "diff-official-report.md"));
  const md = renderReport({
    mode,
    fromLabel: fromDir,
    toLabel: toDir,
    diff,
    localRows,
    localIndex,
  });
  writeFileSync(reportPath, md);
  console.log(`Rapport écrit: ${reportPath}`);
  if (diff) {
    console.log(`  modifiés=${diff.changed.length} ajoutés=${diff.added.length} supprimés=${diff.removed.length}`);
  }
  const differs = localRows.filter((r) => r.status === "differs").length;
  const missing = localRows.filter((r) => r.status === "missing-local").length;
  console.log(`  vs local: diffère=${differs} absent=${missing}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
