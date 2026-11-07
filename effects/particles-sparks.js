/**
 * particles-sparks.js — 电火花 / Sparks
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'particles-sparks';
export const title = '电火花 Sparks';
export const category = 'particles';

export const guiSchema = [
  { key: 'rate', label: '发射率 Rate', min: 10, max: 400, step: 10, default: 120 },
  { key: 'speed', label: '速度 Speed', min: 1, max: 20, step: 0.5, default: 8 },
  { key: 'length', label: '拖尾长度 Trail', min: 0.05, max: 1.5, step: 0.05, default: 0.4 },
  { key: 'gravity', label: '重力 Gravity', min: 0, max: 30, step: 0.5, default: 12 },
  { key: 'colorTemp', label: '色温 Temp', min: 0, max: 1, step: 0.01, default: 0.35 },
];

let root, lines, positions, velocities, ages, maxAge, sceneRef;
const MAX = 300;

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'sparks';

  // weld tip visual
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.06, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffaa44, emissiveIntensity: 2 })
  );
  tip.position.set(0, 1.2, 0);
  tip.name = 'tip';
  root.add(tip);

  const light = new THREE.PointLight(0xffcc66, 2, 6);
  light.position.copy(tip.position);
  root.add(light);

  positions = new Float32Array(MAX * 6); // 2 verts per spark
  velocities = new Float32Array(MAX * 3);
  ages = new Float32Array(MAX);
  maxAge = new Float32Array(MAX);
  for (let i = 0; i < MAX; i++) ages[i] = 999;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffcc66,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  lines = new THREE.LineSegments(geo, mat);
  root.add(lines);
  ctx.scene.add(root);
  ctx.camera.position.set(0, 2, 4);
  ctx.camera.lookAt(0, 1.2, 0);
}

let emitAccum = 0;

export function update(dt, params, ctx) {
  if (!lines) return;
  const tip = root.getObjectByName('tip');
  const origin = tip.position;

  // color by temp: 0 blue-white → 1 orange
  const c = new THREE.Color().setHSL(0.12 - params.colorTemp * 0.1, 0.9, 0.6 + (1 - params.colorTemp) * 0.2);
  lines.material.color.copy(c);

  emitAccum += params.rate * dt;
  while (emitAccum >= 1) {
    emitAccum -= 1;
    // find dead slot
    let slot = -1;
    for (let i = 0; i < MAX; i++) {
      if (ages[i] >= maxAge[i]) { slot = i; break; }
    }
    if (slot < 0) break;
    ages[slot] = 0;
    maxAge[slot] = 0.25 + Math.random() * 0.55;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const sp = params.speed * (0.5 + Math.random());
    velocities[slot * 3] = Math.sin(phi) * Math.cos(theta) * sp;
    velocities[slot * 3 + 1] = Math.cos(phi) * sp * 0.6 + Math.random() * 2;
    velocities[slot * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp;
    positions[slot * 6] = origin.x;
    positions[slot * 6 + 1] = origin.y;
    positions[slot * 6 + 2] = origin.z;
    positions[slot * 6 + 3] = origin.x;
    positions[slot * 6 + 4] = origin.y;
    positions[slot * 6 + 5] = origin.z;
  }

  for (let i = 0; i < MAX; i++) {
    if (ages[i] >= maxAge[i]) {
      // hide
      positions[i * 6 + 1] = -10;
      positions[i * 6 + 4] = -10;
      continue;
    }
    ages[i] += dt;
    velocities[i * 3 + 1] -= params.gravity * dt;
    const hx = positions[i * 6];
    const hy = positions[i * 6 + 1];
    const hz = positions[i * 6 + 2];
    const nx = hx + velocities[i * 3] * dt;
    const ny = hy + velocities[i * 3 + 1] * dt;
    const nz = hz + velocities[i * 3 + 2] * dt;
    positions[i * 6] = nx;
    positions[i * 6 + 1] = ny;
    positions[i * 6 + 2] = nz;
    // trail end
    const len = params.length;
    const spd = Math.hypot(velocities[i * 3], velocities[i * 3 + 1], velocities[i * 3 + 2]) || 1;
    positions[i * 6 + 3] = nx - (velocities[i * 3] / spd) * len;
    positions[i * 6 + 4] = ny - (velocities[i * 3 + 1] / spd) * len;
    positions[i * 6 + 5] = nz - (velocities[i * 3 + 2] / spd) * len;
  }
  lines.geometry.attributes.position.needsUpdate = true;

  // flicker tip
  tip.material.emissiveIntensity = 1.5 + Math.random() * 2;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = lines = positions = velocities = ages = maxAge = sceneRef = null;
}
