/**
 * particles-smoke.js — Industrial volumetric-looking smoke
 *
 * Technique: ShaderMaterial Points + soft radial falloff in fragment,
 * FBM / curl-style noise drift in vertex (animated UV offset), life-based
 * density fade, dark-scene lighting response via ambient tint.
 * Soft particles: discard hard edges; depthWrite:false + NormalBlending.
 *
 * Key params preserved: density, opacity, riseSpeed, noiseScale (+ spread, softness)
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'particles-smoke';
export const title = '烟雾 Smoke';
export const category = 'particles';

export const guiSchema = [
  { key: 'density', label: '浓密度 Density', min: 0.1, max: 3, step: 0.05, default: 1.0 },
  { key: 'opacity', label: '不透明度 Opacity', min: 0.05, max: 1, step: 0.01, default: 0.55 },
  { key: 'riseSpeed', label: '上升速度 Rise', min: 0.2, max: 4, step: 0.05, default: 1.0 },
  { key: 'noiseScale', label: '噪声尺度 Noise', min: 0.1, max: 3, step: 0.05, default: 1.2 },
  { key: 'spread', label: '扩散 Spread', min: 0.2, max: 3, step: 0.05, default: 1.2 },
  { key: 'softness', label: '柔和 Softness', min: 0.2, max: 2, step: 0.05, default: 1.15 },
];

const SoftSmokeShader = {
  uniforms: {
    uTime: { value: 0 },
    uOpacity: { value: 0.55 },
    uSoftness: { value: 1.15 },
    uNoiseScale: { value: 1.2 },
    uMap: { value: null },
    uAmbient: { value: new THREE.Color(0x1a1e28) },
    uKeyTint: { value: new THREE.Color(0xc8d0e0) },
  },
  vertexShader: /* glsl */`
    attribute float aSize;
    attribute float aLife;
    attribute float aSeed;
    varying float vLife;
    varying float vSeed;
    varying float vFog;
    uniform float uTime;
    uniform float uSoftness;
    uniform float uNoiseScale;

    // Simple hash / value noise for curl-ish drift in clip space offset
    float hash(float n) { return fract(sin(n) * 43758.5453); }
    float noise(vec3 x) {
      vec3 p = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      float n = p.x + p.y * 57.0 + p.z * 113.0;
      return mix(
        mix(mix(hash(n), hash(n+1.0), f.x), mix(hash(n+57.0), hash(n+58.0), f.x), f.y),
        mix(mix(hash(n+113.0), hash(n+114.0), f.x), mix(hash(n+170.0), hash(n+171.0), f.x), f.y),
        f.z
      );
    }
    float fbm(vec3 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.03 + vec3(1.7, 9.2, 2.1);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vLife = aLife;
      vSeed = aSeed;
      vec3 pos = position;
      // Curl-style lateral drift via FBM gradient approximation
      float ns = uNoiseScale;
      float t = uTime * 0.35;
      float n1 = fbm(vec3(pos.x * ns + aSeed, pos.y * ns * 0.5 + t, pos.z * ns));
      float n2 = fbm(vec3(pos.z * ns + 17.0, pos.x * ns + t * 0.7, aSeed));
      pos.x += (n1 - 0.5) * 0.35 * ns;
      pos.z += (n2 - 0.5) * 0.35 * ns;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float sizeBoost = mix(0.6, 1.8, aLife) * uSoftness;
      gl_PointSize = aSize * sizeBoost * (180.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
      vFog = clamp((-mv.z - 2.0) / 18.0, 0.0, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uOpacity;
    uniform float uTime;
    uniform float uNoiseScale;
    uniform sampler2D uMap;
    uniform vec3 uAmbient;
    uniform vec3 uKeyTint;
    varying float vLife;
    varying float vSeed;
    varying float vFog;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise2(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm2(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise2(p);
        p = p * 2.1 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    void main() {
      vec2 uv = gl_PointCoord;
      vec2 centered = uv - 0.5;
      float dist = length(centered);

      // Soft disc falloff (soft particle)
      float soft = 1.0 - smoothstep(0.15, 0.5, dist);
      if (soft < 0.01) discard;

      // Domain-warped FBM density inside particle
      float t = uTime * 0.2 + vSeed * 6.28;
      vec2 warped = uv * (2.5 + uNoiseScale) + vec2(t * 0.3, t * 0.15);
      warped += vec2(fbm2(warped + vSeed), fbm2(warped.yx + 3.1)) * 0.45;
      float dens = fbm2(warped);
      dens = smoothstep(0.25, 0.85, dens);

      float lifeFade = smoothstep(0.0, 0.15, vLife) * smoothstep(1.0, 0.55, vLife);
      float alpha = soft * dens * lifeFade * uOpacity;
      alpha *= 1.0 - vFog * 0.35;
      if (alpha < 0.01) discard;

      // Dark-scene lighting response: cool gray smoke with key tint
      vec3 smokeCol = mix(uAmbient, uKeyTint, 0.35 + dens * 0.4);
      smokeCol *= 0.55 + dens * 0.45;

      gl_FragColor = vec4(smokeCol, alpha);
    }
  `,
};

let root, points, vel, life, maxLife, seeds, sceneRef, baseCount = 600;
let densCache = -1;

function smokeTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(220,220,230,1)');
  grd.addColorStop(0.35, 'rgba(160,160,170,0.55)');
  grd.addColorStop(0.7, 'rgba(80,80,90,0.15)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rebuild(params) {
  if (points) {
    root.remove(points);
    points.geometry.dispose();
    if (points.material.uniforms?.uMap?.value) points.material.uniforms.uMap.value.dispose();
    points.material.dispose();
  }
  const n = Math.max(80, Math.floor(baseCount * params.density));
  const pos = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const lifeAttr = new Float32Array(n);
  const seedAttr = new Float32Array(n);
  vel = new Float32Array(n * 3);
  life = new Float32Array(n);
  maxLife = new Float32Array(n);
  seeds = seedAttr;

  for (let i = 0; i < n; i++) {
    seedAttr[i] = Math.random();
    spawn(i, pos, sizes, lifeAttr, params, true);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aLife', new THREE.BufferAttribute(lifeAttr, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seedAttr, 1));

  const uniforms = THREE.UniformsUtils.clone(SoftSmokeShader.uniforms);
  uniforms.uMap.value = smokeTex();
  uniforms.uOpacity.value = params.opacity;
  uniforms.uSoftness.value = params.softness;
  uniforms.uNoiseScale.value = params.noiseScale;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SoftSmokeShader.vertexShader,
    fragmentShader: SoftSmokeShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    // Points use gl_PointCoord; no need for uv attribute
  });

  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  root.add(points);
}

function spawn(i, pos, sizes, lifeAttr, params, randomLife) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * 0.4;
  pos[i * 3] = Math.cos(a) * r;
  pos[i * 3 + 1] = randomLife ? Math.random() * 3.2 : 0.12;
  pos[i * 3 + 2] = Math.sin(a) * r;
  vel[i * 3] = (Math.random() - 0.5) * params.spread * 0.35;
  vel[i * 3 + 1] = params.riseSpeed * (0.45 + Math.random() * 0.55);
  vel[i * 3 + 2] = (Math.random() - 0.5) * params.spread * 0.35;
  maxLife[i] = 2.8 + Math.random() * 2.8;
  life[i] = randomLife ? Math.random() * maxLife[i] : 0;
  if (sizes) sizes[i] = 28 + Math.random() * 40;
  if (lifeAttr) lifeAttr[i] = life[i] / maxLife[i];
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'smoke';

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.4, 0.18, 20),
    new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      metalness: 0.75,
      roughness: 0.4,
      envMapIntensity: 0.8,
    })
  );
  base.position.y = 0.09;
  base.castShadow = true;
  root.add(base);

  // Subtle ember glow under stack
  const glow = new THREE.PointLight(0xff8844, 0.35, 4);
  glow.position.set(0, 0.3, 0);
  glow.name = 'stackGlow';
  root.add(glow);

  ctx.scene.add(root);
  densCache = params.density;
  rebuild(params);
  ctx.camera.position.set(0, 2.8, 6.5);
  ctx.camera.lookAt(0, 1.6, 0);
}

export function update(dt, params, ctx) {
  if (!points) return;
  if (Math.abs(params.density - densCache) > 0.05) {
    densCache = params.density;
    rebuild(params);
  }

  const u = points.material.uniforms;
  u.uOpacity.value = params.opacity;
  u.uSoftness.value = params.softness;
  u.uNoiseScale.value = params.noiseScale;
  u.uTime.value = ctx.clock.elapsedTime;

  const pos = points.geometry.attributes.position.array;
  const lifeAttr = points.geometry.attributes.aLife.array;
  const sizes = points.geometry.attributes.aSize.array;
  const n = pos.length / 3;
  const t = ctx.clock.elapsedTime;

  for (let i = 0; i < n; i++) {
    life[i] += dt;
    const nx = Math.sin(t * 0.65 + i * 0.13) * params.noiseScale;
    const nz = Math.cos(t * 0.5 + i * 0.17) * params.noiseScale;
    pos[i * 3] += (vel[i * 3] + nx * 0.18) * dt * params.spread;
    pos[i * 3 + 1] += vel[i * 3 + 1] * params.riseSpeed * 0.4 * dt + vel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += (vel[i * 3 + 2] + nz * 0.18) * dt * params.spread;
    // Lateral expansion as smoke ages
    const age = life[i] / maxLife[i];
    pos[i * 3] += (pos[i * 3]) * age * 0.08 * dt;
    pos[i * 3 + 2] += (pos[i * 3 + 2]) * age * 0.08 * dt;
    lifeAttr[i] = age;
    if (life[i] >= maxLife[i]) spawn(i, pos, sizes, lifeAttr, params, false);
  }
  points.geometry.attributes.position.needsUpdate = true;
  points.geometry.attributes.aLife.needsUpdate = true;
  points.geometry.attributes.aSize.needsUpdate = true;

  const glow = root.getObjectByName('stackGlow');
  if (glow) glow.intensity = 0.25 + Math.sin(t * 3) * 0.08;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = points = vel = life = maxLife = seeds = sceneRef = null;
  densCache = -1;
}
