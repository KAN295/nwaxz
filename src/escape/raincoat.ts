export const RAINCOAT_ACTIONS = ['idle', 'walk', 'run', 'crouch', 'sneak'] as const;
export type RaincoatAction = typeof RAINCOAT_ACTIONS[number];
export const raincoatSheet = (action: RaincoatAction) => `/assets/character/raincoat-v2/${action}.webp`;
const STRIDE_METRES = { idle: 0, crouch: 0, walk: 1.55, run: 2.65, sneak: 1.05 };

export function raincoatAction(moving: boolean, crouched: boolean, sprinting: boolean): RaincoatAction {
  if (crouched) return moving ? 'sneak' : 'crouch';
  return moving ? (sprinting ? 'run' : 'walk') : 'idle';
}

/** One cycle is one left and one right step. Movement is measured in world metres. */
export function advanceRaincoatPhase(action: RaincoatAction, phase: number, metres: number, seconds: number) {
  const stride = STRIDE_METRES[action];
  const cycles = stride ? metres / stride : seconds / (action === 'idle' ? 3.6 : 2.9);
  return ((phase + cycles) % 1 + 1) % 1;
}
