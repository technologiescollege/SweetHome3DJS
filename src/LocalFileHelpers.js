/**
 * Utilitaires mode fichier local (Open / Save) — sans dépendance DOM/toolkit
 * pour pouvoir être testés en Node.
 */

/**
 * Force une extension .sh3x (remplace .sh3d si présent).
 * @param {string} name
 * @param {string} homeExtension  ex. ".sh3d"
 * @param {string} homeExtension2 ex. ".sh3x"
 * @return {string}
 */
export function ensureSh3xFileName(name, homeExtension, homeExtension2) {
  if (name == null || name.length === 0) {
    return name;
  }
  let homeName = name.trim();
  const lower = homeName.toLowerCase();
  const ext1 = (homeExtension || ".sh3d").toLowerCase();
  const ext2 = (homeExtension2 || ".sh3x").toLowerCase();
  if (lower.endsWith(ext2)) {
    return homeName;
  }
  if (lower.endsWith(ext1)) {
    return homeName.slice(0, -ext1.length) + (homeExtension2 || ".sh3x");
  }
  return homeName + (homeExtension2 || ".sh3x");
}

/**
 * @param {string} name
 * @return {boolean}
 */
export function isHomeArchiveFileName(name) {
  if (name == null || name.length === 0) {
    return false;
  }
  const lower = String(name).toLowerCase();
  return lower.endsWith(".sh3x") || lower.endsWith(".sh3d");
}

/**
 * Nom de fichier Save As valide (non vide, pas de chemin).
 * @param {string} name
 * @return {boolean}
 */
export function isValidSaveAsFileName(name) {
  if (name == null) {
    return false;
  }
  const trimmed = String(name).trim();
  if (trimmed.length === 0) {
    return false;
  }
  if (/[\\/]/.test(trimmed) || trimmed === "." || trimmed === "..") {
    return false;
  }
  return true;
}

/**
 * Formate une erreur d'ouverture pour l'UI (texte lisible).
 * @param {*} error
 * @return {string}
 */
export function formatHomeOpenError(error) {
  if (error == null) {
    return "Erreur inconnue";
  }
  if (typeof error === "string") {
    return error;
  }
  const message = error.message || String(error);
  const name = error.name && error.name !== "Error" ? error.name + ": " : "";
  let detail = name + message;
  if (error.stack) {
    const firstLines = String(error.stack)
      .split("\n")
      .slice(0, 4)
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
    if (firstLines && firstLines !== detail) {
      detail += "\n\n" + firstLines;
    }
  }
  return detail;
}
