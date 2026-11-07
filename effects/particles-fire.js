/**
 * particles-fire.js — Cinematic noise-driven fire
 *
 * Technique: ShaderMaterial Points with domain-warped FBM in fragment,
 * hot→cool color ramp (white-yellow-orange-red-ember), additive glow,
 * sizeMode small/mid/large + intensity. Optional heat shimmer via
 * animated UV warp. Embers as secondary additive Points.
 *
 * Params: sizeMode, intensity, turbulence, riseSpeed, emberCount
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'particles-fire';
export const title = '火焰 Fire';
export const category = 'particles';

export const guiSchema = [
  { key: 'sizeMode', label: '规模 SizeMode', options: { 小: 'small', 中: 'mid', 大: 'large' }, default: 'mid' },
  { key: 'intensity', label: '强度 Intensity', min: 0.2, max: 3, step: 0.05, default: 1.2 },
  { key: 'turbulence', label: '湍流 Turbulence', min: 0, max: 2, step: 0.05, default: 0.8 },
  { key: 'riseSpeed', label: '上升速度 Rise', min: 0.5, max: 6, step: 0.1, default: 2.2 },
  { key: 'emberCount', label: '火星数量 Embers', min: 0, max: 200, step: 10, default: 40 },
];

const MODE = {
  small: { count: 280, radius: 0.35, height: 1.5 },
  mid: { count: 550, radius: 0.75, height: 2.6 },
  large: { count: 1000, radius: 1.5, height: 4.2 },
};

const FireShader = {
  uniforms: {
    uTime: { value: 0 },
    uIntensity: { value: 1.2 },
    uTurbulence: { value: 0.8 },
  },
  vertexShader: /* glsl */`
    attribute float aSize;
    attribute float aAge;
    attribute float aSeed;
    varying float vAge;
    varying float vSeed;
    varying float vDist;
    uniform float uTime;
    uniform float uTurbulence;

    float hash(float n) { return fract(sin(n) * 43758.5453123); }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f*f*(3.0-2.0*f);
      float n = i.x + i.y*57.0;
      return mix(mix(hash(n), hash(n+1.0), f.x), mix(hash(n+57.0), hash(n+58.0), f.x), f.y);
    }

    void main() {
      vAge = aAge;
      vSeed = aSeed;
      vec3 pos = position;
      float t = uTime * 1.4 + aSeed * 10.0;
      float wob = (noise(vec2(pos.y * 2.0 + t, aSeed * 5.0)) - 0.5) * uTurbulence * 0.45;
      pos.x += wob;
      pos.z += (noise(vec2(aSeed * 3.0, pos.y * 2.0 + t * 0.8)) - 0.5) * uTurbulence * 0.45;

      vec4 mv = modelViewMatrix * vec4(pos, 1.0);
      float grow = mix(1.3, 0.35, aAge);
      gl_PointSize = aSize * grow * (200.0 / max(-mv.z, 0.5));
      gl_Position = projectionMatrix * mv;
      vDist = -mv.z;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform float uIntensity;
    varying float vAge;
    varying float vSeed;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f*f*(3.0-2.0*f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p = p * 2.15 + vec2(1.7, 9.2);
        a *= 0.5;
      }
      return v;
    }

    // Hot→cool industrial fire ramp
    vec3 fireRamp(float t) {
      // t: 0 core (white-hot) → 1 tip (dark ember)
      vec3 c0 = vec3(1.0, 0.98, 0.92);
      vec3 c1 = vec3(1.0, 0.85, 0.25);
      vec3 c2 = vec3(1.0, 0.40, 0.05);
      vec3 c3 = vec3(0.55, 0.08, 0.02);
      vec3 c4 = vec3(0.08, 0.02, 0.01);
      if (t < 0.2) return mix(c0, c1, t / 0.2);
      if (t < 0.45) return mix(c1, c2, (t - 0.2) / 0.25);
      if (t < 0.7) return mix(c2, c3, (t - 0.45) / 0.25);
      return mix(c3, c4, (t - 0.7) / 0.3);
    }

    void main() {
      vec2 uv = gl_PointCoord;
      vec2 c = uv - 0.5;
      float dist = length(c);
      if (dist > 0.5) discard;

      // Domain-warped FBM flame shape
      float t = uTime * 2.2 + vSeed * 12.0;
      vec2 q = uv * vec2(2.2, 3.2);
      q.y += t * 0.6;
      vec2 warp = vec2(fbm(q + vSeed), fbm(q.yx + 4.1 + t * 0.2));
      float n = fbm(q + warp * 1.15);
      n = pow(n, 1.15);

      float soft = 1.0 - smoothstep(0.12, 0.5, dist);
      float flame = soft * n;
      flame *= smoothstep(1.05, 0.25, vAge); // die with age
      flame *= (0.7 + 0.3 * soft);

      if (flame < 0.02) discard;

      vec3 col = fireRamp(vAge * 0.85 + (1.0 - n) * 0.25);
      // HDR-ish boost for bloom-friendly output
      col *= (1.4 + uIntensity * 1.2) * flame;
      float alpha = clamp(flame * (0.9 + uIntensity * 0.3), 0.0, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

let root, firePts, emberPts, fireVel, fireAge, fireMax, emberVel, sceneRef, lastMode, lastEmber;

function buildFire(params) {
  // clear previous
  while (root.children.length) {
    const c = root.children[0];
    root.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  }

  const cfg = MODE[params.sizeMode] || MODE.mid;
  lastMode = params.sizeMode;
  lastEmber = params.emberCount;
  const n = Math.floor(cfg.count * Math.max(0.3, params.intensity));
  const pos = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  const ages = new Float32Array(n);
  const seeds = new Float32Array(n);
  fireVel = new Float32Array(n * 3);
  fireAge = new Float32Array(n);
  fireMax = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    seeds[i] = Math.random();
    sizes[i] = 18 + Math.random() * 28;
    resetFireParticle(i, pos, ages, cfg, params, true);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute('aAge', new THREE.BufferAttribute(ages, 1));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = THREE.UniformsUtils.clone(FireShader.uniforms);
  uniforms.uIntensity.value = params.intensity;
  uniforms.uTurbulence.value = params.turbulence;

  firePts = new THREE.Points(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FireShader.vertexShader,
      fragmentShader: FireShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  firePts.frustumCulled = false;
  root.add(firePts);

  // Embers
  const en = Math.max(0, params.emberCount | 0);
  if (en > 0) {
    const ep = new Float32Array(en * 3);
    const ec = new Float32Array(en * 3);
    emberVel = new Float32Array(en * 3);
    for (let i = 0; i < en; i++) {
      ep[i * 3] = (Math.random() - 0.5) * cfg.radius;
      ep[i * 3 + 1] = Math.random() * cfg.height;
      ep[i * 3 + 2] = (Math.random() - 0.5) * cfg.radius;
      emberVel[i * 3] = (Math.random() - 0.5) * 0.6;
      emberVel[i * 3 + 1] = 1.2 + Math.random() * 2.5;
      emberVel[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      ec[i * 3] = 1.5; ec[i * 3 + 1] = 0.7; ec[i * 3 + 2] = 0.15;
    }
    const egeo = new THREE.BufferGeometry();
    egeo.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    egeo.setAttribute('color', new THREE.BufferAttribute(ec, 3));
    emberPts = new THREE.Points(
      egeo,
      new THREE.PointsMaterial({
        size: 0.07,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      })
    );
    root.add(emberPts);
  } else {
    emberPts = null;
    emberVel = null;
  }

  // Base glow + ground light
  const glow = new THREE.PointLight(0xff5520, 2.4 * params.intensity, 10);
  glow.position.set(0, 0.45, 0);
  glow.name = 'fireGlow';
  root.add(glow);

  const log = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 0.9, 8),
    new THREE.MeshStandardMaterial({ color: 0x2a1810, roughness: 0.9, metalness: 0.05 })
  );
  log.rotation.z = Math.PI / 2;
  log.position.y = 0.08;
  root.add(log);
  const log2 = log.clone();
  log2.rotation.y = 1.1;
  root.add(log2);
}

function resetFireParticle(i, pos, ages, cfg, params, randomAge) {
  const a = Math.random() * Math.PI * 2;
  const r = Math.random() * cfg.radius * (0.3 + Math.random() * 0.7);
  pos[i * 3] = Math.cos(a) * r;
  pos[i * 3 + 1] = randomAge ? Math.random() * cfg.height : 0.04;
  pos[i * 3 + 2] = Math.sin(a) * r;
  fireVel[i * 3] = (Math.random() - 0.5) * params.turbulence * 0.8;
  fireVel[i * 3 + 1] = params.riseSpeed * (0.55 + Math.random() * 0.85);
  fireVel[i * 3 + 2] = (Math.random() - 0.5) * params.turbulence * 0.8;
  fireMax[i] = 0.55 + Math.random() * 0.65;
  fireAge[i] = randomAge ? Math.random() * fireMax[i] : 0;
  if (ages) ages[i] = fireAge[i] / fireMax[i];
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'fire';
  root.position.y = 0.05;
  ctx.scene.add(root);
  buildFire(params);
  ctx.camera.position.set(0, 2.6, 5.5);
  ctx.camera.lookAt(0, 1.3, 0);
  ctx.renderer.toneMappingExposure = 1.1;
}

export function update(dt, params, ctx) {
  if (!firePts) return;
  if (params.sizeMode !== lastMode || params.emberCount !== lastEmber) {
    buildFire(params);
  }

  const cfg = MODE[params.sizeMode] || MODE.mid;
  const u = firePts.material.uniforms;
  u.uTime.value = ctx.clock.elapsedTime;
  u.uIntensity.value = params.intensity;
  u.uTurbulence.value = params.turbulence;

  const pos = firePts.geometry.attributes.position.array;
  const ages = firePts.geometry.attributes.aAge.array;
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    fireAge[i] += dt;
    pos[i * 3] += fireVel[i * 3] * dt;
    pos[i * 3 + 1] += fireVel[i * 3 + 1] * params.riseSpeed * 0.12 * dt + fireVel[i * 3 + 1] * dt;
    pos[i * 3 + 2] += fireVel[i * 3 + 2] * dt;
    fireVel[i * 3] += (Math.random() - 0.5) * params.turbulence * dt * 1.5;
    fireVel[i * 3 + 2] += (Math.random() - 0.5) * params.turbulence * dt * 1.5;
    ages[i] = fireAge[i] / fireMax[i];
    if (fireAge[i] >= fireMax[i] || pos[i * 3 + 1] > cfg.height * 1.15) {
      resetFireParticle(i, pos, ages, cfg, params, false);
    }
  }
  firePts.geometry.attributes.position.needsUpdate = true;
  firePts.geometry.attributes.aAge.needsUpdate = true;

  if (emberPts && emberVel) {
    const ep = emberPts.geometry.attributes.position.array;
    const en = ep.length / 3;
    for (let i = 0; i < en; i++) {
      ep[i * 3] += emberVel[i * 3] * dt;
      ep[i * 3 + 1] += emberVel[i * 3 + 1] * dt;
      ep[i * 3 + 2] += emberVel[i * 3 + 2] * dt;
      emberVel[i * 3 + 1] -= 0.8 * dt;
      if (ep[i * 3 + 1] > cfg.height * 1.6 || ep[i * 3 + 1] < 0) {
        ep[i * 3] = (Math.random() - 0.5) * cfg.radius;
        ep[i * 3 + 1] = 0.25;
        ep[i * 3 + 2] = (Math.random() - 0.5) * cfg.radius;
        emberVel[i * 3 + 1] = 1.2 + Math.random() * 2.5;
      }
    }
    emberPts.geometry.attributes.position.needsUpdate = true;
  }

  const glow = root.getObjectByName('fireGlow');
  if (glow) {
    const flicker = Math.sin(ctx.clock.elapsedTime * 11) * 0.25
      + Math.sin(ctx.clock.elapsedTime * 23.7) * 0.12;
    glow.intensity = (2.0 + flicker) * params.intensity;
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = firePts = emberPts = fireVel = fireAge = fireMax = emberVel = sceneRef = null;
}
