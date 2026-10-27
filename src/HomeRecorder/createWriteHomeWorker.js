/*
 * createWriteHomeWorker.js
 *
 * Fork/Vite-only: wraps `WriteHomeWorker?worker` so HomeRecorder.js
 * does not depend on Vite's import query syntax in the main file body.
 */

import WriteHomeWorker from "./WriteHomeWorker?worker";

/**
 * @returns {Worker}
 */
export function createWriteHomeWorker() {
  return new WriteHomeWorker();
}
