/**
 * Détecte l'usage de symboles connus non importés / non définis dans src/.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");

const known = [
  "ModelManager", "TextureManager", "ZIPTools", "URLContent", "HomeURLContent", "BlobURLContent",
  "SimpleURLContent", "ContentDigestManager", "ShapeTools", "OBJLoader", "DAELoader", "Max3DSLoader",
  "Ground3D", "Wall3D", "Room3D", "Label3D", "DimensionLine3D", "HomePieceOfFurniture3D",
  "Object3DBranch", "HTMLCanvas3D", "PlanComponent", "LengthUnit", "CoreTools", "OperatingSystem",
  "DefaultUserPreferences", "JSDialog", "KeyStroke", "IllegalStateException",
  "IllegalArgumentException", "UUID", "System", "SAXParser", "XMLWriter", "HomeXMLHandler",
  "HomeXMLExporter", "LocalStorageURLContent", "IndexedDBURLContent", "LocalURLContent",
  "ModelPreviewComponent", "FurnitureCatalogListPanel", "FurnitureTablePanel",
  "ModelMaterialsComponent", "ColorButton", "DirectHomeRecorder", "IncrementalHomeRecorder",
  "HomeDoorOrWindow", "HomeLight", "HomeFurnitureGroup", "HomeMaterial", "HomeTexture",
  "CatalogTexture", "CatalogPieceOfFurniture", "UnsupportedOperationException",
  "Object3DBranchFactory", "Polyline3D", "Font", "FontMetrics", "Graphics2D",
];

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(js|ts)$/.test(n) && !n.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

function definedInFile(text) {
  const defined = new Set();
  for (const m of text.matchAll(/import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]/g)) {
    for (const id of m[1].matchAll(/\b([A-Z][A-Za-z0-9_]*)\b/g)) defined.add(id[1]);
  }
  for (const m of text.matchAll(/(?:export\s+)?(?:class|function|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    defined.add(m[1]);
  }
  return defined;
}

function usagePatterns(sym) {
  return [
    new RegExp(`\\bnew\\s+${sym}\\b`),
    new RegExp(`\\b${sym}\\.getInstance\\b`),
    new RegExp(`\\b${sym}\\.[A-Z_][A-Z0-9_]+\\b`),
    new RegExp(`\\binstanceof\\s+${sym}\\b`),
    new RegExp(`\\b${sym}\\(`),
  ];
}

const issues = [];
for (const file of walk(src)) {
  const text = readFileSync(file, "utf8");
  const defined = definedInFile(text);
  for (const sym of known) {
    if (defined.has(sym)) continue;
    const patterns = usagePatterns(sym);
    if (!patterns.some((p) => p.test(text))) continue;
    const guarded =
      new RegExp(`typeof\\s+${sym}\\s*!==\\s*['"]undefined['"]`).test(text) ||
      new RegExp(`typeof\\s+${sym}\\s*===\\s*['"]undefined['"]`).test(text);
    const lines = text.split(/\n/);
    let line = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`typeof ${sym}`)) continue;
      if (patterns.some((p) => p.test(lines[i]))) {
        line = i + 1;
        break;
      }
    }
    issues.push({
      file: relative(root, file).replace(/\\/g, "/"),
      sym,
      line,
      severity: guarded ? "guard" : "critical",
    });
  }
}

issues.sort((a, b) => a.file.localeCompare(b.file) || a.sym.localeCompare(b.sym));

const crit = issues.filter((i) => i.severity === "critical");
const guard = issues.filter((i) => i.severity === "guard");

let md = `# Audit imports manquants\n\nGénéré: ${new Date().toISOString()}\n\n`;
md += `Critiques: **${crit.length}** — Gardés (typeof): **${guard.length}**\n\n`;
md += `## Critiques (ReferenceError probable)\n\n`;
for (const i of crit) md += `- \`${i.file}:${i.line}\` — **${i.sym}**\n`;
md += `\n## Gardés par typeof (souvent OK mais à convertir en import)\n\n`;
for (const i of guard) md += `- \`${i.file}:${i.line}\` — **${i.sym}**\n`;

const out = join(root, "scripts", "audit-missing-imports-report.md");
writeFileSync(out, md);
console.log(md);
console.log(`Rapport: ${out}`);
if (crit.length > 0) {
  console.error(`Échec audit-imports: ${crit.length} symbole(s) critique(s).`);
  process.exit(1);
}
