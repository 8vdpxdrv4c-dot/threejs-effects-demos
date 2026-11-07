/**
 * skillshot-storm-lance.js — Storm Lance 风暴矛
 *
 * Vendored from LinearAbiltyCastingThreeJS (MIT, mohamedachrefelouafi).
 * Full live knobs: demos/vendor/linear-ability/config/settings.js → settings.thunder
 * Gallery drives cast via gallery-bridge (no App / character / HUD).
 */
import { mountAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-storm-lance';
export const title = 'Storm Lance 风暴矛';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema([

]).map((g) => {
  if (g.key === 'color') return { ...g, default: '#7fb4ff' };
  if (g.key === 'length') return { ...g, default: 24 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountAbility(ctx, 'thunder', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
