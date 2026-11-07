/**
 * skillshot-cinder-fall.js — Cinder Fall 烬陨
 *
 * Vendored from LinearAbiltyCastingThreeJS (MIT, mohamedachrefelouafi).
 * Full live knobs: demos/vendor/linear-ability/config/settings.js → settings.meteor
 * Gallery drives cast via gallery-bridge (no App / character / HUD).
 */
import { mountAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-cinder-fall';
export const title = 'Cinder Fall 烬陨';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema([

]).map((g) => {
  if (g.key === 'color') return { ...g, default: '#ff8a3c' };
  if (g.key === 'length') return { ...g, default: 20 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountAbility(ctx, 'meteor', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
