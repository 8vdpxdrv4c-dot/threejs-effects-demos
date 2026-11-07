/**
 * vfx-volumetric-fire.js — VolumetricFireMaterial on a billboard ribbon hull
 * (building block from Cinder Fall trail). Full knobs: settings.meteor trail*
 */
import * as THREE from 'three';
import { RibbonGeometry, RibbonMode } from '../vendor/linear-ability/effects/RibbonGeometry.js';
import { VolumetricFireMaterial, fireHullReach } from '../vendor/linear-ability/materials/VolumetricFireMaterial.js';
import { LAYER } from '../vendor/linear-ability/core/Layers.js';
import { frame } from '../vendor/linear-ability/core/FrameUniforms.js';
import { settings } from '../vendor/linear-ability/config/settings.js';

export const id = 'vfx-volumetric-fire';
export const title = 'Volumetric Fire 体积累积火';
export const category = 'skillshot';

export const guiSchema = [
  { key: 'intensity', label: '强度 Intensity', min: 0.4, max: 2.5, step: 0.05, default: 1.2 },
  { key: 'length', label: '尾长 Length', min: 3, max: 16, step: 0.5, default: 7 },
  { key: 'width', label: '宽度 Width', min: 0.3, max: 2.5, step: 0.05, default: 0.95 },
  { key: 'speed', label: '流速 Flow', min: 0.5, max: 4, step: 0.1, default: 2.0 },
];

const NODES = 28;
let root, ribbon, mat, points, hull;

export function create(ctx, params) {
  dispose();
  const { scene, camera } = ctx;
  camera.layers.enable(LAYER.VFX);
  camera.position.set(-5, 5, 8);
  camera.lookAt(0, 2, 0);

  if (!frame.uSceneDepth.value) {
    const tex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  points = [];
  hull = [];
  for (let i = 0; i <= NODES; i++) points.push(new THREE.Vector3());
  for (let i = 0; i <= NODES + 2; i++) hull.push(new THREE.Vector3());

  ribbon = new RibbonGeometry(NODES + 2, { frame: true });
  mat = new VolumetricFireMaterial();
  const mesh = new THREE.Mesh(ribbon.geometry, mat);
  mesh.frustumCulled = false;
  mesh.matrixAutoUpdate = false;
  mesh.layers.set(LAYER.VFX);
  mesh.renderOrder = 11;

  root = new THREE.Group();
  root.name = 'vfx-volumetric-fire';
  root.add(mesh);
  scene.add(root);

  rebuild(params, camera);
}

function rebuild(params, camera) {
  const L = params.length ?? 7;
  const W = params.width ?? 0.95;
  settings.global.glow = params.intensity ?? 1.2;
  settings.meteor.trailSpeed = params.speed ?? 2.0;
  settings.meteor.trailWidth = W;
  settings.meteor.trailGlow = (params.intensity ?? 1.2) * 1.4;

  // Arc polyline: ground → loft → forward
  for (let i = 0; i <= NODES; i++) {
    const t = i / NODES;
    const z = t * L;
    const y = 0.6 + Math.sin(t * Math.PI) * 2.8 + t * 0.4;
    points[i].set((t - 0.5) * 0.4, y, z - L * 0.3);
  }

  const tailPad = 0.35;
  const headPad = 0.55;
  const heading = new THREE.Vector3();
  heading.subVectors(points[1], points[0]).normalize();
  hull[0].copy(points[0]).addScaledVector(heading, -tailPad);
  for (let i = 0; i <= NODES; i++) {
    hull[i + 1].copy(points[i]);
    const age = 1 - i / NODES;
    hull[i + 1].y += settings.meteor.trailRise * Math.pow(age, 1.5);
  }
  heading.subVectors(points[NODES], points[NODES - 1]).normalize();
  hull[NODES + 2].copy(points[NODES]).addScaledVector(heading, headPad);

  const arcLength = tailPad + L + headPad;
  mat.sync();
  const u = mat.uniforms;
  u.uRadius.value = W;
  u.uStreamLength.value = L;
  u.uArcLength.value = arcLength;
  u.uTailPad.value = tailPad;

  const reach = fireHullReach();
  const cover = 1.08 * reach * Math.max(1, settings.meteor.trailPlume);
  const headSize = Math.max(0.2, settings.meteor.trailHeadSize);
  ribbon.build(hull, {
    count: NODES + 3,
    width: 2 * W * headSize * cover,
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
  root = ribbon = mat = points = hull = null;
}
