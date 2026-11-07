/**
 * skillshot-archive-fire.js — Fire 火焰路径 (archive spline ability)
 *
 * Vendored from LinearAbiltyCastingThreeJS archive (MIT, mohamedachrefelouafi).
 * Uses old Ability.spawn(curve) via gallery-bridge.mountArchiveAbility.
 * Full knobs: demos/vendor/linear-ability/config/settings.js → settings.fire
 */
import { mountArchiveAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-archive-fire';
export const title = 'Fire Path 火焰径';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema().map((g) => {
  if (g.key === 'color') return { ...g, default: '#ff6a1a' };
  if (g.key === 'length') return { ...g, default: 14 };
  if (g.key === 'recastInterval') return { ...g, default: 5 };
  if (g.key === 'intensity') return { ...g, default: 1.15 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountArchiveAbility(ctx, 'fire', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
