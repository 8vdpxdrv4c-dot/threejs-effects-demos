/**
 * post-dof-bloom.js — Filmic post stack: UnrealBloom + Bokeh/DOF + ACES-ish tonemap + grain
 *
 * Technique: EffectComposer chain —
 *   RenderPass → BokehPass → UnrealBloomPass → TonemapShader (ACES approx) → GrainShader
 * Quality presets actually change pass resolution (composer pixelRatio / bloom res)
 * and bloom strength / DOF maxblur.
 *
 * Params: focusDistance, aperture, maxBlur, bloomStrength, bloomRadius, grain, quality, exposure
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { removeAndDispose, disposeComposer } from '../lib/dispose.js';

export const id = 'post-dof-bloom';
export const title = '景深辉光 DOF+Bloom';
export const category = 'postprocessing';

export const guiSchema = [
  { key: 'focusDistance', label: '焦距 FocusDist', min: 0.5, max: 20, step: 0.1, default: 6 },
  { key: 'aperture', label: '光圈 Aperture', min: 0.0001, max: 0.01, step: 0.0001, default: 0.0025 },
  { key: 'maxBlur', label: '最大模糊 MaxBlur', min: 0.001, max: 0.02, step: 0.0005, default: 0.008 },
  { key: 'bloomStrength', label: '辉光强度 Bloom', min: 0, max: 3, step: 0.05, default: 1.15 },
  { key: 'bloomRadius', label: '辉光半径 Radius', min: 0, max: 1.5, step: 0.05, default: 0.45 },
  { key: 'grain', label: '颗粒 Grain', min: 0, max: 0.3, step: 0.005, default: 0.055 },
  { key: 'exposure', label: '曝光 Exposure', min: 0.3, max: 2.5, step: 0.05, default: 1.05 },
  { key: 'quality', label: '质量 Quality', options: { 低: 'low', 中: 'mid', 高: 'high', 电影: 'cinematic' }, default: 'mid' },
];

const QUALITY = {
  low: { pr: 0.6, bloomMul: 0.55, blurMul: 0.6, bloomRes: 0.5 },
  mid: { pr: 1.0, bloomMul: 1.0, blurMul: 1.0, bloomRes: 1.0 },
  high: { pr: Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 1.75), bloomMul: 1.15, blurMul: 1.1, bloomRes: 1.25 },
  cinematic: { pr: Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2), bloomMul: 1.35, blurMul: 1.25, bloomRes: 1.5 },
};

/** ACES approximation filmic tonemap (Narkowicz / Krzysztof) */
const TonemapShader = {
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    varying vec2 vUv;

    vec3 ACESFilm(vec3 x) {
      float a = 2.51;
      float b = 0.03;
      float c = 2.43;
      float d = 0.59;
      float e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = tex.rgb * uExposure;
      c = ACESFilm(c);
      // mild vignette for cinematic feel
      float r = length(vUv - 0.5);
      c *= 1.0 - smoothstep(0.55, 1.15, r) * 0.35;
      gl_FragColor = vec4(c, tex.a);
    }
  `,
};

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAmount: { value: 0.05 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uAmount;
    uniform float uTime;
    varying vec2 vUv;
    float rand(vec2 co) {
      return fract(sin(dot(co.xy, vec2(12.9898, 78.233)) + uTime * 17.0) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = rand(vUv) * 2.0 - 1.0;
      // luma-weighted grain (less on highlights)
      float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb += n * uAmount * (1.0 - luma * 0.5);
      gl_FragColor = c;
    }
  `,
};

let root, composer, bloomPass, bokehPass, tonemapPass, grainPass;
let sceneRef, lastQuality, setComposerFn, baseW, baseH;

function qualityCfg(q) {
  return QUALITY[q] || QUALITY.mid;
}

function buildComposer(ctx, params) {
  if (composer) {
    disposeComposer(composer);
    composer = null;
  }
  const q = qualityCfg(params.quality);
  lastQuality = params.quality;
  baseW = ctx.renderer.domElement.clientWidth || 1;
  baseH = ctx.renderer.domElement.clientHeight || 1;

  ctx.renderer.setPixelRatio(q.pr);
  ctx.renderer.setSize(baseW, baseH, false);

  composer = new EffectComposer(ctx.renderer);
  composer.addPass(new RenderPass(ctx.scene, ctx.camera));

  bokehPass = new BokehPass(ctx.scene, ctx.camera, {
    focus: params.focusDistance,
    aperture: params.aperture,
    maxblur: params.maxBlur * q.blurMul,
  });
  composer.addPass(bokehPass);

  const bw = Math.max(1, Math.floor(baseW * q.bloomRes));
  const bh = Math.max(1, Math.floor(baseH * q.bloomRes));
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(bw, bh),
    params.bloomStrength * q.bloomMul,
    params.bloomRadius,
    0.35
  );
  composer.addPass(bloomPass);

  tonemapPass = new ShaderPass(TonemapShader);
  tonemapPass.uniforms.uExposure.value = params.exposure;
  composer.addPass(tonemapPass);

  grainPass = new ShaderPass(GrainShader);
  grainPass.uniforms.uAmount.value = params.grain;
  composer.addPass(grainPass);

  composer.setSize(baseW, baseH);
  if (setComposerFn) setComposerFn(composer);
  else ctx.composer = composer;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'postDofBloom';
  setComposerFn = ctx.setComposer || null;

  // Emissive subject balls at different depths for DOF read
  const depths = [2, 5, 9, 14];
  const cols = [0xff3366, 0x33ffaa, 0x66aaff, 0xffcc33];
  depths.forEach((z, i) => {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 32, 32),
      new THREE.MeshStandardMaterial({
        color: cols[i],
        emissive: cols[i],
        emissiveIntensity: 2.2,
        roughness: 0.25,
        metalness: 0.15,
      })
    );
    m.position.set((i - 1.5) * 1.5, 1.2, -z + 8);
    root.add(m);
  });

  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1.3, 1.3, 1.3),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x334466,
      emissiveIntensity: 0.4,
      roughness: 0.35,
      metalness: 0.5,
    })
  );
  box.position.set(0, 1.2, 0);
  box.name = 'focusTarget';
  root.add(box);

  // Neon ring accent
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.8, 0.04, 12, 64),
    new THREE.MeshStandardMaterial({
      color: 0x66ccff,
      emissive: 0x2288ff,
      emissiveIntensity: 2.5,
      roughness: 0.2,
    })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.15;
  ring.name = 'neonRing';
  root.add(ring);

  ctx.scene.add(root);
  ctx.camera.position.set(0, 2.2, 6);
  ctx.camera.lookAt(0, 1.2, 0);

  // Disable renderer tonemap — we do ACES in the pass to avoid double-map
  ctx.renderer.toneMapping = THREE.NoToneMapping;
  buildComposer(ctx, params);
}

export function update(dt, params, ctx) {
  if (!composer) return;

  if (params.quality !== lastQuality) {
    buildComposer(ctx, params);
  }

  const q = qualityCfg(params.quality);
  if (bokehPass?.uniforms) {
    if (bokehPass.uniforms.focus) bokehPass.uniforms.focus.value = params.focusDistance;
    if (bokehPass.uniforms.aperture) bokehPass.uniforms.aperture.value = params.aperture;
    if (bokehPass.uniforms.maxblur) bokehPass.uniforms.maxblur.value = params.maxBlur * q.blurMul;
  }
  if (bokehPass?.material?.uniforms?.focus) {
    bokehPass.material.uniforms.focus.value = params.focusDistance;
    bokehPass.material.uniforms.aperture.value = params.aperture;
    bokehPass.material.uniforms.maxblur.value = params.maxBlur * q.blurMul;
  }
  bloomPass.strength = params.bloomStrength * q.bloomMul;
  bloomPass.radius = params.bloomRadius;
  tonemapPass.uniforms.uExposure.value = params.exposure;
  grainPass.uniforms.uAmount.value = params.grain;
  grainPass.uniforms.uTime.value = ctx.clock.elapsedTime;

  const box = root.getObjectByName('focusTarget');
  if (box) box.rotation.y += dt * 0.4;
  const ring = root.getObjectByName('neonRing');
  if (ring) {
    ring.rotation.z += dt * 0.15;
    ring.material.emissiveIntensity = 2.2 + Math.sin(ctx.clock.elapsedTime * 2) * 0.4;
  }
}

export function dispose() {
  if (composer) disposeComposer(composer);
  if (setComposerFn) setComposerFn(null);
  // Restore default tonemap on host renderer if still around
  composer = bloomPass = bokehPass = tonemapPass = grainPass = null;
  setComposerFn = null;
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = sceneRef = null;
}
