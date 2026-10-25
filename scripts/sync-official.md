# Mise à jour depuis SweetHome3DJS officiel

Ce fork (Vite / ESM / TypeScript) **n’est pas synchronisé automatiquement** avec l’officiel Space Mushrooms. Chaque nouvelle version se porte à la main.

## Sources officielles

| Ressource | URL |
|-----------|-----|
| Historique des versions | https://www.sweethome3d.com/history/ |
| ZIP / WAR | https://sourceforge.net/projects/sweethome3d/files/SweetHome3DJS/ |
| SVN (tags) | `https://svn.code.sf.net/p/sweethome3d/code/tags/V_x_y_z/SweetHome3DJS` |
| Fork TS amont (luxvitae-eco) | https://github.com/luxvitae-eco/SweetHome3DJS |

Version de base de ce projet : **7.5.2** (approximative, déjà modernisée).

## Remotes Git de ce dépôt

```bash
git remote -v
# origin   → votre fork (ex. technologiescollege)
# upstream → luxvitae-eco/SweetHome3DJS
```

- Avancées du **fork TS** : `git fetch upstream` puis merge/rebase.
- Avancées de l’**officiel** : port manuel depuis SVN/ZIP (pas de `git pull` possible).

## Procédure recommandée

### 1. Récupérer les arbres officiels

Avec le script (téléchargement SourceForge + rapport) :

```bash
# Comparer deux versions officielles et mapper vers src/
npm run diff-official -- --download 7.5.2 --download 7.6.0

# Ou seulement cartographier une version vs src/
npm run diff-official -- --download 7.5.2
```

Les ZIP sont extraits sous `.official-cache/` (ignoré par git).  
Rapport généré : `scripts/diff-official-report.md`.

À la main :

```bash
svn checkout https://svn.code.sf.net/p/sweethome3d/code/tags/V_7_5_2/SweetHome3DJS .official/7.5.2
# puis
npm run diff-official -- --from .official/7.5.2 --to .official/7.x.y
```

### 2. Lire le rapport

Priorité :

1. Fichiers **modifiés** entre les deux officiels (bugs / features).
2. Fichiers qui **diffèrent** encore de `src/` (hash différent).
3. Fichiers **absents** localement (nouveaux modules à ajouter).

Le script propose une correspondance `fichier officiel → src/...` (ex. `SweetHome3D.js` → `src/SweetHome3D.ts`).

### 3. Porter les changements

Pour chaque fichier concerné :

1. Ouvrir la version officielle **et** l’équivalent dans `src/`.
2. Réappliquer la **logique** en ESM (`import` / `export`), sans coller le style « script global » officiel.
3. Adapter les APIs déjà modernisées (`@flyskypie/*`, modules npm).

### 4. Ne pas écraser les adaptations locales

À préserver systématiquement :

- Mode fichier local (Open / Save `.sh3x`) — `main.ts`, `LocalFileHomeController`
- Cache IndexedDB des ressources (`writeCacheResourceURL`, etc.)
- Patch `postinstall` : `scripts/patch-xml-sax-parser.mjs`
- Imports ESM manquants (ex. `HomeURLContent` dans `SweetHome3D.ts`)
- Correctifs de constructeurs / classes (ex. `DoorOrWindowArea` dans `Wall3D.js`)

### 5. Vérifier

```bash
npm run build
npm run dev
```

Tests manuels :

- Ouvrir un `.sh3x` / `.sh3d` avec meubles et murs (portes/fenêtres)
- Contrôler la vue 3D (pas de pavé rouge, pas d’erreur `Wall3D`)
- Enregistrer puis rouvrir
- Préférences / auto-recovery IndexedDB

## Structure typique officiel vs local

| Officiel | Ce fork |
|----------|---------|
| Scripts globaux + Ant / JSweet | Vite + ESM |
| `src/*.js` manuscrits | `src/*.js` ou `src/*.ts` |
| `lib/generated/*.js` (JSweet) | souvent fusionné / adapté dans `src/` |
| Backend PHP/JSP | Open/Save navigateur + IndexedDB |

## Script `diff-official`

```bash
npm run diff-official -- --help
```

Options principales :

- `--from DIR` / `--to DIR` — arbres officiels extraits
- `--download VERSION` — ZIP SourceForge `SweetHome3DJS-VERSION.zip`
- `--out FILE` — chemin du rapport Markdown

## Après un port réussi

1. Noter la version officielle portée dans `CHANGELOG.md`.
2. Mettre à jour `getVersion()` si pertinent (`SweetHome3DJSApplication.js`).
3. Commit dédié du type : `Port SweetHome3DJS officiel x.y.z`.
