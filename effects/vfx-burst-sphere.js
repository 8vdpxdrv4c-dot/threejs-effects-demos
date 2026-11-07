/**
 * vfx-burst-sphere.js — Impact shell BurstSystem (building block)
 * Modes: FIRE / FROST / STORM / AIR / WATER / EARTH
 */
import * as THREE from 'three';
import { BurstSystem, BurstMode } from '../vendor/linear-ability/effects/BurstSphere.js';
import { LAYER } from '../vendor/linear-ability/core/Layers.js';
import { frame } from '../vendor/linear-ability/core/FrameUniforms.js';

export const id = 'vfx-burst-sphere';
export const title = 'Burst Sphere 冲击球壳';
export const category = 'skillshot';

export const guiSchema = [
  {
    key: 'mode',
    label: '模式 Mode',
    options: {
      Fire: 'FIRE', Frost: 'FROST', Storm: 'STORM', Air: 'AIR', Water: 'WATER', Earth: 'EARTH',
    },
    default: 'STORM',
  },
  { key: 'intensity', label: '强度 Intensity', min: 0.3, max: 2.5, step: 0.05, default: 1.3 },
  { key: 'radius', label: '起始半径 R0', min: 0.1, max: 2, step: 0.05, default: 0.35 },
  { key: 'endRadius', label: '结束半径 R1', min: 1, max: 10, step: 0.1, default: 4.5 },
  { key: 'life', label: '寿命 Life s', min: 0.3, max: 2.5, step: 0.05, default: 0.95 },
  { key: 'recastInterval', label: '重放间隔 Recast s', min: 0.8, max: 5, step: 0.1, default: 1.6 },
];

let bursts, since;

export function create(ctx, params) {
  dispose();
  const { scene, camera } = ctx;
  camera.layers.enable(LAYER.VFX);
  camera.position.set(0, 3, 8);
  camera.lookAt(0, 1, 0);

  if (!frame.uSceneDepth.value) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  bursts = new BurstSystem(scene);
  since = 99;
  spawn(params);
}

function spawn(params) {
  const mode = BurstMode[params.mode] ?? BurstMode.STORM;
  frame.uGlobalGlow.value = params.intensity ?? 1.3;
  frame.uShaderIntensity.value = params.intensity ?? 1.3;
  bursts.spawn(mode, new THREE.Vector3(0, 1.2, 0), {
    radius: params.radius ?? 0.35,
    endRadius: params.endRadius ?? 4.5,
    life: params.life ?? 0.95,
    intensity: params.intensity ?? 1.3,
    opacity: 1,
  });
  since = 0;
}

export function update(dt, params) {
  if (!bursts) return;
  const raw = Math.min(dt, 0.05);
  since += raw;
  frame.uTime.value += raw;
  bursts.update(raw);
  if (since >= (params.recastInterval ?? 1.6)) spawn(params);
}

export function dispose() {
  bursts?.dispose();
  bursts = null;
}
