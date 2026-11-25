import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase.js";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial.js";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer.js";

export type GroundOpening = [left: number, near: number, right: number, far: number];
export const MAX_GROUND_OPENINGS = 14;

const cuts = Array.from({ length: MAX_GROUND_OPENINGS }, (_, i) => `runnerGroundOpening${i}`);
const fragmentCuts = cuts.map((name, i) => `
  if (runnerGroundOpeningCount > ${i}.0 && all(greaterThan(vPositionW.xz, ${name}.xy)) && all(lessThan(vPositionW.xz, ${name}.zw))) discard;
`).join("");

/** Cuts holes in the flat landscape underneath the track so pit walls and water can show through. */
export class GroundOpenings extends MaterialPluginBase {
  constructor(material: StandardMaterial, private readonly openings: GroundOpening[]) {
    super(material, "RunnerGroundOpenings", 210, undefined, true, true);
  }

  getClassName() { return "RunnerGroundOpenings"; }

  getUniforms() {
    return {
      ubo: [{ name: "runnerGroundOpeningCount", size: 1, type: "float" }, ...cuts.map(name => ({ name, size: 4, type: "vec4" }))],
      fragment: `uniform float runnerGroundOpeningCount;\n${cuts.map(name => `uniform vec4 ${name};`).join("\n")}`,
    };
  }

  bindForSubMesh(buffer: UniformBuffer) {
    buffer.updateFloat("runnerGroundOpeningCount", this.openings.length);
    for (let i = 0; i < this.openings.length; i++) buffer.updateFloat4(cuts[i], ...this.openings[i]);
  }

  getCustomCode(shaderType: string) {
    return shaderType === "fragment" ? { CUSTOM_FRAGMENT_MAIN_BEGIN: fragmentCuts } : null;
  }
}
