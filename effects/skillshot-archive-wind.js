/**
 * skillshot-archive-wind.js — Wind 风丝 / 龙卷 (archive spline ability)
 *
 * Vendored from LinearAbiltyCastingThreeJS archive (MIT).
 * Full knobs: settings.wind
 */
import { mountArchiveAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-archive-wind';
export const title = 'Wind Path 风丝径';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema().map((g) => {
  if (g.key === 'color') return { ...g, default: '#c9f0ff' };
  if (g.key === 'length') return { ...g, default: 16 };
  if (g.key === 'recastInterval') return { ...g, default: 5 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountArchiveAbility(ctx, 'wind', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
