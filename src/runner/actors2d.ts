import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { Color3 } from "@babylonjs/core/Maths/math.js";
import type { Scene } from "@babylonjs/core/scene.js";

/** Original transparent drawings, facing the camera within the unchanged 3D world. */
export function createRunnerSprite(scene:Scene,name:string,size:number){
  const root=MeshBuilder.CreatePlane(name,{size},scene);
  root.billboardMode=Mesh.BILLBOARDMODE_ALL;root.isPickable=false;
  const material=new StandardMaterial(`${name}-ink`,scene);
  material.disableLighting=true;material.backFaceCulling=false;
  material.emissiveColor=Color3.White();material.specularColor=Color3.Black();
  material.useAlphaFromDiffuseTexture=true;material.transparencyMode=StandardMaterial.MATERIAL_ALPHATESTANDBLEND;
  root.material=material;
  const sheets=new Map<string,Texture>();
  function frame(path:string,index:number,columns:number,rows:number){
    let texture=sheets.get(path);
    if(!texture){texture=new Texture(path,scene,false,true,Texture.TRILINEAR_SAMPLINGMODE);texture.hasAlpha=true;texture.wrapU=texture.wrapV=Texture.CLAMP_ADDRESSMODE;sheets.set(path,texture);}
    texture.uScale=1/columns;texture.vScale=1/rows;
    texture.uOffset=(index%columns)/columns;texture.vOffset=1-(Math.floor(index/columns)+1)/rows;
    material.diffuseTexture=material.emissiveTexture=texture;
  }
  return {root,frame};
}
