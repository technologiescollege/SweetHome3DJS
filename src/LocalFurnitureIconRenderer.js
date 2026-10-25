/**
 * Génère une vignette PNG d'un modèle 3D (OBJ dans un ZIP) pour le catalogue local.
 */
import { mat4, vec3 } from "gl-matrix";
import { HTMLCanvas3D } from "./HTMLCanvas3D.js";
import { ModelManager } from "./ModelManager.js";
import {
  AmbientLight3D,
  BranchGroup3D,
  DirectionalLight3D,
  Group3D,
  TransformGroup3D,
} from "./scene3d.js";
import { URLContent } from "./URLContent.js";

const DEFAULT_ICON_SIZE = 128;
const LOAD_TIMEOUT_MS = 8000;

/**
 * @param {HTMLImageElement|HTMLCanvasElement} image
 * @return {Uint8Array}
 */
function imageToPngBytes(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.width || image.naturalWidth;
  canvas.height = image.height || image.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f1f3f5";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  const b64 = dataUrl.split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Attend que les textures soient chargées (ou timeout).
 * @param {HTMLCanvas3D} canvas3D
 * @param {number} timeoutMs
 * @return {Promise<void>}
 */
function waitForTextures(canvas3D, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (canvas3D.isLoadingCompleted() || Date.now() - start > timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, 40);
    };
    tick();
  });
}

/**
 * Charge un modèle depuis une URL ZIP / jar:zip!/entry.
 * @param {string} modelUrl
 * @return {Promise<import('./scene3d.js').Node3D>}
 */
function loadModelNode(modelUrl) {
  const content = URLContent.fromURL(modelUrl);
  return new Promise((resolve, reject) => {
    ModelManager.getInstance().loadModel(content, false, {
      modelUpdated: (modelRoot) => resolve(modelRoot),
      modelError: (err) => reject(err || new Error("Chargement modèle échoué")),
    });
  });
}

/**
 * Rendu d'un nœud 3D vers PNG (vue 3/4 catalogue).
 * @param {import('./scene3d.js').Node3D} modelRoot
 * @param {number} iconSize
 * @param {{width?: number, depth?: number, height?: number}} [dims]
 * @return {Promise<Uint8Array>}
 */
async function renderModelNodeToPng(modelRoot, iconSize) {
  const modelManager = ModelManager.getInstance();
  // Toujours cadrer sur les bornes du maillage (unités OBJ), pas les cm catalogue
  const size = modelManager.getSize(modelRoot);
  const maxDim = Math.max(size[0], size[1], size[2], 1e-3);
  const scaleFactor = 1.7 / maxDim;

  const canvas = document.createElement("canvas");
  canvas.width = iconSize;
  canvas.height = iconSize;
  canvas.style.backgroundColor = "rgb(241, 243, 245)";

  const canvas3D = new HTMLCanvas3D(canvas, true);
  canvas3D.setFieldOfView(Math.PI * 40 / 180);

  // Caméra type aperçu meuble (légèrement en hauteur, de biais)
  const viewYaw = Math.PI / 7;
  const viewPitch = -Math.PI / 10;
  const nominalDistanceToCenter = 1.35 / Math.tan(Math.PI / 8);
  const translation = mat4.create();
  mat4.translate(translation, translation, vec3.fromValues(0, 0, nominalDistanceToCenter));
  const pitchRotation = mat4.create();
  mat4.rotateX(pitchRotation, pitchRotation, viewPitch);
  const yawRotation = mat4.create();
  mat4.rotateY(yawRotation, yawRotation, viewYaw);
  mat4.mul(pitchRotation, pitchRotation, translation);
  mat4.mul(yawRotation, yawRotation, pitchRotation);
  canvas3D.setViewPlatformTransform(yawRotation);

  const modelTransform = mat4.create();
  mat4.scale(modelTransform, modelTransform, vec3.fromValues(scaleFactor, scaleFactor, scaleFactor));
  // Centre le modèle sur l'origine
  const bounds = modelManager.getBounds(modelRoot);
  const lower = vec3.create();
  const upper = vec3.create();
  bounds.getLower(lower);
  bounds.getUpper(upper);
  const center = vec3.fromValues(
    (lower[0] + upper[0]) / 2,
    (lower[1] + upper[1]) / 2,
    (lower[2] + upper[2]) / 2
  );
  const centerTransform = mat4.create();
  mat4.translate(centerTransform, centerTransform, vec3.fromValues(-center[0], -center[1], -center[2]));
  mat4.mul(modelTransform, modelTransform, centerTransform);

  const modelTransformGroup = new TransformGroup3D(modelTransform);
  if (modelRoot.getParent && modelRoot.getParent() != null) {
    modelRoot.getParent().removeChild(modelRoot);
  }
  modelTransformGroup.addChild(modelRoot);

  const scene = new BranchGroup3D();
  scene.setCapability(Group3D.ALLOW_CHILDREN_EXTEND);
  scene.addChild(modelTransformGroup);
  scene.addChild(new DirectionalLight3D(vec3.fromValues(0.9, 0.9, 0.9), vec3.fromValues(1.732, -0.8, -1)));
  scene.addChild(new DirectionalLight3D(vec3.fromValues(0.9, 0.9, 0.9), vec3.fromValues(-1.732, -0.8, -1)));
  scene.addChild(new DirectionalLight3D(vec3.fromValues(0.85, 0.85, 0.85), vec3.fromValues(0, -0.8, 1)));
  scene.addChild(new DirectionalLight3D(vec3.fromValues(0.55, 0.55, 0.55), vec3.fromValues(0, 1, 0)));
  scene.addChild(new AmbientLight3D(vec3.fromValues(0.25, 0.25, 0.25)));

  canvas3D.setScene(scene);
  canvas3D.updateViewportSize();
  await waitForTextures(canvas3D, LOAD_TIMEOUT_MS);

  const image = await new Promise((resolve) => {
    canvas3D.getImage((img) => resolve(img));
  });
  const png = imageToPngBytes(image);
  try {
    canvas3D.clear();
  } catch (_) {
    /* ignore */
  }
  return png;
}

/**
 * Génère une vignette PNG pour un modèle dans un ZIP (URL blob/http du ZIP).
 * @param {string} zipUrl URL de l'archive (ex. blob:...)
 * @param {string} entryPath chemin de l'entrée .obj dans le ZIP
 * @param {{iconSize?: number, width?: number, depth?: number, height?: number}} [options]
 * @return {Promise<Uint8Array>}
 */
export async function renderFurnitureModelIcon(zipUrl, entryPath, options = {}) {
  const iconSize = options.iconSize || DEFAULT_ICON_SIZE;
  const path = String(entryPath || "").replace(/^\/+/, "");
  const modelUrl = path ? "jar:" + zipUrl + "!/" + path : zipUrl;
  const modelRoot = await loadModelNode(modelUrl);
  return renderModelNodeToPng(modelRoot, iconSize);
}

/**
 * Indique si le rendu WebGL est disponible dans ce contexte.
 * @return {boolean}
 */
export function canRenderFurnitureIcons() {
  return (
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement !== "undefined" &&
    (typeof WebGLRenderingContext !== "undefined" || typeof WebGL2RenderingContext !== "undefined")
  );
}
