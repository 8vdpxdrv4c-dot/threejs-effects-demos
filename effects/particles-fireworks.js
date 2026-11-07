/**
 * particles-fireworks.js — HDR fireworks with trails (bloom-friendly)
 *
 * Technique: Additive ShaderMaterial Points with soft glow disc + HDR color
 * boost; trail history as secondary faded Points strips per spark.
 * BUGFIX PRESERVED: seedBurst runs AFTER Points are created (writes into
 * points.geometry.attributes).
 *
 * Params: burstCount, particleCount, spread, gravity, sparkSize, autoLaunch
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'particles-fireworks';
export const title = '烟花 Fireworks';
export const category = 'particles';

export const guiSchema = [
  { key: 'burstCount', label: '爆发数量 Burst', min: 1, max: 8, step: 1, default: 3 },
  { key: 'particleCount', label: '每发粒子 Particles', min: 40, max: 400, step: 10, default: 120 },
  { key: 'spread', label: '扩散 Spread', min: 0.5, max: 6, step: 0.1, default: 2.5 },
  { key: 'gravity', label: '重力 Gravity', min: 0, max: 20, step: 0.1, default: 6 },
  { key: 'sparkSize', label: '火花尺寸 Size', min: 0.02, max: 0.3, step: 0.01, default: 0.1 },
  { key: 'autoLaunch', label: '自动发射 Auto', default: true },
];

const SparkShader = {
  uniforms: {
    uSize: { value: 0.1 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    attribute vec3 color;
    attribute float aLife;
    varying vec3 vColor;
    varying float vLife;
    uniform float uSize;
    void main() {
      vColor = color;
      vLife = aLife;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float s = uSize * mix(2.2, 0.3, aLife) * (280.0 / max(-mv.z, 0.5));
      gl_PointSize = max(s, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying float vLife;
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float d = length(c);
      if (d > 0.5) discard;
      float core = 1.0 - smoothstep(0.0, 0.18, d);
      float halo = 1.0 - smoothstep(0.1, 0.5, d);
      // HDR boost for bloom pickup
      vec3 col = vColor * (1.5 + core * 3.5);
      float alpha = (halo * 0.85 + core) * (1.0 - vLife);
      if (alpha < 0.01) discard;
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

const TRAIL_LEN = 6;

let root, points, trails, velocities, lifetimes, ages, colors, baseColors;
let trailHist; // Float32Array n * TRAIL_LEN * 3
let launchTimer = 0;
let sceneRef;

function rebuild(params) {
  if (points) {
    root.remove(points);
    points.geometry.dispose();
    points.material.dispose();
    points = null;
  }
  if (trails) {
    root.remove(trails);
    trails.geometry.dispose();
    trails.material.dispose();
    trails = null;
  }

  const n = params.burstCount * params.particleCount;
  const pos = new Float32Array(n * 3);
  velocities = new Float32Array(n * 3);
  lifetimes = new Float32Array(n);
  ages = new Float32Array(n);
  colors = new Float32Array(n * 3);
  baseColors = new Float32Array(n * 3);
  const lifeAttr = new Float32Array(n);
  trailHist = new Float32Array(n * TRAIL_LEN * 3);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aLife', new THREE.BufferAttribute(lifeAttr, 1));

  const uniforms = THREE.UniformsUtils.clone(SparkShader.uniforms);
  uniforms.uSize.value = params.sparkSize * 80;

  points = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: SparkShader.vertexShader,
      fragmentShader: SparkShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  points.frustumCulled = false;
  root.add(points);

  // Trail ribbon as secondary points (history samples)
  const tn = n * TRAIL_LEN;
  const tpos = new Float32Array(tn * 3);
  const tcol = new Float32Array(tn * 3);
  const tlife = new Float32Array(tn);
  for (let i = 0; i < tn; i++) tpos[i * 3 + 1] = -100;
  const tgeo = new THREE.BufferGeometry();
  tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
  tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
  trails = new THREE.Points(
    tgeo,
    new THREE.PointsMaterial({
      size: params.sparkSize * 0.45,
      vertexColors: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  trails.frustumCulled = false;
  root.add(trails);

  // seed AFTER Points created — writes into points.geometry
  for (let b = 0; b < params.burstCount; b++) {
    seedBurst(b, params, true);
  }
}

function seedBurst(burstIndex, params, initial) {
  if (!points) return;
  const n = params.particleCount;
  const base = burstIndex * n;
  const cx = (Math.random() - 0.5) * 6;
  const cy = 2.2 + Math.random() * 3.2;
  const cz = (Math.random() - 0.5) * 4;
  // Saturated HDR palette
  const hue = Math.random();
  const col = new THREE.Color().setHSL(hue, 0.95, 0.55);
  // Boost channel for bloom
  const boost = 1.8;
  const pos = points.geometry.attributes.position.array;
  const lifeAttr = points.geometry.attributes.aLife.array;

  for (let i = 0; i < n; i++) {
    const idx = base + i;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const sp = params.spread * (0.45 + Math.random() * 0.9);
    velocities[idx * 3] = Math.sin(phi) * Math.cos(theta) * sp;
    velocities[idx * 3 + 1] = Math.sin(phi) * Math.sin(theta) * sp;
    velocities[idx * 3 + 2] = Math.cos(phi) * sp;
    lifetimes[idx] = 1.3 + Math.random() * 1.6;
    ages[idx] = initial ? Math.random() * lifetimes[idx] : 0;
    pos[idx * 3] = cx;
    pos[idx * 3 + 1] = cy;
    pos[idx * 3 + 2] = cz;
    baseColors[idx * 3] = col.r * boost;
    baseColors[idx * 3 + 1] = col.g * boost;
    baseColors[idx * 3 + 2] = col.b * boost;
    colors[idx * 3] = baseColors[idx * 3];
    colors[idx * 3 + 1] = baseColors[idx * 3 + 1];
    colors[idx * 3 + 2] = baseColors[idx * 3 + 2];
    lifeAttr[idx] = ages[idx] / lifetimes[idx];
    // clear trail history
    for (let k = 0; k < TRAIL_LEN; k++) {
      const ti = (idx * TRAIL_LEN + k) * 3;
      trailHist[ti] = cx;
      trailHist[ti + 1] = cy;
      trailHist[ti + 2] = cz;
    }
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
  points.geometry.attributes.aLife.needsUpdate = true;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'fireworks';
  ctx.scene.add(root);
  rebuild(params);
  launchTimer = 0;
  ctx.camera.position.set(0, 3.5, 10);
  ctx.camera.lookAt(0, 3, 0);
  ctx.renderer.toneMappingExposure = 1.15;
}

export function update(dt, params, ctx) {
  if (!points) return;
  const need = params.burstCount * params.particleCount;
  if (points.geometry.attributes.position.count !== need) {
    rebuild(params);
  }
  points.material.uniforms.uSize.value = params.sparkSize * 80;
  points.material.uniforms.uTime.value = ctx.clock.elapsedTime;
  if (trails) trails.material.size = params.sparkSize * 0.45;

  const pos = points.geometry.attributes.position.array;
  const lifeAttr = points.geometry.attributes.aLife.array;
  const n = pos.length / 3;
  const tpos = trails ? trails.geometry.attributes.position.array : null;
  const tcol = trails ? trails.geometry.attributes.color.array : null;

  for (let i = 0; i < n; i++) {
    ages[i] += dt;
    const lifeT = Math.min(1, ages[i] / lifetimes[i]);
    lifeAttr[i] = lifeT;

    if (ages[i] > lifetimes[i]) {
      colors[i * 3] = 0;
      colors[i * 3 + 1] = 0;
      colors[i * 3 + 2] = 0;
      continue;
    }

    // Shift trail history
    if (trailHist) {
      for (let k = TRAIL_LEN - 1; k > 0; k--) {
        const dst = (i * TRAIL_LEN + k) * 3;
        const src = (i * TRAIL_LEN + k - 1) * 3;
        trailHist[dst] = trailHist[src];
        trailHist[dst + 1] = trailHist[src + 1];
        trailHist[dst + 2] = trailHist[src + 2];
      }
      trailHist[i * TRAIL_LEN * 3] = pos[i * 3];
      trailHist[i * TRAIL_LEN * 3 + 1] = pos[i * 3 + 1];
      trailHist[i * TRAIL_LEN * 3 + 2] = pos[i * 3 + 2];
    }

    pos[i * 3] += velocities[i * 3] * dt;
    pos[i * 3 + 1] += velocities[i * 3 + 1] * dt;
    pos[i * 3 + 2] += velocities[i * 3 + 2] * dt;
    velocities[i * 3 + 1] -= params.gravity * dt;
    // Air drag
    velocities[i * 3] *= 0.995;
    velocities[i * 3 + 2] *= 0.995;

    const fade = 1 - lifeT;
    colors[i * 3] = baseColors[i * 3] * fade;
    colors[i * 3 + 1] = baseColors[i * 3 + 1] * fade;
    colors[i * 3 + 2] = baseColors[i * 3 + 2] * fade;

    if (tpos && tcol) {
      for (let k = 0; k < TRAIL_LEN; k++) {
        const ti = i * TRAIL_LEN + k;
        const src = (i * TRAIL_LEN + k) * 3;
        tpos[ti * 3] = trailHist[src];
        tpos[ti * 3 + 1] = trailHist[src + 1];
        tpos[ti * 3 + 2] = trailHist[src + 2];
        const tf = fade * (1 - k / TRAIL_LEN) * 0.55;
        tcol[ti * 3] = baseColors[i * 3] * tf;
        tcol[ti * 3 + 1] = baseColors[i * 3 + 1] * tf;
        tcol[ti * 3 + 2] = baseColors[i * 3 + 2] * tf;
      }
    }
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.color.needsUpdate = true;
  points.geometry.attributes.aLife.needsUpdate = true;
  if (trails) {
    trails.geometry.attributes.position.needsUpdate = true;
    trails.geometry.attributes.color.needsUpdate = true;
  }

  if (params.autoLaunch) {
    launchTimer += dt;
    if (launchTimer > 1.6) {
      launchTimer = 0;
      const b = Math.floor(Math.random() * params.burstCount);
      seedBurst(b, params, false);
    }
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = points = trails = velocities = lifetimes = ages = colors = baseColors = null;
  trailHist = sceneRef = null;
}
