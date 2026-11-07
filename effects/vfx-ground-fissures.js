/**
 * vfx-ground-fissures.js — Molten crack network (building block from Cinder Fall)
 * Full knobs: vendor/.../settings.meteor fissure*
 */
import * as THREE from 'three';
import { FissureSystem } from '../vendor/linear-ability/effects/GroundFissures.js';
import { LAYER } from '../vendor/linear-ability/core/Layers.js';
import { frame } from '../vendor/linear-ability/core/FrameUniforms.js';
import { settings } from '../vendor/linear-ability/config/settings.js';

export const id = 'vfx-ground-fissures';
export const title = 'Ground Fissures 熔岩裂隙';
export const category = 'skillshot';

export const guiSchema = [
  { key: 'intensity', label: '强度 Intensity', min: 0.4, max: 2.5, step: 0.05, default: 1.2 },
  { key: 'radius', label: '半径 Radius', min: 1.5, max: 10, step: 0.1, default: 4.5 },
  { key: 'life', label: '寿命 Life s', min: 1.5, max: 10, step: 0.1, default: 4.5 },
  { key: 'recastInterval', label: '重放间隔 Recast s', min: 2, max: 10, step: 0.5, default: 5 },
];

let fissures, since, ground;

export function create(ctx, params) {
  dispose();
  const { scene, camera } = ctx;
  camera.layers.enable(LAYER.VFX);
  camera.layers.enable(LAYER.WORLD);
  camera.position.set(0, 10, 12);
  camera.lookAt(0, 0, 0);

  ground = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({ color: 0x1a1814, roughness: 0.95 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.layers.set(LAYER.WORLD);
  scene.add(ground);

  fissures = new FissureSystem(scene);
  since = 99;
  spawn(params);
}

function spawn(params) {
  settings.global.explosionIntensity = params.intensity ?? 1.2;
  settings.global.glow = params.intensity ?? 1.2;
  fissures.spawn(new THREE.Vector3(0, 0, 0), {
    radius: params.radius ?? 4.5,
    life: params.life ?? 4.5,
  });
  since = 0;
}

export function update(dt, params) {
  if (!fissures) return;
  const raw = Math.min(dt, 0.05);
  since += raw;
  frame.uTime.value += raw;
  fissures.update(raw);
  if (since >= (params.recastInterval ?? 5) && fissures.active.length === 0) {
    spawn(params);
  }
}

export function dispose() {
  fissures?.dispose();
  if (ground?.parent) {
    ground.parent.remove(ground);
    ground.geometry.dispose();
    ground.material.dispose();
  }
  fissures = ground = null;
}
