import { Mesh } from "@babylonjs/core/Meshes/mesh.js";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData.js";
import type { Scene } from "@babylonjs/core/scene.js";

/** Several curved sheets form each tongue, keeping a flame silhouette from every viewing angle. */
export function flameMesh(scene: Scene, reverse: boolean) {
  const positions: number[] = [], indices: number[] = [], uvs: number[] = [], normals: number[] = [];
  const widthSteps = 4, heightSteps = 7;
  for (let layer = 0; layer < 3; layer++) {
    const angle = layer * Math.PI / 3, sin = Math.sin(angle), cos = Math.cos(angle);
    const start = positions.length / 3;
    for (let j = 0; j <= heightSteps; j++) {
      const v = j / heightSteps;
      for (let i = 0; i <= widthSteps; i++) {
        const u = i / widthSteps;
        const side = u * 2 - 1;
        const x = side * (.5 - v * .1) + .1 * v * v * Math.sin(layer * 2.3 + v * 2);
        const z = (1 - side * side) * (.07 + v * .12) * (layer % 2 ? -1 : 1);
        positions.push(x * cos + z * sin, v, z * cos - x * sin);
        uvs.push(.17 + .66 * (reverse ? 1 - u : u), .045 + v * .925);
        if (i < widthSteps && j < heightSteps) {
          const a = start + j * (widthSteps + 1) + i, b = a + widthSteps + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions; data.indices = indices; data.normals = normals; data.uvs = uvs;
  const mesh = new Mesh("flame-volume", scene);
  data.applyToMesh(mesh);
  mesh.isPickable = false;
  return mesh;
}
