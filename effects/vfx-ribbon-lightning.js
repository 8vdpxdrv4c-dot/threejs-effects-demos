/**
 * vfx-ribbon-lightning.js — Bolt ribbon + LightningMaterial (building block)
 *
 * Isolates Storm Lance's filament strip: createBoltRibbonGeometry + dual-pass
 * LightningMaterial, progress 0→1 loop. Full knobs: vendor/.../settings.thunder
 */
import * as THREE from 'three';
import { createBoltRibbonGeometry } from '../vendor/linear-ability/assets/ProceduralGeometry.js';
import { createLightningMaterial, BoltPass } from '../vendor/linear-ability/materials/LightningMaterial.js';
import { LAYER } from '../vendor/linear-ability/core/Layers.js';
import { frame } from '../vendor/linear-ability/core/FrameUniforms.js';
import { settings } from '../vendor/linear-ability/config/settings.js';

export const id = 'vfx-ribbon-lightning';
export const title = 'Lightning Ribbon 闪电丝束';
export const category = 'skillshot';

export const guiSchema = [
  { key: 'intensity', label: '强度 Intensity', min: 0.3, max: 2.5, step: 0.05, default: 1.2 },
  { key: 'length', label: '长度 Length', min: 4, max: 30, step: 0.5, default: 14 },
  { key: 'strands', label: '丝束 Strands', min: 3, max: 20, step: 1, default: 9 },
  { key: 'speed', label: '推进 Speed', min: 0.3, max: 3, step: 0.05, default: 1.1 },
  { key: 'hold', label: '持燃 Hold s', min: 0.2, max: 3, step: 0.1, default: 0.8 },
];

let root, mats, geo, state, age, phase; // phase: travel|hold|fade|wait
const origin = new THREE.Vector3(0, 1.4, 0);
const target = new THREE.Vector3(0, 0.3, 14);
const side = new THREE.Vector3(1, 0, 0);

export function create(ctx, params) {
  dispose();
  const { scene, camera } = ctx;
  camera.layers.enable(LAYER.VFX);
  camera.position.set(-4, 6, -6);
  camera.lookAt(0, 1, 7);

  if (!frame.uSceneDepth.value) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  root = new THREE.Group();
  root.name = 'vfx-ribbon-lightning';
  geo = createBoltRibbonGeometry(64, 24);
  mats = [
    createLightningMaterial(BoltPass.GLOW),
    createLightningMaterial(BoltPass.CORE),
  ];
  mats.forEach((mat, i) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.layers.set(LAYER.VFX);
    mesh.renderOrder = 11 + i * 2;
    root.add(mesh);
  });
  scene.add(root);

  state = {
    origin, target, side,
    progress: 0, fade: 1, seed: Math.random() * 1000, strands: params.strands || 9,
  };
  age = 0;
  phase = 'travel';
  apply(params);
}

function apply(params) {
  const L = params.length ?? 14;
  target.set(0, 0.3, L);
  origin.set(0, 1.4, 0);
  side.set(1, 0, 0);
  state.strands = Math.max(1, Math.round(params.strands ?? 9));
  if (geo) geo.instanceCount = state.strands;
  settings.global.glow = params.intensity ?? 1.2;
  settings.global.shaderIntensity = params.intensity ?? 1.2;
  frame.uShaderIntensity.value = params.intensity ?? 1.2;
  frame.uGlobalGlow.value = params.intensity ?? 1.2;
}

export function update(dt, params, ctx) {
  if (!root) return;
  apply(params);
  const raw = Math.min(dt, 0.05);
  age += raw;
  frame.uTime.value += raw;

  const speed = params.speed ?? 1.1;
  const hold = params.hold ?? 0.8;

  if (phase === 'travel') {
    state.progress = Math.min(1, state.progress + raw * speed * 0.55);
    state.fade = 1;
    if (state.progress >= 1) { phase = 'hold'; age = 0; }
  } else if (phase === 'hold') {
    state.fade = 1;
    if (age >= hold) { phase = 'fade'; age = 0; }
  } else if (phase === 'fade') {
    state.fade = Math.max(0, 1 - age / 0.55);
    if (state.fade <= 0) {
      phase = 'wait';
      age = 0;
      state.seed = Math.random() * 1000;
      state.progress = 0;
    }
  } else {
    if (age > 0.6) { phase = 'travel'; age = 0; }
  }

  for (const mat of mats) mat.userData.sync(state);
}

export function dispose() {
  if (root?.parent) root.parent.remove(root);
  root?.traverse((o) => {
    o.geometry?.dispose?.();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose?.();
    }
  });
  root = mats = geo = state = null;
}
