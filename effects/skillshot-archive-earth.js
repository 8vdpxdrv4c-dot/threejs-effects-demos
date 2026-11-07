/**
 * skillshot-archive-earth.js — Earth 岩土 (archive spline ability)
 *
 * Vendored from LinearAbiltyCastingThreeJS archive (MIT).
 * Full knobs: settings.earth
 */
import { mountArchiveAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-archive-earth';
export const title = 'Earth Path 岩土径';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema().map((g) => {
  if (g.key === 'color') return { ...g, default: '#b98a4d' };
  if (g.key === 'length') return { ...g, default: 12 };
  if (g.key === 'recastInterval') return { ...g, default: 6 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountArchiveAbility(ctx, 'earth', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
