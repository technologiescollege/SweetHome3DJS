# Change Log

## SweetHome3DJS

[GitHub](https://github.com/technologiescollege/SweetHome3DJS) · [Live demo (GitHub Pages)](https://technologiescollege.github.io/SweetHome3DJS/)

All notable changes to this project will be documented in this file.

- Format based on [Keep A Change Log](https://keepachangelog.com/en/1.0.0/).
- This project adheres to [Semantic Versioning](https://semver.org/).

---

## [1.1.0] — 2026-10-27

### Added

- TypeScript **7.0** typecheck clean on `SweetHome3D.ts`
- Fork isolation modules for easier upstream ports: `LocalFileHomeController`, `HomePaneFork`, `LocalAppBase`, `PreferencesThemeUI`, `createWriteHomeWorker`
- Sync policy documented in `scripts/sync-official.md`

### Changed

- Deploy GitHub Pages from **`dev`** (removed unused `main` branch); `gh-pages` remains the published static site
- ESLint tuned for legacy SH3DJS view code (fewer false positives); fixed real `no-undef` bugs
- Extract Open/Save, Scratchomised, theme preferences wiring out of official-looking files

### Notes

- Remaining ESLint warnings are mostly unused locals in upstream JS — fix opportunistically on SourceForge ports.

## [1.0.0] — 2026-10-25

### Added

- Vite / ESM / TypeScript tooling and production build for GitHub Pages (`base: /SweetHome3DJS/`)
- Local Open / Save / Save as for `.sh3x` / `.sh3d` (no PHP backend required)
- Furniture library import from the UI (`.sh3f`, OBJ/MTL ZIP, multi-file) with WebGL thumbnails
- Theme preference: Light / Dark / Automatic (with plan canvas refresh on theme change)
- Scratchomised bridge for Scratch / electroBlockly (`window.SweetHome3DJS.plugins.scratchomised`)
- Localized Scratchomised UI (EN, FR, DE, ES, IT)
- GitHub Actions workflow deploying `dist/` to GitHub Pages

### Changed

- Light/dark contrast fixes for About dialog, choosers, and legacy white lists
- Documentation and repository URLs for technologiescollege fork

### Notes

- Scratchomised WebSocket relay needs Node (`npm run dev` or `npm run scratchomised`); not available on static GitHub Pages alone.
