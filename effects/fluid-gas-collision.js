/**
 * fluid-gas-collision.js — 气体碰撞冲击波 (风格化)
 * Two jets collide → shock ring. Not full CFD.
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'fluid-gas-collision';
export const title = '气体碰撞 Collision';
export const category = 'fluid-gas';

export const guiSchema = [
  { key: 'jetSpeed', label: '射流速度 JetSpeed', min: 0.5, max: 8, step: 0.1, default: 3.5 },
  { key: 'shockStrength', label: '冲击强度 Shock', min: 0, max: 3, step: 0.05, default: 1.2 },
  { key: 'particleCount', label: '粒子数 Count', min: 200, max: 1600, step: 50, default: 700 },
  { key: 'turbulence', label: '湍流 Turb', min: 0, max: 2, step: 0.05, default: 0.7 },
];

let root, points, vel, sceneRef, ring, lastN;

function rebuild(params) {
  if (points) {
    root.remove(points);
    points.geometry.dispose();
    points.material.dispose();
  }
  const n = params.particleCount;
  lastN = n;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  vel = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const left = i < n / 2;
    pos[i * 3] = left ? -3 - Math.random() : 3 + Math.random();
    pos[i * 3 + 1] = (Math.random() - 0.5) * 1.5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    vel[i * 3] = left ? params.jetSpeed : -params.jetSpeed;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.2;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.2;
    if (left) { col[i * 3] = 0.3; col[i * 3 + 1] = 0.7; col[i * 3 + 2] = 1; }
    else { col[i * 3] = 1; col[i * 3 + 1] = 0.45; col[i * 3 + 2] = 0.2; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  root.add(points);
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'gasCollision';
  root.position.y = 2;
  // shock ring visual
  ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.04, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })
  );
  ring.rotation.y = Math.PI / 2;
  root.add(ring);
  ctx.scene.add(root);
  rebuild(params);
  ctx.camera.position.set(0, 3, 8);
  ctx.camera.lookAt(0, 2, 0);
}

export function update(dt, params, ctx) {
  if (!points) return;
  if (params.particleCount !== lastN) rebuild(params);
  const pos = points.geometry.attributes.position.array;
  const n = lastN;
  let shockPulse = 0;
  for (let i = 0; i < n; i++) {
    // toward center jets
    const left = i < n / 2;
    vel[i * 3] = THREE.MathUtils.lerp(vel[i * 3], left ? params.jetSpeed : -params.jetSpeed, 0.02);
    vel[i * 3 + 1] += (Math.random() - 0.5) * params.turbulence * dt;
    vel[i * 3 + 2] += (Math.random() - 0.5) * params.turbulence * dt;

    // collision zone near x≈0
    if (Math.abs(pos[i * 3]) < 0.6) {
      const push = params.shockStrength * (0.6 - Math.abs(pos[i * 3]));
      vel[i * 3 + 1] += (pos[i * 3 + 1] >= 0 ? 1 : -1) * push * 2 * dt;
      vel[i * 3 + 2] += (pos[i * 3 + 2] >= 0 ? 1 : -1) * push * 2 * dt;
      vel[i * 3] *= 0.92;
      shockPulse += push;
    }

    pos[i * 3] += vel[i * 3] * dt;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt;

    // recycle
    if (Math.abs(pos[i * 3]) > 5 || Math.abs(pos[i * 3 + 1]) > 4) {
      pos[i * 3] = left ? -3 - Math.random() : 3 + Math.random();
      pos[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 1.2;
      vel[i * 3] = left ? params.jetSpeed : -params.jetSpeed;
      vel[i * 3 + 1] = 0;
      vel[i * 3 + 2] = 0;
    }
  }
  points.geometry.attributes.position.needsUpdate = true;

  const r = 0.2 + Math.min(2.5, shockPulse * 0.002 + Math.sin(ctx.clock.elapsedTime * 4) * 0.05);
  ring.scale.setScalar(r * params.shockStrength);
  ring.material.opacity = 0.25 + Math.min(0.6, shockPulse * 0.001);
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = points = vel = ring = sceneRef = null;
}
