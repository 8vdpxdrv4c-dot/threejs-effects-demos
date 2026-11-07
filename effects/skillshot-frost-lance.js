/**
 * skillshot-frost-lance.js — Frost Lance 霜矛
 *
 * Vendored from LinearAbiltyCastingThreeJS (MIT, mohamedachrefelouafi).
 * Full live knobs: demos/vendor/linear-ability/config/settings.js → settings.ice
 * Gallery drives cast via gallery-bridge (no App / character / HUD).
 */
import { mountAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-frost-lance';
export const title = 'Frost Lance 霜矛';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema([

]).map((g) => {
  if (g.key === 'color') return { ...g, default: '#5fd0ff' };
  if (g.key === 'length') return { ...g, default: 15 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountAbility(ctx, 'ice', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
