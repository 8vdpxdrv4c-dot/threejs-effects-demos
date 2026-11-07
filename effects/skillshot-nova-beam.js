/**
 * skillshot-nova-beam.js — Nova Beam 新星束
 *
 * Vendored from LinearAbiltyCastingThreeJS (MIT, mohamedachrefelouafi).
 * Full live knobs: demos/vendor/linear-ability/config/settings.js → settings.beam
 * Gallery drives cast via gallery-bridge (no App / character / HUD).
 */
import { mountAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-nova-beam';
export const title = 'Nova Beam 新星束';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema([

]).map((g) => {
  if (g.key === 'color') return { ...g, default: '#7ff0ff' };
  if (g.key === 'length') return { ...g, default: 26 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountAbility(ctx, 'beam', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
