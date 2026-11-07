/**
 * fluid-gas-mix.js — Stylized two-color gas mix with soft glow particles
 *
 * Technique: Additive Points + soft ShaderMaterial disc; species A/B with
 * mixRate attract + collideStrength repulsion. Chamber glass shell for read.
 * NOT a full Navier-Stokes solver — educational particle field.
 *
 * Params: mixRate, collideStrength, particleCount, viscosity, colorA, colorB
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'fluid-gas-mix';
export const title = '气体混合 Gas Mix';
export const category = 'fluid-gas';

export const guiSchema = [
  { key: 'mixRate', label: '混合速率 MixRate', min: 0, max: 2, step: 0.02, default: 0.6 },
  { key: 'collideStrength', label: '碰撞强度 Collide', min: 0, max: 3, step: 0.05, default: 1.0 },
  { key: 'particleCount', label: '粒子数 Count', min: 200, max: 2000, step: 50, default: 900 },
  { key: 'viscosity', label: '粘滞 Viscosity', min: 0, max: 1, step: 0.02, default: 0.15 },
  { key: 'colorA', label: '颜色A ColorA', default: '#4488ff' },
  { key: 'colorB', label: '颜色B ColorB', default: '#ff6644' },
];

const SoftGasShader = {
  uniforms: { uSize: { value: 18.0 } },
  vertexShader: /* glsl */`
    attribute vec3 color;
    varying vec3 vColor;
    uniform float uSize;
    void main() {
      vColor = color;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = uSize * (120.0 / max(-mv.z, 0.5));
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float soft = 1.0 - smoothstep(0.05, 0.5, d);
      vec3 col = vColor * (0.9 + soft * 1.4);
      gl_FragColor = vec4(col, soft * 0.75);
    }
  `,
};

let root, points, vel, species, sceneRef, lastN = 0;
const BOX = 2.5;

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
  species = new Float32Array(n);
  const cA = new THREE.Color(params.colorA);
  const cB = new THREE.Color(params.colorB);

  for (let i = 0; i < n; i++) {
    const isB = i >= n / 2;
    species[i] = isB ? 1 : 0;
    pos[i * 3] = (isB ? 1 : -1) * (0.8 + Math.random() * 1.2);
    pos[i * 3 + 1] = (Math.random() - 0.5) * BOX;
    pos[i * 3 + 2] = (Math.random() - 0.5) * BOX;
    vel[i * 3] = (Math.random() - 0.5) * 0.5;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.5;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.5;
    const c = isB ? cB : cA;
    col[i * 3] = c.r * 1.4; col[i * 3 + 1] = c.g * 1.4; col[i * 3 + 2] = c.b * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const uniforms = THREE.UniformsUtils.clone(SoftGasShader.uniforms);
  points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SoftGasShader.vertexShader,
      fragmentShader: SoftGasShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  points.frustumCulled = false;
  root.add(points);
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'gasMix';
  root.position.y = 2.5;

  // Glass chamber
  const chamber = new THREE.Mesh(
    new THREE.BoxGeometry(BOX * 2.05, BOX * 2.05, BOX * 2.05),
    new THREE.MeshPhysicalMaterial({
      color: 0xaaccff,
      metalness: 0,
      roughness: 0.1,
      transmission: 0.85,
      thickness: 0.3,
      transparent: true,
      opacity: 1,
      side: THREE.DoubleSide,
    })
  );
  chamber.name = 'chamber';
  root.add(chamber);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(BOX * 2, BOX * 2, BOX * 2)),
    new THREE.LineBasicMaterial({ color: 0x556677 })
  );
  root.add(edges);

  // Divider hint
  const div = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, BOX * 1.9),
    new THREE.MeshBasicMaterial({ color: 0x8899aa, transparent: true, opacity: 0.25 })
  );
  root.add(div);

  ctx.scene.add(root);
  rebuild(params);
  ctx.camera.position.set(0, 3.5, 9.5);
  ctx.camera.lookAt(0, 2.5, 0);
}

export function update(dt, params) {
  if (!points) return;
  if (params.particleCount !== lastN) rebuild(params);

  const pos = points.geometry.attributes.position.array;
  const col = points.geometry.attributes.color.array;
  const n = lastN;
  const cA = new THREE.Color(params.colorA);
  const cB = new THREE.Color(params.colorB);
  const mix = params.mixRate;
  const colStr = params.collideStrength;

  for (let i = 0; i < n; i++) {
    const targetX = THREE.MathUtils.lerp(species[i] < 0.5 ? -1 : 1, 0, Math.min(1, mix * 0.5));
    vel[i * 3] += (targetX * 1.5 - pos[i * 3]) * mix * 0.4 * dt;
    vel[i * 3 + 1] += (Math.sin(i + pos[i * 3]) * 0.2) * dt;

    for (let k = 0; k < 4; k++) {
      const j = (i + 1 + k * 17) % n;
      const dx = pos[i * 3] - pos[j * 3];
      const dy = pos[i * 3 + 1] - pos[j * 3 + 1];
      const dz = pos[i * 3 + 2] - pos[j * 3 + 2];
      const d2 = dx * dx + dy * dy + dz * dz + 1e-4;
      if (d2 < 0.25) {
        const f = colStr * 0.15 / d2;
        const same = species[i] === species[j] ? 0.4 : 1.2;
        vel[i * 3] += dx * f * same * dt;
        vel[i * 3 + 1] += dy * f * same * dt;
        vel[i * 3 + 2] += dz * f * same * dt;
      }
    }

    const damp = 1 - params.viscosity * 2 * dt;
    vel[i * 3] *= damp;
    vel[i * 3 + 1] *= damp;
    vel[i * 3 + 2] *= damp;

    pos[i * 3] += vel[i * 3] * dt * 2;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dt * 2;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dt * 2;

    for (let a = 0; a < 3; a++) {
      if (pos[i * 3 + a] > BOX) { pos[i * 3 + a] = BOX; vel[i * 3 + a] *= -0.6; }
      if (pos[i * 3 + a] < -BOX) { pos[i * 3 + a] = -BOX; vel[i * 3 + a] *= -0.6; }
    }

    const s = i >= n / 2 ? 1 : 0;
    const mixed = THREE.MathUtils.clamp(mix * 0.3 + Math.abs(pos[i * 3]) * 0.05, 0, 1);
    const c = s < 0.5
      ? cA.clone().lerp(cB, mixed * 0.5)
      : cB.clone().lerp(cA, mixed * 0.5);
    col[i * 3] = c.r * 1.4; col[i * 3 + 1] = c.g * 1.4; col[i * 3 + 2] = c.b * 1.4;
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = points = vel = species = sceneRef = null;
}
