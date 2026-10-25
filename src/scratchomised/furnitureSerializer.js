/*
 * Furniture serialization shared by the WebSocket host and the public plugin API.
 *
 * Output shape mirrors the Java Scratchomised plugin so Scratch menus and
 * electroBlockly dropdowns stay compatible (id|name(description), kinds, …).
 */

import { HomeLight } from "../SweetHome3D";

/** Properties always included on each serialized piece (besides id / name). */
const ESSENTIAL_PROPERTIES = [
  "x", "y", "z", "angle", "width", "depth", "height",
  "visible", "name", "id", "color", "shininess", "power", "lightColor",
];

/**
 * Heuristic tags for Blockly / Scratch filters (light, switch, …).
 * Always includes "furniture".
 *
 * @param {*} piece
 * @returns {string[]}
 */
export function detectFurnitureKinds(piece) {
  /** @type {string[]} */
  const kinds = ["furniture"];
  const catalogId = piece.getCatalogId ? String(piece.getCatalogId() || "") : "";
  const name = piece.getName ? String(piece.getName() || "") : "";
  const hay = (catalogId + " " + name).toLowerCase();
  const isLight = piece instanceof HomeLight
    || typeof piece.getPower === "function"
    || /light|lamp|lampe/.test(hay);
  const isSwitch = /switch|interrupteur/.test(hay);
  if (isLight) {
    kinds.push("light");
  }
  if (isSwitch) {
    kinds.push("switch");
  }
  return kinds;
}

/**
 * Stable identity used by Scratch object menus.
 * Ensures `description` is non-empty (hashCode / id fallback) so labels stay unique.
 *
 * @param {*} piece
 * @returns {{ id: string|null, description: string, label: string, exportEntry: string }}
 */
export function furnitureIdentity(piece) {
  const id = piece.getId ? piece.getId() : null;
  let description = piece.getDescription ? piece.getDescription() : null;
  if (description == null || description === "") {
    description = String(piece.hashCode ? piece.hashCode() : id || "");
    if (piece.setDescription) {
      try {
        piece.setDescription(description);
      } catch (_) {
        /* ignore read-only pieces */
      }
    }
  }
  const name = piece.getName ? piece.getName() : "";
  const label = name + "(" + description + ")";
  const exportEntry = id != null ? id + "|" + label : label;
  return { id, description, label, exportEntry };
}

/**
 * One furniture object in the Scratch / electroBlockly wire format.
 * @param {*} piece
 * @returns {object}
 */
export function serializeFurniturePiece(piece) {
  const { id, description, label, exportEntry } = furnitureIdentity(piece);
  const classes = ["com.eteks.sweethome3d.model.HomePieceOfFurniture"];
  if (piece instanceof HomeLight || typeof piece.getPower === "function") {
    classes.unshift("com.eteks.sweethome3d.model.HomeLight");
  }
  const catalogId = piece.getCatalogId ? piece.getCatalogId() : null;
  const name = piece.getName ? piece.getName() : null;
  const kinds = detectFurnitureKinds(piece);

  /** @type {Record<string, *>} */
  const out = {
    id,
    name,
    catalogId,
    description,
    label,
    exportEntry,
    kinds,
    __scratchomisedClasses: classes,
  };

  const getters = {
    x: () => piece.getX(),
    y: () => piece.getY(),
    z: () => (piece.getGroundElevation
      ? piece.getGroundElevation()
      : (piece.getElevation && piece.getElevation())),
    angle: () => piece.getAngle(),
    width: () => piece.getWidth(),
    depth: () => piece.getDepth(),
    height: () => piece.getHeight(),
    visible: () => piece.isVisible(),
    color: () => piece.getColor(),
    shininess: () => piece.getShininess(),
    power: () => (typeof piece.getPower === "function" ? piece.getPower() : null),
    lightColor: () => (typeof piece.getPower === "function" && piece.getColor
      ? piece.getColor()
      : null),
  };

  for (let i = 0; i < ESSENTIAL_PROPERTIES.length; i++) {
    const key = ESSENTIAL_PROPERTIES[i];
    if (key === "id" || key === "name") {
      continue;
    }
    try {
      out[key] = getters[key] ? getters[key]() : null;
    } catch (_) {
      out[key] = null;
    }
  }
  return out;
}

/**
 * Serialize every piece in the home.
 * @param {*} home
 * @returns {object[]}
 */
export function listSerializedFurniture(home) {
  if (!home || !home.getFurniture) {
    return [];
  }
  const furniture = home.getFurniture() || [];
  const out = [];
  for (let i = 0; i < furniture.length; i++) {
    out.push(serializeFurniturePiece(furniture[i]));
  }
  return out;
}

export { ESSENTIAL_PROPERTIES };
