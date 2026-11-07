/**
 * skillshot-archive-water.js — Water 水径 (archive spline ability)
 *
 * Vendored from LinearAbiltyCastingThreeJS archive (MIT).
 * Full knobs: settings.water
 */
import { mountArchiveAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-archive-water';
export const title = 'Water Path 水径';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema().map((g) => {
  if (g.key === 'color') return { ...g, default: '#31b6ff' };
  if (g.key === 'length') return { ...g, default: 14 };
  if (g.key === 'recastInterval') return { ...g, default: 5 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountArchiveAbility(ctx, 'water', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
