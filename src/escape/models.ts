import type { AssetContainer } from "@babylonjs/core/assetContainer.js";
import type { Scene } from "@babylonjs/core/scene.js";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh.js";
import type { Material } from "@babylonjs/core/Materials/material.js";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode.js";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder.js";
import { Vector3, Color3 } from "@babylonjs/core/Maths/math.js";
import { PaintedFrog, type FrogTextures } from "./frog.ts";
import { CELL, colorMaterial } from "./scene.ts";
import { CRYSTALS, PROPS, VALVE_ORDER, type EscapeWorld } from "./world.ts";
import { floorAt, floorYAt } from "./basement-map.ts";

const EXPANSION_PROP_IDS = new Set(["changing-drawer", "changing-hide", "boiler-note", "boiler-hide", ...VALVE_ORDER]);

export function installEscapeModels(scene: Scene, props: AssetContainer, textures: FrogTextures, reduced = false) {
  const propRoots = new Map<string, TransformNode>();
  const cabinets = new Map<string, { left: TransformNode; right: TransformNode }>();
  const wheels = new Map<string, TransformNode>();
  let drainWheel: TransformNode | undefined;
  const valveLamps = new Map<string, ReturnType<typeof MeshBuilder.CreateSphere>>();
  const powerLamps = new Map<string, ReturnType<typeof MeshBuilder.CreateSphere>>();
  const powerMaterials = new Map<string, Material & { emissiveColor: Color3 }>();
  const crystals = new Map<string, ReturnType<typeof MeshBuilder.CreatePolyhedron>>();
  const crystalMaterials = new Map<string, ReturnType<typeof colorMaterial>>();
  // Small translucent shards with a soft inner glow, not flat self-lit blocks.
  for (const [kind, color] of [["freeze", "#8be5ff"], ["reveal", "#e49aff"], ["ward", "#a5e0a2"]] as const) {
    const material = colorMaterial(scene, `crystal-${kind}`, color, true);
    material.emissiveColor = material.diffuseColor.scale(.38); material.alpha = .82;
    material.specularColor.set(.9, .95, 1); material.specularPower = 48;
    crystalMaterials.set(kind, material);
  }
  for (const crystal of CRYSTALS) {
    const mesh = MeshBuilder.CreatePolyhedron(`crystal:${crystal.id}`, { type: 1, size: .13 }, scene);
    mesh.scaling.set(.8, 1.7, .8);
    mesh.position.set(crystal.x * CELL, floorYAt(crystal) + .42, crystal.z * CELL); mesh.material = crystalMaterials.get(crystal.kind)!; mesh.isPickable = false;
    crystals.set(crystal.id, mesh);
  }
  const lampColors: Record<string, string> = { "valve-cold": "#74b9ce", "valve-return": "#d2a655", "valve-vent": "#c6c8b6", "basement-sluice": "#875c53" };
  const readyLamp = colorMaterial(scene, "valve-state-ready", "#52bf75", true);
  const powerOffLamp = colorMaterial(scene, "power-state-off", "#87443c", true);
  const idleLamps = new Map(Object.entries(lampColors).map(([id, color]) => [id, colorMaterial(scene, `valve-state-${id}`, color, true)]));
  const sources = [...props.transformNodes, ...props.meshes];
  for (const object of PROPS) {
    if (object.kind === "note") continue;
    const name = object.kind === "power" ? "fusebox" : object.kind === "exit" ? "grate" : object.kind;
    const source = sources.find(n => n.name === name);
    if (!source) throw new Error(`Missing solid prop ${name}`);
    const clone = source.clone(`prop:${object.id}`, null, false) as TransformNode;
    const ground = floorYAt(object);
    clone.position.set(object.x * CELL, ground + (object.kind === "power" ? .75 : object.kind === "valve" ? .35 : 0), object.z * CELL);
    if (object.kind === "exit") {
      clone.rotation.y = Math.PI; clone.position.z = 23 * CELL - .04;
      // The source prop also supports a closed decorative grate. Here its
      // backing is disabled so the real sewer crawlway remains visible.
      for (const mesh of clone.getChildMeshes()) if (mesh.material?.name === "wood_interior") mesh.setEnabled(false);
    }
    propRoots.set(object.id, clone);
    for (const mesh of clone.getChildMeshes()) { mesh.receiveShadows = true; mesh.isPickable = false; }
    if (object.kind === "power") {
      for (const mesh of clone.getChildMeshes()) if (mesh.material?.name === "fuse_on_green") {
        const material = powerMaterials.get(object.id) ?? mesh.material.clone(`fuse-indicator:${object.id}`);
        if (material && "emissiveColor" in material) {
          mesh.material = material;
          powerMaterials.set(object.id, material as typeof material & { emissiveColor: Color3 });
        }
      }
      const lamp = MeshBuilder.CreateSphere(`power-state:${object.id}`, { diameter: .12 }, scene);
      lamp.position.set(object.x * CELL, ground + 1.6, object.z * CELL + .29);
      lamp.material = powerOffLamp; lamp.isPickable = false; powerLamps.set(object.id, lamp);
    }
    const descendants = clone.getDescendants() as TransformNode[];
    if (object.kind === "wardrobe") {
      const left = descendants.find(n => n.name.includes("wardrobe_door_left"))!, right = descendants.find(n => n.name.includes("wardrobe_door_right"))!;
      if (!left || !right) throw new Error("Missing cabinet hinges");
      left.rotationQuaternion = right.rotationQuaternion = null;
      cabinets.set(object.id, { left, right });
    }
    if (object.kind === "valve" && object.id === "drain") {
      drainWheel = descendants.find(n => n.name.includes("valve_wheel")); if (drainWheel) drainWheel.rotationQuaternion = null;
    }
    if (object.kind === "valve" && object.id !== "drain") {
      const wheel = descendants.find(n => n.name.includes("valve_wheel"));
      if (wheel) { wheel.rotationQuaternion = null; wheels.set(object.id, wheel); }
      const lamp = MeshBuilder.CreateSphere(`valve-state:${object.id}`, { diameter: .12 }, scene);
      lamp.position.set(object.x * CELL, ground + 1.15, object.z * CELL - .3); lamp.material = idleLamps.get(object.id)!;
      lamp.isPickable = false; valveLamps.set(object.id, lamp);
    }
  }
  const pipe = sources.find(n => n.name === "pipe")!;
  for (const [i, x, z] of [[0, 1.1, 5.5], [1, 9.1, 5.5], [2, 17.1, 15.5], [3, 22.8, 20.5], [4, 18.4, 33.5], [5, 7.5, 42.2]]) {
    const clone = pipe.clone(`pipe:${i}`, null, false) as TransformNode;
    clone.position.set(x * CELL, floorYAt({ x, z }), z * CELL);
  }
  const paper = colorMaterial(scene, "old-readable-paper", "#bdb38b");
  const ink = colorMaterial(scene, "paper-ink", "#39392f");
  for (const note of PROPS.filter(p => p.kind === "note")) {
    const root = new TransformNode(`note:${note.id}`, scene);
    root.position.set(note.x * CELL, floorYAt(note) + .08, note.z * CELL);
    const page = MeshBuilder.CreateBox("paper-sheet", { width: .22, height: .006, depth: .31 }, scene);
    page.parent = root; page.material = paper;
    for (let i = 0; i < 6; i++) {
      const line = MeshBuilder.CreateBox("ink-line", { width: .13 - (i % 2) * .03, height: .001, depth: .007 }, scene);
      line.parent = root; line.position.set(0, .004, -.1 + i * .033); line.material = ink;
    }
    propRoots.set(note.id, root);
  }
  const actor = new PaintedFrog(scene, textures, reduced);
  const actorRoot = actor.root, actorMeshes = actor.meshes;
  let captured = false, stillFor = 1;
  const previous = new Vector3(-100, 0, -100);
  const environment = scene.meshes.filter(m => !actorMeshes.some(actor => actor === m));
  const oldVisibility = new Map<AbstractMesh, boolean>();
  return {
    actorRoot, actorMeshes, cabinets, propRoots, actor,
    animate(world: EscapeWorld, dt: number) {
      const d = world.data, caught = d.phase === "caught" || d.phase === "lost", h = d.hunter;
      for (const crystal of CRYSTALS) {
        const mesh = crystals.get(crystal.id)!;
        mesh.setEnabled(!d.hunt?.collected.includes(crystal.id));
        mesh.rotation.y += dt * 1.2; mesh.position.y = floorYAt(crystal) + .42 + Math.sin(d.elapsed * 2.4 + crystal.x) * .055;
      }
      if (caught !== captured) {
        captured = caught;
        for (const mesh of environment) {
          if (caught) { oldVisibility.set(mesh, mesh.isVisible); mesh.isVisible = false; }
          else mesh.isVisible = oldVisibility.get(mesh) ?? mesh.isVisible;
        }
      }
      actorRoot.position.set(h.x * CELL, floorYAt(h), h.z * CELL);
      stillFor = Vector3.DistanceSquared(actorRoot.position, previous) > .000001 ? 0 : stillFor + dt;
      // A path waypoint may cost one simulation frame. Keep the walking cycle
      // through those brief gaps instead of restarting idle/walk at each tile.
      actor.animate(world, dt, stillFor < .22);
      previous.copyFrom(actorRoot.position);
      for (const [id, doors] of cabinets) {
        // Actual ajar doors, not a slit overlay pasted over the camera.
        const ajar = d.hidden === id ? .115 : .015, blend = 1 - Math.exp(-dt * 9);
        doors.left.rotation.y += (-ajar - doors.left.rotation.y) * blend;
        doors.right.rotation.y += (ajar - doors.right.rotation.y) * blend;
      }
      const valveActive = (id: string) => id === "basement-sluice" ? d.basement.sluice : d.expansion?.valves.includes(id);
      for (const [id, wheel] of wheels) if (valveActive(id)) wheel.rotation.z += dt * 1.7;
      if (drainWheel && d.drained) drainWheel.rotation.z += dt * 1.7;
      for (const [id, lamp] of valveLamps) lamp.material = valveActive(id) ? readyLamp : idleLamps.get(id)!;
      for (const [id, lamp] of powerLamps) {
        const active = id === "basement-relay" ? d.basement.power : d.power;
        lamp.material = active ? readyLamp : powerOffLamp;
        powerMaterials.get(id)?.emissiveColor.set(0, active ? .6 : .015, 0);
      }
      for (const [id, root] of propRoots) {
        const expansionProp = EXPANSION_PROP_IDS.has(id);
        root.setEnabled((!expansionProp || !!d.expansion?.enabled) && (!id.endsWith("note") || !d.notes.includes(id)));
      }
    },
    dispose() { actor.dispose(); for (const material of powerMaterials.values()) material.dispose(); },
  };
}
