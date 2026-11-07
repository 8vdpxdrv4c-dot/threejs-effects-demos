/**
 * skillshot-voltaic-snare.js — Voltaic Snare 伏特陷阱
 *
 * Vendored from LinearAbiltyCastingThreeJS (MIT, mohamedachrefelouafi).
 * Full live knobs: demos/vendor/linear-ability/config/settings.js → settings.snare
 * Gallery drives cast via gallery-bridge (no App / character / HUD).
 */
import { mountAbility, skillshotGuiSchema } from '../vendor/linear-ability/gallery-bridge.js';

export const id = 'skillshot-voltaic-snare';
export const title = 'Voltaic Snare 伏特陷阱';
export const category = 'skillshot';

export const guiSchema = skillshotGuiSchema([
  { key: 'zoneRadius', label: '圈半径 Zone R', min: 2, max: 8, step: 0.1, default: 4.4 },
]).map((g) => {
  if (g.key === 'color') return { ...g, default: '#a98bff' };
  if (g.key === 'length') return { ...g, default: 20 };
  return g;
});

let handle = null;

export function create(ctx, params) {
  handle?.dispose();
  handle = mountAbility(ctx, 'snare', params);
}

export function update(dt, params, _ctx) {
  handle?.update(dt, params);
}

export function dispose() {
  handle?.dispose();
  handle = null;
}
