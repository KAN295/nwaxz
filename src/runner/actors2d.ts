import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";

/**
 * The generated sheets carry near-invisible coloured speckles (alpha < ~20) around each
 * drawing. Texture filtering smears those into red/yellow halos, so drop them before upload.
 * The original PNG bytes on disk are untouched.
 */
export function cleanSheet(image: HTMLImageElement, threshold = 40): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] < threshold) px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL("image/png");
}

export function sheetTexture(scene: Scene, url: string) {
  const texture = new Texture(url, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.hasAlpha = true;
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  return texture;
}

/** A flat original drawing standing upright in the 3D world, turning around Y to face the camera. */
export function createRunnerSprite(scene: Scene, name: string, size: number) {
  const root = MeshBuilder.CreatePlane(name, { size }, scene);
  root.billboardMode = Mesh.BILLBOARDMODE_Y;
  root.isPickable = false;
  const material = new StandardMaterial(`${name}-ink`, scene);
  material.disableLighting = true;
  material.backFaceCulling = false;
  // With lighting disabled the drawing shows at emissiveColor × texture, so emissiveColor is the tint.
  material.emissiveColor = Color3.White();
  material.specularColor = Color3.Black();
  material.useAlphaFromDiffuseTexture = true;
  material.transparencyMode = StandardMaterial.MATERIAL_ALPHATESTANDBLEND;
  material.alphaCutOff = .35;
  root.material = material;
  let current: Texture | undefined;
  function region(texture: Texture, u: number, v: number, width: number, height: number) {
    // Each sprite owns its textures, so the UV window can be set on the texture itself.
    texture.uScale = width; texture.vScale = height;
    texture.uOffset = u; texture.vOffset = 1 - v - height;
    if (current !== texture) { material.diffuseTexture = texture; current = texture; }
  }
  function frame(texture: Texture, index: number, columns: number, rows: number) {
    region(texture, (index % columns) / columns, Math.floor(index / columns) / rows, 1 / columns, 1 / rows);
  }
  function tint(level: number) { material.emissiveColor.set(level, level, level); }
  return { root, material, frame, region, tint };
}
