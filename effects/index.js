/**
 * effects/index.js — Registry of all demo effects
 * 特效注册表：画廊侧边栏与切换入口
 */
import * as fireworks from './particles-fireworks.js';
import * as fire from './particles-fire.js';
import * as smoke from './particles-smoke.js';
import * as steamPlume from './particles-steam-plume.js';
import * as sparks from './particles-sparks.js';
import * as gasMix from './fluid-gas-mix.js';
import * as gasCollision from './fluid-gas-collision.js';
import * as liquidMix from './fluid-liquid-mix.js';
import * as dissolve from './shader-dissolve.js';
import * as hologram from './shader-hologram.js';
import * as glass from './shader-glass.js';
import * as toon from './shader-toon.js';
import * as postDofBloom from './post-dof-bloom.js';
import * as godray from './lighting-godray.js';
import * as motionArrows from './motion-arrows.js';
import * as pipeFlow from './pipe-flow.js';
import * as alerts from './alerts.js';
/* Linear Ability Casting — skillshots + VFX building blocks */
import * as frostLance from './skillshot-frost-lance.js';
import * as stormLance from './skillshot-storm-lance.js';
import * as cinderFall from './skillshot-cinder-fall.js';
import * as novaBeam from './skillshot-nova-beam.js';
import * as voltaicSnare from './skillshot-voltaic-snare.js';
import * as glacialCrown from './skillshot-glacial-crown.js';
import * as vfxRibbonLightning from './vfx-ribbon-lightning.js';
import * as vfxGroundFissures from './vfx-ground-fissures.js';
import * as vfxBurstSphere from './vfx-burst-sphere.js';
import * as vfxVolumetricFire from './vfx-volumetric-fire.js';
import * as archiveFire from './skillshot-archive-fire.js';
import * as archiveWater from './skillshot-archive-water.js';
import * as archiveEarth from './skillshot-archive-earth.js';
import * as archiveWind from './skillshot-archive-wind.js';
import * as vfxOceanWater from './vfx-ocean-water.js';
import * as terrainGrassTiles from './terrain-grass-tiles.js';


/** Sidebar category order (taxonomy) */
export const categories = [
  'particles',
  'fluid-gas',
  'shaders',
  'postprocessing',
  'lighting',
  'terrain',
  'motion-arrows',
  'pipe-flow',
  'alerts',
  'skillshot',
];

/** Flat list — each module exports id/title/category/guiSchema/create/update/dispose */
export const effects = [
  fireworks,
  fire,
  smoke,
  steamPlume,
  sparks,
  gasMix,
  gasCollision,
  liquidMix,
  dissolve,
  hologram,
  glass,
  toon,
  postDofBloom,
  godray,
  terrainGrassTiles,
  motionArrows,
  pipeFlow,
  alerts,
  frostLance,
  stormLance,
  cinderFall,
  novaBeam,
  voltaicSnare,
  glacialCrown,
  vfxRibbonLightning,
  vfxGroundFissures,
  vfxBurstSphere,
  vfxVolumetricFire,
  archiveFire,
  archiveWater,
  archiveEarth,
  archiveWind,
  vfxOceanWater,
];

/** Lookup by id */
export const effectsById = Object.fromEntries(effects.map((e) => [e.id, e]));

export default effects;
