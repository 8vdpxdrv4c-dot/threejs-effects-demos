/**
 * vfx-ocean-water.js — OceanWaterMaterial on a billboard ribbon hull
 * (building block from archive WaterAbility). Full knobs: settings.water
 */
import * as THREE from 'three';
import { RibbonGeometry, RibbonMode } from '../vendor/linear-ability/effects/RibbonGeometry.js';
import { OceanWaterMaterial } from '../vendor/linear-ability/archive/materials/OceanWaterMaterial.js';
import { LAYER } from '../vendor/linear-ability/core/Layers.js';
import { frame } from '../vendor/linear-ability/core/FrameUniforms.js';
import { settings } from '../vendor/linear-ability/config/settings.js';

export const id = 'vfx-ocean-water';
export const title = 'Ocean Water 体素水面';
export const category = 'skillshot';

export const guiSchema = [
  { key: 'intensity', label: '强度 Intensity', min: 0.4, max: 2.5, step: 0.05, default: 1.0 },
  { key: 'length', label: '长度 Length', min: 4, max: 20, step: 0.5, default: 10 },
  { key: 'width', label: '宽度 Width', min: 0.2, max: 2.5, step: 0.05, default: 0.85 },
  { key: 'flowSpeed', label: '流速 Flow', min: 0.3, max: 4, step: 0.1, default: 1.9 },
];

const NODES = 28;
let root, ribbon, mat, points;

export function create(ctx, params) {
  dispose();
  const { scene, camera } = ctx;
  camera.layers.enable(LAYER.VFX);
  camera.position.set(-5, 5, 8);
  camera.lookAt(0, 0.6, 0);

  if (!frame.uSceneDepth.value) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  points = [];
  for (let i = 0; i <= NODES; i++) points.push(new THREE.Vector3());

  ribbon = new RibbonGeometry(NODES + 1, { frame: true });
  mat = new OceanWaterMaterial();
  const mesh = new THREE.Mesh(ribbon.geometry, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(LAYER.VFX);
  mesh.renderOrder = 11;

  root = new THREE.Group();
  root.name = 'vfx-ocean-water';
  root.add(mesh);
  scene.add(root);

  rebuild(params, camera);
}

function rebuild(params, camera) {
  const L = params.length ?? 10;
  const W = params.width ?? 0.85;
  settings.global.glow = params.intensity ?? 1.0;
  if (settings.water) {
    settings.water.flowSpeed = params.flowSpeed ?? 1.9;
    settings.water.radius = W * 0.12;
    settings.water.glow = (params.intensity ?? 1) * 0.8;
  }

  for (let i = 0; i <= NODES; i++) {
    const t = i / NODES;
    const z = t * L;
    const y = 0.35 + Math.sin(t * Math.PI) * 0.55;
    points[i].set((t - 0.5) * 0.25, y, z - L * 0.35);
  }

  mat.sync?.();
  const u = mat.uniforms;
  if (u?.uRadius) u.uRadius.value = W;
  if (u?.uStreamLength) u.uStreamLength.value = L;
  if (u?.uArcLength) u.uArcLength.value = L;

  ribbon.build(points, {
    count: NODES + 1,
    width: 2 * W,
    mode: RibbonMode.BILLBOARD,
    cameraPosition: camera.position,
  });
}

export function update(dt, params, ctx) {
  if (!root) return;
  const raw = Math.min(dt, 0.05);
  frame.uTime.value += raw;
  rebuild(params, ctx.camera);
}

export function dispose() {
  if (root?.parent) root.parent.remove(root);
  mat?.dispose?.();
  ribbon?.geometry?.dispose?.();
  root = ribbon = mat = points = null;
}
