/**
 * File System Access API (Chrome/Edge) pour Open/Save locaux.
 * Fallback : input file + téléchargement <a download>.
 */

const HOME_FILE_TYPES = [
  {
    description: "Sweet Home 3D",
    accept: {
      "application/zip": [".sh3x", ".sh3d"],
      "application/octet-stream": [".sh3x", ".sh3d"],
    },
  },
];

/**
 * @return {boolean}
 */
export function supportsFileSystemAccess() {
  return typeof window !== "undefined"
    && typeof window.showOpenFilePicker === "function"
    && typeof window.showSaveFilePicker === "function";
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {"read"|"readwrite"} mode
 * @return {Promise<boolean>}
 */
export async function ensureFileHandlePermission(handle, mode = "readwrite") {
  if (handle == null || typeof handle.queryPermission !== "function") {
    return false;
  }
  const opts = { mode };
  if ((await handle.queryPermission(opts)) === "granted") {
    return true;
  }
  if (typeof handle.requestPermission === "function"
    && (await handle.requestPermission(opts)) === "granted") {
    return true;
  }
  return false;
}

/**
 * @return {Promise<{file: File, handle: FileSystemFileHandle}|null>}
 */
export async function pickHomeFileToOpen() {
  if (!supportsFileSystemAccess()) {
    return null;
  }
  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: HOME_FILE_TYPES,
      excludeAcceptAllOption: false,
    });
    const handle = handles && handles[0];
    if (handle == null) {
      return null;
    }
    const file = await handle.getFile();
    return { file, handle };
  } catch (ex) {
    // AbortError = utilisateur a annulé
    if (ex && ex.name === "AbortError") {
      return null;
    }
    console.warn("showOpenFilePicker failed, fallback input:", ex);
    return null;
  }
}

/**
 * @param {string} suggestedName
 * @return {Promise<FileSystemFileHandle|null>}
 */
export async function pickHomeFileToSave(suggestedName) {
  if (!supportsFileSystemAccess()) {
    return null;
  }
  try {
    return await window.showSaveFilePicker({
      suggestedName: suggestedName || "Home.sh3x",
      types: HOME_FILE_TYPES,
      excludeAcceptAllOption: false,
    });
  } catch (ex) {
    if (ex && ex.name === "AbortError") {
      return null;
    }
    console.warn("showSaveFilePicker failed, fallback download:", ex);
    return null;
  }
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {Blob} blob
 * @return {Promise<void>}
 */
export async function writeBlobToFileHandle(handle, blob) {
  const ok = await ensureFileHandlePermission(handle, "readwrite");
  if (!ok) {
    throw new Error("Permission d'écriture refusée sur le fichier");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (ex) {
    try {
      await writable.abort();
    } catch (_) {
      /* ignore */
    }
    throw ex;
  }
}

/**
 * Téléchargement classique (fallback).
 * @param {Blob} blob
 * @param {string} homeName
 */
export function downloadBlob(blob, homeName) {
  if (typeof navigator !== "undefined" && navigator.msSaveOrOpenBlob !== undefined) {
    navigator.msSaveOrOpenBlob(blob, homeName);
    return;
  }
  const downloadLink = document.createElement("a");
  downloadLink.setAttribute("style", "display: none");
  downloadLink.setAttribute("href", URL.createObjectURL(blob));
  downloadLink.setAttribute("download", homeName);
  document.body.appendChild(downloadLink);
  downloadLink.click();
  setTimeout(() => {
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadLink.getAttribute("href"));
  }, 500);
}
