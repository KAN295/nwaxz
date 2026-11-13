import { Engine } from "@babylonjs/core/Engines/engine.js";
import { Scene } from "@babylonjs/core/scene.js";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera.js";
import { Vector3,Color3,Color4 } from "@babylonjs/core/Maths/math.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import { Texture } from "@babylonjs/core/Materials/Textures/texture.js";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight.js";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight.js";
import { PointLight } from "@babylonjs/core/Lights/pointLight.js";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator.js";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js";
import type { Settings } from "../settings.ts";
import { withTimeout } from "../loading.ts";
import { createRunnerSprite } from "./actors2d.ts";
import { dogPose,chaserFrame } from "./animation.ts";
import { RunnerRoute3D } from "./route3d.ts";
import { RUN_SCENES, type RunnerWorld, type RunItem } from "./world.ts";

const NIGHT=["aqueduct-night-v1.png","temple-night-v1.png","mine-night-v1.png"];
export class RunnerRenderer3D {
  readonly engine:Engine;
  readonly scene:Scene;
  readonly camera:UniversalCamera;
  readonly dog;
  private shadow:ShadowGenerator;
  private sun:DirectionalLight;
  private ambient:HemisphericLight;
  private route=new RunnerRoute3D();
  private lastWorld?:RunnerWorld;
  private tiles:{root:TransformNode;lanes:Mesh[];biomes:TransformNode[]}[]=[];
  private props=new Map<number,TransformNode>();
  private textures=new Map<string,Texture>();
  private stone:StandardMaterial;
  private wood:StandardMaterial;
  private metal:StandardMaterial;
  private crevasse:StandardMaterial;
  private ground:StandardMaterial[]=[];
  private flame:StandardMaterial;
  private gold:StandardMaterial;
  private lamps:PointLight[]=[];
  private lampBulb:StandardMaterial;
  private background:Mesh;
  private backgroundMat:StandardMaterial;
  private day:Texture[]=[];
  private night:Texture[]=[];
  readonly chaserSprite;
  private rain:Mesh[]=[];
  private snow:Mesh[]=[];
  private disposed=false;
  private weatherTime=0;
  constructor(private canvas:HTMLCanvasElement,private settings:Settings){
    this.engine=new Engine(canvas,true,{stencil:false,powerPreference:"high-performance",preserveDrawingBuffer:false},false);
    this.scene=new Scene(this.engine);this.scene.clearColor=new Color4(.35,.47,.49,1);
    this.scene.fogMode=Scene.FOGMODE_EXP2;this.scene.fogDensity=.009;this.scene.fogColor=new Color3(.45,.56,.54);
    this.camera=new UniversalCamera("runner-chase-camera",new Vector3(0,4.8,-10),this.scene);this.camera.minZ=.1;this.camera.maxZ=220;this.camera.fov=.92;
    this.ambient=new HemisphericLight("runner-ambient",new Vector3(0,1,0),this.scene);this.ambient.intensity=.8;this.ambient.groundColor.set(.34,.3,.24);
    this.sun=new DirectionalLight("runner-day-night-key",new Vector3(-.35,-.8,.45),this.scene);this.sun.position.set(14,24,-12);this.sun.intensity=1.05;
    this.shadow=new ShadowGenerator(settings.quality==="high"?1024:512,this.sun);this.shadow.usePercentageCloserFiltering=true;this.shadow.bias=.001;this.shadow.normalBias=.04;this.shadow.setDarkness(.3);
    this.stone=this.material("stone","#ffffff","/assets/runner/wet-stone-v1.png");
    this.wood=this.material("aged-wood","#ffffff","/assets/materials/escape/04-aged-wood-v1.png");
    this.metal=this.material("rusted-metal","#9e9e9e","/assets/materials/escape/08-rusted-iron-v1.png");
    this.crevasse=this.material("deep-crevasse","#122027","/assets/materials/escape/05-basement-wall-v1.png");
    this.ground=[this.material("aqueduct-paving","#f0e9d2","/assets/runner/wet-stone-v1.png"),this.material("temple-paving","#dad5c4","/assets/materials/escape/06-basement-floor-v1.png"),this.material("mine-gravel","#a59980","/assets/materials/escape/07-basement-ceiling-v1.png")];
    this.flame=this.material("flame-emission","#ffad3b");this.flame.emissiveColor.set(1,.28,.035);this.flame.alpha=.8;
    this.gold=this.material("collectible-brass","#f5cd57");this.gold.emissiveColor.set(.2,.12,.015);
    this.lampBulb=this.material("lamp-glass","#ffe3a0");this.lampBulb.emissiveColor.set(1,.7,.24);
    this.dog=createRunnerSprite(this.scene,"runner-milk-dog-2d",3.0);
    this.chaserSprite=createRunnerSprite(this.scene,"runner-milk-frog-2d",4.8);
    this.dog.frame("/assets/runner/milk-dog-actions-v2.png",0,4,2);
    this.chaserSprite.frame("/assets/character/haunted-frog-directions-walk-v1.webp",4,4,4);
    this.backgroundMat=this.material("photographic-distant-environment","#ffffff");this.backgroundMat.disableLighting=true;this.backgroundMat.backFaceCulling=false;this.backgroundMat.fogEnabled=false;
    this.background=MeshBuilder.CreatePlane("distant-environment-matte",{width:300,height:190},this.scene);this.background.material=this.backgroundMat;this.background.isPickable=false;this.background.billboardMode=Mesh.BILLBOARDMODE_ALL;
    this.buildRoad();this.buildWeather();this.resize();
  }
  private texture(path:string){
    let texture=this.textures.get(path);if(texture)return texture;
    texture=new Texture(path,this.scene,false,true,Texture.TRILINEAR_SAMPLINGMODE);texture.anisotropicFilteringLevel=4;
    this.textures.set(path,texture);return texture;
  }
  private material(name:string,color:string,path?:string){const m=new StandardMaterial(`runner-${name}`,this.scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor.set(.13,.13,.13);m.specularPower=24;m.maxSimultaneousLights=5;if(path)m.diffuseTexture=this.texture(path);return m;}
  private box(name:string,parent:TransformNode,size:number[],position:number[],material:StandardMaterial){
    const m=MeshBuilder.CreateBox(name,{width:size[0],height:size[1],depth:size[2]},this.scene);m.parent=parent;m.position.set(position[0],position[1],position[2]);m.material=material;m.receiveShadows=true;m.isPickable=false;return m;
  }
  private sphere(name:string,parent:TransformNode,size:number[],position:number[],material:StandardMaterial){const m=MeshBuilder.CreateSphere(name,{diameter:1,segments:14},this.scene);m.parent=parent;m.scaling.set(size[0],size[1],size[2]);m.position.set(position[0],position[1],position[2]);m.material=material;m.isPickable=false;return m;}
  private buildRoad(){
    for(let i=0;i<35;i++){
      const root=new TransformNode(`road-section-${i}`,this.scene);
      const lanes=[0,1,2].map(l=>this.box("paved-track-lane",root,[2.48,.32,4.12],[(l-1)*2.5,-.16,0],this.ground[0]));
      const biomes=[0,1,2].map(theme=>{
        const group=new TransformNode(`route-theme-${theme}`,this.scene);group.parent=root;
        if(theme===0){
          for(const side of [-1,1]){this.box("aqueduct-stone-kerb",group,[.3,.4,4.1],[side*4,.1,0],this.stone);this.box("aqueduct-rail",group,[.24,.16,4.1],[side*4,1.1,0],this.stone);for(const z of [-1.5,0,1.5])this.box("aqueduct-baluster",group,[.18,1.05,.18],[side*4,.5,z],this.stone);}
        }else if(theme===1&&i%3===0){
          for(const side of [-1,1])this.box("temple-column",group,[.7,5,.7],[side*4.5,2.4,0],this.stone);
          const arc=MeshBuilder.CreateTube("real-temple-arch",{path:Array.from({length:17},(_,k)=>new Vector3(Math.cos(k/16*Math.PI)*4.5,5+Math.sin(k/16*Math.PI)*2,0)),radius:.32,tessellation:8},this.scene);arc.parent=group;arc.material=this.stone;
        }else if(theme===2){
          for(const side of [-1,1]){
            this.box("flush-mine-rail",group,[.08,.055,4.12],[side*.9,.015,0],this.metal);
            this.box("mine-rock-wall",group,[2.5,8,4.15],[side*5.8,3.5,0],this.stone);
            if(i%2===0)this.box("mine-support-post",group,[.3,6.3,.3],[side*4.4,3.0,0],this.wood);
          }
          if(i%2===0)this.box("mine-ceiling-beam",group,[9.1,.35,.35],[0,6.1,0],this.wood);
        }
        return group;
      });
      if(i%3===0){
        for(const side of [-1,1]){this.box("street-lamp-post",root,[.10,3.9,.10],[side*4.2,1.95,0],this.metal);this.box("street-lamp-lantern",root,[.35,.5,.35],[side*4.2,4,0],this.lampBulb);this.box("street-lamp-cap",root,[.52,.1,.52],[side*4.2,4.3,0],this.metal);}
      }
      this.tiles.push({root,lanes,biomes});
    }
    for(let i=0;i<4;i++){const light=new PointLight(`near-road-lamp-${i}`,Vector3.Zero(),this.scene);light.diffuse=new Color3(1,.78,.46);light.range=23;this.lamps.push(light);}
    const river=this.material("canyon-river","#739b92","/assets/runner/aqueduct-scene-v1.png");
    const waterTexture=(river.diffuseTexture as Texture).clone();river.diffuseTexture=waterTexture;
    waterTexture.uScale=.12;waterTexture.uOffset=.03;waterTexture.vScale=.18;waterTexture.vOffset=.02;river.specularColor.set(.6,.7,.7);
    const abyss=this.box("deep-canyon-river",new TransformNode("abyss",this.scene),[500,.3,500],[0,-12,0],river);abyss.material!.backFaceCulling=false;
  }
  private buildWeather(){
    const rain=this.material("rain-drops","#b4e0ef");rain.emissiveColor.set(.35,.48,.55);rain.alpha=.45;
    const snow=this.material("snow-flakes","#ffffff");snow.emissiveColor.set(.5,.5,.5);snow.alpha=.82;
    for(let i=0;i<100;i++){
      const r=MeshBuilder.CreateBox(`rain-${i}`,{width:.012,height:.5,depth:.012},this.scene);r.material=rain;this.rain.push(r);
      const s=MeshBuilder.CreateSphere(`snow-${i}`,{diameter:.055+(i%3)*.018,segments:4},this.scene);s.material=snow;this.snow.push(s);
    }
  }
  async load(){
    this.day=RUN_SCENES.map(s=>this.texture(s.image));this.night=NIGHT.map(file=>this.texture(`/assets/runner/${file}`));
    for(const texture of [...this.day,...this.night]){texture.vScale=.75;texture.vOffset=.25;texture.wrapV=Texture.CLAMP_ADDRESSMODE;}
    // Preload both dog atlases and the original belly-laugh drawing before play.
    this.dog.frame("/assets/runner/milk-dog-run-v2.png",0,4,2);
    this.chaserSprite.frame("/assets/character/milk-frog-atlas.webp",6,4,2);
    await withTimeout(this.scene.whenReadyAsync(),"3D场景准备超时，请重试。");
  }
  resize(){if(this.disposed)return;const rect=this.canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio||1,this.settings.quality==="high"?2:1.5);this.engine.setSize(Math.max(1,Math.round(rect.width*ratio)),Math.max(1,Math.round(rect.height*ratio)));}
  private makeProp(item:RunItem){
    const root=new TransformNode(`runner-item-${item.id}-${item.kind}`,this.scene),wide=item.span===3?7.8:1.9;
    if(item.kind==="coin"){
      const coin=MeshBuilder.CreateCylinder("brass-coin",{diameter:.48,height:.09,tessellation:20},this.scene);coin.parent=root;coin.rotation.x=Math.PI/2;coin.position.y=.9;coin.material=this.gold;
    }else if(["magnet","shield","boost"].includes(item.kind)){
      const shape=item.kind==="shield"?MeshBuilder.CreateSphere("shield-pickup",{diameter:.8,segments:16},this.scene):MeshBuilder.CreateTorus(item.kind,{diameter:.7,thickness:.16,tessellation:16},this.scene);shape.parent=root;shape.position.y=1;shape.material=this.gold;
    }else if(item.kind==="beam"){
      this.box("low-gate-bar",root,[wide,.4,.45],[0,1.18,0],this.metal);
      for(const side of [-1,1])this.box("gate-side-post",root,[.13,1.55,.2],[side*wide*.48,.7,0],this.metal);
    }else if(item.kind==="gap"||item.kind==="cliff"){
      for(const z of [-1,1])this.box("visible-broken-stone-lip",root,[wide,.18,.25],[0,.07,z*(item.kind==="cliff"?4.5:1.7)],this.stone);
      this.box("deep-fracture",root,[wide,5,item.kind==="cliff"?9:3.5],[0,-2.8,0],this.crevasse);
      for(const side of [-1,1])this.box("crack-warning-edge",root,[.14,.08,item.kind==="cliff"?9:3.5],[side*wide/2,.06,0],this.gold);
    }else if(item.kind==="spikes"){
      this.box("spike-trap-base",root,[wide,.12,1.8],[0,.04,0],this.metal);
      for(let x=-wide/2+.25;x<wide/2;x+=.48)for(const z of [-.5,.3]){const spike=MeshBuilder.CreateCylinder("ground-spike",{diameterTop:0,diameterBottom:.24,height:.75,tessellation:8},this.scene);spike.parent=root;spike.position.set(x,.5,z);spike.material=this.metal;}
    }else if(item.kind==="boulder"){
      const rock=MeshBuilder.CreatePolyhedron("large-textured-boulder",{type:1,size:1.1},this.scene);rock.parent=root;rock.position.y=1.1;rock.scaling.set(1.1,1.25,1.1);rock.material=this.stone;
    }else if(item.kind==="fire"){
      this.box("burning-trench",root,[wide,.15,1.4],[0,.05,0],this.wood);
      for(let x=-wide/2+.2;x<wide/2;x+=.45)this.sphere("fire-tongue",root,[.42,1.3,.45],[x,.75,0],this.flame);
    }else if(item.span===3){
      const log=MeshBuilder.CreateCylinder("fallen-log",{diameter:.85,height:wide,tessellation:18},this.scene);log.parent=root;log.rotation.z=Math.PI/2;log.position.y=.45;log.material=this.wood;
    }else{
      const box=this.box("wooden-obstacle",root,[1.75,1.0,1.4],[0,.5,0],this.wood);this.shadow.addShadowCaster(box);
      for(const z of [-.65,.65])this.box("crate-iron-band",root,[1.82,.14,.1],[0,.72,z],this.metal);
    }
    return root;
  }
  draw(world:RunnerWorld){
    if(this.disposed)return;
    if(this.lastWorld!==world){this.route=new RunnerRoute3D();for(const prop of this.props.values())prop.dispose(false,false);this.props.clear();this.lastWorld=world;}
    this.route.sync(world.turns,world.distance);
    const center=this.route.sample(world.distance),heading=center.heading;
    const place=(distance:number,lane=1)=>{const p=this.route.sample(distance);return {x:p.x-center.x+Math.cos(p.heading)*(lane-1)*2.5,z:p.z-center.z-Math.sin(p.heading)*(lane-1)*2.5,heading:p.heading};};
    const capture=world.phase==="caught"||world.phase==="lost"||world.phase==="paused"&&world.reason!=="";
    const t=world.elapsed;
    const weather=world.weather,night=world.night;
    this.weatherTime=t;
    this.ambient.intensity=night?.72:weather==="sunny"?.85:.88;this.sun.intensity=night?.45:weather==="rain"?.6:1.0;
    this.sun.diffuse=night?new Color3(.72,.82,1):new Color3(1,.93,.8);
    this.scene.fogColor=night?new Color3(.19,.25,.35):weather==="snow"?new Color3(.73,.77,.78):weather==="rain"?new Color3(.4,.47,.49):new Color3(.58,.67,.65);
    this.scene.fogDensity=weather==="sunny"?.006:.012;
    this.backgroundMat.emissiveTexture=this.backgroundMat.diffuseTexture=(night?this.night:this.day)[world.sceneIndex];
    this.backgroundMat.emissiveColor.setAll(1);
    const first=Math.floor((world.distance-16)/4)*4;
    this.tiles.forEach((tile,i)=>{
      const distance=first+i*4,p=place(distance),theme=((Math.floor(Math.max(0,distance)/450)+world.startScene)%3);
      tile.root.position.set(p.x,0,p.z);tile.root.rotation.y=p.heading;
      tile.biomes.forEach((group,index)=>group.setEnabled(!capture&&theme===index));
      tile.lanes.forEach((mesh,lane)=>{
        const hole=world.items.some(item=>(item.kind==="gap"||item.kind==="cliff")&&(item.span===3||item.lane===lane)&&Math.abs(item.z-distance)<(item.kind==="cliff"?5.1:2.4));
        mesh.setEnabled(!hole);mesh.material=this.ground[theme];
      });
    });
    this.ground.forEach(m=>m.diffuseColor.setAll(weather==="snow"?1.28:night?.95:1));
    for(let i=0;i<this.lamps.length;i++){const p=place(world.distance+4+i*12);this.lamps[i].position.set(p.x+Math.cos(p.heading)*(i%2?4:-4),3.8,p.z-Math.sin(p.heading)*(i%2?4:-4));this.lamps[i].intensity=night?2.4:.12;}
    const visible=new Set(world.items.filter(item=>!item.done&&item.z>world.distance-6&&item.z<world.distance+105).map(item=>item.id));
    for(const [id,root]of this.props)if(!visible.has(id)){root.dispose(false,false);this.props.delete(id);}
    for(const item of world.items){if(!visible.has(item.id))continue;let prop=this.props.get(item.id);if(!prop){prop=this.makeProp(item);this.props.set(item.id,prop);}prop.setEnabled(!capture);const p=place(item.z,item.span===3?1:item.lane);prop.position.set(p.x,0,p.z);prop.rotation.y=p.heading;if(item.kind==="coin")prop.rotation.y+=t*1.7;if(item.kind==="fire")for(const mesh of prop.getChildMeshes())if(mesh.name==="fire-tongue")mesh.scaling.y=1+Math.sin(t*9+mesh.position.x)*.18;}
    const player=place(world.distance,world.position);
    const pose=dogPose(world,this.settings.reducedMotion);
    this.dog.frame(`/assets/runner/milk-dog-${pose.sheet==="run"?"run":"actions"}-v2.png`,pose.frame,4,2);
    this.dog.root.position.set(player.x,1.48+world.jumpHeight*1.5,player.z);
    let close=world.danger>0?world.danger/8:Math.max(0,1-t/4);
    if(capture)close=1;
    const enemy=place(world.distance-1.4-(1-close)*4,world.position);
    const frog=this.chaserSprite.root;
    frog.scaling.setAll(capture?1:.7);
    frog.position.set(enemy.x+Math.cos(enemy.heading)*1.35,1.85,enemy.z-Math.sin(enemy.heading)*1.35);
    frog.visibility=close>0?Math.min(1,close*2):0;
    this.chaserSprite.frame("/assets/character/haunted-frog-directions-walk-v1.webp",chaserFrame(world,this.settings.reducedMotion),4,4);
    if(capture){
      const progress=Math.min(1,world.captureTime/1.5),smooth=progress*progress*(3-2*progress);
      this.chaserSprite.frame("/assets/character/milk-frog-atlas.webp",6,4,2);
      frog.position.set(0,1.85,0);
      const front=new Vector3(Math.sin(heading),0,Math.cos(heading)),right=new Vector3(Math.cos(heading),0,-Math.sin(heading));
      // Keep the familiar drawn dog and laughing frog; lift the whole dog drawing.
      this.dog.root.position.copyFrom(Vector3.Lerp(new Vector3(player.x,1.48,player.z),front.scale(.6).add(new Vector3(0,5.2,0)),smooth));
      this.camera.position.copyFrom(front.scale(8.5).add(right.scale(2.2)).add(new Vector3(0,3.1,0)));this.camera.setTarget(new Vector3(0,3.0,0));
    }else{
      const forward=new Vector3(Math.sin(heading),0,Math.cos(heading));
      const follow=this.engine.getRenderWidth()/this.engine.getRenderHeight()<.9?.95:.35;
      const lateral=new Vector3(player.x,0,player.z).scale(follow);
      const target=lateral.add(new Vector3(0,1.35,0)).add(forward.scale(7));
      const cameraPosition=lateral.add(new Vector3(0,4.6,0)).subtract(forward.scale(9.5));
      if(!this.settings.reducedMotion&&world.stumble>0)cameraPosition.x+=Math.sin(t*50)*.06;
      this.camera.position.copyFrom(cameraPosition);this.camera.setTarget(target);
    }
    this.background.position.copyFrom(this.camera.position.add(this.camera.getTarget().subtract(this.camera.position).normalize().scale(170)));
    this.rain.forEach((mesh,i)=>{mesh.setEnabled(weather==="rain");if(weather!=="rain")return;const p=place(world.distance+(i*7.31)%42-10);mesh.position.set(p.x+((i*3.7)%18-9),((i*1.73-t*12)%12+12)%12,p.z);mesh.rotation.z=.12;});
    this.snow.forEach((mesh,i)=>{mesh.setEnabled(weather==="snow");if(weather!=="snow")return;const p=place(world.distance+(i*5.13)%40-10);mesh.position.set(p.x+((i*4.7)%18-9)+Math.sin(t*.8+i)*.3,((i*1.77-t*1.8)%11+11)%11,p.z);});
    this.engine.beginFrame();this.scene.render();this.engine.endFrame();
  }
  get usable(){return !this.disposed&&!this.engine._gl?.isContextLost();}
  dispose(){if(this.disposed)return;this.disposed=true;this.scene.dispose();this.engine.dispose();}
}
