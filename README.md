# SweetHome3DJS

[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
[![GitHub Pages](https://img.shields.io/badge/demo-GitHub%20Pages-blue)](https://technologiescollege.github.io/SweetHome3DJS/)

![SweetHome3DJS Screenshot](sweethome3djs-screenshot.jpg)

[SweetHome3DJS][project-url] is a Vite / ESM / TypeScript fork of the Sweet Home 3D JS web editor (based on the [luxvitae-eco](https://github.com/luxvitae-eco/SweetHome3DJS) modernization of the official Space Mushrooms build).

**Try it online:** [https://technologiescollege.github.io/SweetHome3DJS/](https://technologiescollege.github.io/SweetHome3DJS/)

## About

Sweet Home 3D helps you draw house plans, arrange furniture, and preview the result in 3D. This fork runs entirely in the browser with **local Open / Save** (no PHP/JSP backend required for day-to-day use).

## Status

Usable for local editing of `.sh3x` / `.sh3d` files. Still evolving: the core remains a large JSweet-era codebase (`SweetHome3D.ts`), and some official online features are out of scope.

Working today:

- Open / Save / Save as (download `.sh3x`)
- Preferences + auto-recovery + resource cache in IndexedDB
- Furniture catalogs via JSON + UI import (`.sh3f` / OBJ+MTL)
- Theme Light / Dark / Automatic
- Scratchomised bridge (local Node relay)
- Checks: missing ESM imports + smoke `.sh3x`
- Deploy to **GitHub Pages** via Actions (`main`)

## Getting started

### Online (GitHub Pages)

Open [https://technologiescollege.github.io/SweetHome3DJS/](https://technologiescollege.github.io/SweetHome3DJS/) in a modern browser (Chrome / Edge recommended for File System Access).

After each push to `main`, the [Deploy to GitHub Pages](.github/workflows/deploy.yml) workflow builds the app and publishes `dist/`. In the repo settings, **Pages → Source** must be **GitHub Actions**.

> Note: the Scratchomised WebSocket bridge is not available on static Pages hosting; use a local `npm run dev` for Scratch / electroBlockly.

### Prerequisites (local)

- Node.js 18+
- npm

### Install & run locally

```bash
git clone https://github.com/technologiescollege/SweetHome3DJS.git
cd SweetHome3DJS
npm install
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/).

- **Open** — File System Access picker (Chrome/Edge), classic file input, or drag-and-drop `.sh3x` / `.sh3d`
- **Save** / **Save as** — rewrite the same file when a FS handle exists; otherwise download `.sh3x`
- Preferences, recovery, and extracted models use **IndexedDB** (cache pruned by count + size)
- **Theme** in Preferences: Light / Dark / Automatic (follows the OS)

### Checks & build

```bash
npm run check    # audit-imports + smoke-open-sh3x
npm run build
```

### Import furniture libraries (`.sh3f` / OBJ+MTL)

**In the app:** File → Import furniture library (or the toolbar action). You can select one or more of:

- `.sh3f` libraries (or a `.zip` that wraps a `.sh3f`)
- `.zip` archives that contain OBJ + MTL (+ textures) — a catalog entry is built automatically
- loose `.obj` / `.mtl` / texture files (select them together)
- several furniture ZIPs at once (merged into one local library)

For OBJ/MTL imports without a preview image, a 3D thumbnail is rendered automatically (WebGL) and stored in the library.

Libraries are stored in IndexedDB and reloaded automatically.

**CLI** (writes into `public/` for a permanent project catalog):

```bash
npm run import-sh3f -- "<url-or-path>" --name MyCatalog --register
```

Details: [scripts/import-sh3f.md](scripts/import-sh3f.md).

### Scratchomised (Scratch / electroBlockly ↔ Sweet Home 3D)

Bridge compatible with [Scratchomised](https://github.com/LyceeLivet/Scratchomised) (MIT). A browser page cannot listen on a TCP port, so `npm run dev` / `preview` also starts a small WebSocket relay on **port 55125**.

1. `npm run dev` (bridge + app)
2. Toolbar icons **house+play** / **house+stop**, or menu **Scratchomised → Démarrer / Arrêter**
3. TurboWarp: load `public/scratchomised/Scratchomised.js` (**Run without sandbox**), connect to `127.0.0.1:55125`
4. **electroBlockly** (future host): read furniture via the plugin API

```js
const api = window.SweetHome3DJS.plugins.scratchomised;
api.start();
api.getFurniture();              // [{ id, name, label, exportEntry, kinds, color, power, … }]
api.getFurnitureMenuItems({ kind: "light" });
api.setProperty(idOrExportEntry, "color", "0xFFFF00");
api.on("furniture", (ev) => { /* sync Blockly menus */ });
```

Standalone bridge: `npm run scratchomised`. Not available on static hosting alone (Node relay required).

### Updating from official SweetHome3DJS

There is no automatic sync with SourceForge. Use:

```bash
npm run diff-official -- --download 7.5.2 --download 7.6.0
```

Procedure (French): [scripts/sync-official.md](scripts/sync-official.md).

## Project structure

```
SweetHome3DJS/
├── public/lib/             # Catalogs, furniture, locales
├── scripts/                # import-sh3f, diff-official, audit, smoke, SAX patch
├── src/                    # Application (Vite ESM)
├── index.html
├── package.json
└── vite.config.ts
```

## Stack

- [Vite](https://vitejs.dev/)
- [TypeScript](https://www.typescriptlang.org/) (progressive)
- ES Modules
- WebGL 3D view

## License

GNU GPL v2 — see [LICENSE](LICENSE). Same terms as Sweet Home 3D.

## Acknowledgments

- Original Sweet Home 3D / SweetHome3DJS by Emmanuel Puybaret / Space Mushrooms
- [luxvitae-eco](https://github.com/luxvitae-eco) TypeScript / Vite refactoring

[project-url]: https://github.com/technologiescollege/SweetHome3DJS
