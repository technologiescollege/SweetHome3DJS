# Import de bibliothèques `.sh3f`

Script Node : `scripts/import-sh3f.mjs`  
Commande npm : `npm run import-sh3f`

Importe une bibliothèque de meubles Sweet Home 3D (fichier `.sh3f`) depuis une **URL** ou un **chemin local**, puis la rend utilisable par l’appli web Vite.

## Prérequis

- Node.js 18+ (utilise `fetch` natif)
- Dépendances du projet déjà installées (`npm install`) — le script réutilise `jszip`

## Usage

```bash
npm run import-sh3f -- <url-ou-chemin> [--name slug] [--register]
```

| Argument / option | Description |
| --- | --- |
| `<url-ou-chemin>` | URL `http(s)://…` ou chemin vers un `.sh3f`, ou un `.zip` qui contient un `.sh3f` |
| `--name slug` | Nom du catalogue (défaut : nom du fichier sans extension) |
| `--register` | Ajoute automatiquement l’entrée dans `src/main.ts` (`furnitureCatalogURLs`) |
| `-h` / `--help` | Affiche l’aide |

### Exemples

Bibliothèque officielle « Trees » (ZIP SourceForge contenant `Trees.sh3f`) :

```bash
npm run import-sh3f -- "https://downloads.sourceforge.net/project/sweethome3d/SweetHome3D-models/3DModels-1.9.3/3DModels-Trees-1.9.3.zip" --name Trees --register
```

Fichier local déjà extrait :

```bash
npm run import-sh3f -- ./Telechargements/Contributions.sh3f --name Contributions --register
```

Sans `--register`, le script affiche le fragment à coller dans `src/main.ts`.

## Ce que produit le script

| Sortie | Emplacement |
| --- | --- |
| Archive meubles | `public/lib/furniture/<slug>.sh3f` |
| Catalogue JSON | `public/lib/resources/<slug>.json` |
| Traductions | `public/lib/resources/<slug>_fr.json`, `_de.json`, etc. |
| Enregistrement (si `--register`) | entrée ajoutée dans `furnitureCatalogURLs` de `src/main.ts` |

Les chemins `icon` / `model` / `planIcon` sont réécrits au format :

```text
lib/furniture/<slug>.sh3f!/chemin/dans/larchive.obj
```

L’appli charge alors l’entrée ZIP via le protocole `jar:…!/…` déjà géré par `URLContent` + JSZip.

## Après l’import

1. Relancer le serveur de dev si besoin : `npm run dev`
2. Recharger la page dans le navigateur
3. Les nouveaux meubles apparaissent dans le catalogue (catégories du fichier importé)

## Sources de bibliothèques

Packs officiels (ZIP contenant un `.sh3f`) :  
[https://www.sweethome3d.com/importModels.html](https://www.sweethome3d.com/importModels.html)  
et [SourceForge – SweetHome3D-models](https://sourceforge.net/projects/sweethome3d/files/SweetHome3D-models/).

Respectez la licence de chaque bibliothèque (Free Art, CC-BY, etc.).

## Encodage

Les fichiers `PluginFurnitureCatalog*.properties` des `.sh3f` suivent la convention Java : **ISO-8859-1 (latin1)**, éventuellement avec des escapes `\uXXXX`. Le script les décode en latin1 avant d’écrire les JSON en UTF-8.

## Limites

- L’import **runtime** via le menu de l’appli (`Importer une bibliothèque de meubles`) est supporté : le `.sh3f` est stocké dans IndexedDB (par navigateur / profil). Ce script CLI reste utile pour intégrer un catalogue durable dans `public/` (déploiement, CI).
- Les chemins d’icônes / modèles absents du `.sh3f` sont signalés en avertissement et laissés tels quels.
- Les fichiers JSON / `.sh3f` générés peuvent être volumineux : évitez de committer de grandes bibliothèques si ce n’est pas nécessaire au dépôt.

## Dépannage

| Symptôme | Piste |
| --- | --- |
| `HTTP 4xx/5xx` | Vérifier l’URL (les liens SourceForge `/download` redirigent ; l’URL `downloads.sourceforge.net/project/…` fonctionne en général) |
| `ni un .sh3f valide ni un ZIP…` | Le fichier n’est pas une archive SH3D, ou le ZIP ne contient pas de `.sh3f` |
| `chemin introuvable dans le .sh3f` | Propriété du catalogue qui pointe vers un fichier manquant dans l’archive |
| Meubles absents dans l’UI | Vérifier que le JSON est listé dans `furnitureCatalogURLs`, puis recharger après `npm run dev` |
