/**
 * gallery-bridge.js — Minimal runtime so vendored Ability classes can cast
 * without App / CharacterController / HUD / Input.
 *
 * Provides: scene, camera, stub environment (shader patch hook), ParticleEngine,
 * LightPool, DecalSystem, FissureSystem, BurstSystem, CameraShake stub, ScreenFlash.
 * Aims fixed along +Z (flat). Auto-recasts on an interval.
 *
 * Full live knobs: see config/settings.js (938 params in the original editor).
 */
import * as THREE from 'three';
import { AbilityManager } from './abilities/AbilityManager.js';
import { FireAbility } from './archive/abilities/FireAbility.js';
import { WaterAbility } from './archive/abilities/WaterAbility.js';
import { EarthAbility } from './archive/abilities/EarthAbility.js';
import { WindAbility } from './archive/abilities/WindAbility.js';
import { ParticleEngine } from './particles/ParticleEngine.js';
import { LightPool } from './effects/LightPool.js';
import { DecalSystem } from './effects/GroundDecals.js';
import { FissureSystem } from './effects/GroundFissures.js';
import { BurstSystem } from './effects/BurstSphere.js';
import { ScreenFlash } from './effects/ScreenFlash.js';
import { LAYER } from './core/Layers.js';
import { frame } from './core/FrameUniforms.js';
import { settings } from './config/settings.js';
import { patchOnBeforeCompile } from './utils/shaderPatch.js';

const _origin = new THREE.Vector3(0, 0, 0);
const _dir = new THREE.Vector3(0, 0, 1);
const _size = new THREE.Vector2();

/** Stub Environment: only the hooks materials call (no HDR / CSM / fog). */
function createStubEnvironment(scene) {
  return {
    scene,
    equirect: null,
    registerShadowCaster(material) {
      return material;
    },
    registerShadowCasterWithPatch(material, patch) {
      patchOnBeforeCompile(material, patch);
      return material;
    },
  };
}

/** CameraShake without CameraRig — trauma decays; optional mild camera nudge. */
function createShakeStub(camera) {
  const shakeOffset = new THREE.Vector3();
  let shakeRoll = 0;
  let trauma = 0;
  let decay = 1.6;
  let frequency = 22;
  let t = 0;
  const basePos = camera.position.clone();

  return {
    rig: { shakeOffset, get shakeRoll() { return shakeRoll; }, set shakeRoll(v) { shakeRoll = v; } },
    add(amount, d = 1.6, f = 22) {
      trauma = Math.min(1, trauma + amount * settings.global.cameraShake);
      decay = d;
      frequency = f;
    },
    rumble(amount, dt) {
      trauma = Math.min(1, trauma + amount * settings.global.cameraShake * dt * 3);
    },
    update(dt) {
      t += dt;
      if (trauma <= 0.0001) {
        shakeOffset.set(0, 0, 0);
        shakeRoll = 0;
        return;
      }
      const shake = trauma * trauma;
      const tt = t * frequency;
      const nx = Math.sin(tt) * 0.6 + Math.sin(tt * 2.31 + 1.7) * 0.4;
      const ny = Math.sin(tt * 1.37 + 4.2) * 0.6 + Math.sin(tt * 2.79 + 0.3) * 0.4;
      const nz = Math.sin(tt * 0.83 + 2.9) * 0.6 + Math.sin(tt * 3.11 + 5.1) * 0.4;
      shakeOffset.set(nx, ny * 0.7, nz).multiplyScalar(shake * 0.35);
      shakeRoll = nz * shake * 0.02;
      trauma = Math.max(0, trauma - decay * dt);
      // Soft apply: do not fight Orbit — just a tiny positional jitter from base.
      camera.position.set(
        basePos.x + shakeOffset.x,
        basePos.y + shakeOffset.y,
        basePos.z + shakeOffset.z,
      );
    },
    reset() {
      trauma = 0;
      shakeOffset.set(0, 0, 0);
      shakeRoll = 0;
      camera.position.copy(basePos);
    },
    rememberBase() {
      basePos.copy(camera.position);
    },
  };
}

/**
 * Mount one ability element into the gallery scene.
 * @param {object} galleryCtx { scene, camera, renderer, clock }
 * @param {string} element  settings key: ice|thunder|meteor|beam|snare|glacier
 * @param {object} params   gui params (intensity, length, recastInterval, color, …)
 * @returns {{ update(dt, params), dispose() }}
 */
export function mountAbility(galleryCtx, element, params = {}) {
  const { scene, camera, renderer } = galleryCtx;

  // Soft-particle / burst shaders sample uSceneDepth; give a 1x1 stub so
  // texture2D never hits a null sampler (full depth prepass is App-only).
  if (!frame.uSceneDepth.value) {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  // See VFX layer (abilities / particles / decals live on LAYER.VFX = 1)
  camera.layers.enable(LAYER.WORLD);
  camera.layers.enable(LAYER.VFX);
  camera.layers.enable(LAYER.DISTORTION);

  // Framing: look down the cast line (+Z)
  camera.position.set(-6, 8, -10);
  camera.lookAt(0, 1.2, 8);
  camera.near = 0.1;
  camera.far = 400;
  camera.updateProjectionMatrix();
  if (renderer) {
    renderer.toneMappingExposure = 1.15;
  }

  // Fake ground under the cast (gallery already has a default ground; add a dark plate)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  ground.name = 'linear-ability-ground';
  ground.layers.set(LAYER.WORLD);
  scene.add(ground);

  // Simple caster stand-in (no character GLB)
  const caster = new THREE.Group();
  caster.name = 'linear-ability-caster';
  const bodyGeo = (typeof THREE.CapsuleGeometry === 'function')
    ? new THREE.CapsuleGeometry(0.35, 0.9, 4, 8)
    : new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({ color: 0x3a4555, roughness: 0.7 }),
  );
  body.position.y = 0.85;
  body.layers.set(LAYER.WORLD);
  caster.add(body);
  scene.add(caster);

  const environment = createStubEnvironment(scene);
  const particles = new ParticleEngine(scene);
  const lights = new LightPool(scene);
  const decals = new DecalSystem(scene);
  const fissures = new FissureSystem(scene);
  const bursts = new BurstSystem(scene);
  const shake = createShakeStub(camera);
  const flash = new ScreenFlash();

  const abilityCtx = {
    scene,
    camera,
    environment,
    particles,
    lights,
    decals,
    fissures,
    bursts,
    shake,
    flash,
  };

  const manager = new AbilityManager(abilityCtx);
  // Prewarm so first cast does not hitch on geometry/shader compile
  try {
    manager.prewarm(element);
  } catch (err) {
    console.warn('[gallery-bridge] prewarm', element, err);
  }

  let elapsed = 0;
  let sinceCast = 999;
  let disposed = false;

  function applyParams(p) {
    const g = settings.global;
    if (p.intensity != null) {
      g.shaderIntensity = p.intensity;
      g.glow = p.intensity;
      g.lightIntensity = p.intensity;
      g.explosionIntensity = p.intensity;
      frame.uShaderIntensity.value = p.intensity;
      frame.uGlobalGlow.value = p.intensity;
    }
    if (p.color && settings[element]) {
      // Best-effort primary tint — each ability names colours differently
      const block = settings[element];
      const keys = [
        'colorCore', 'coreColor', 'colorHot', 'boltColor', 'beamColor',
        'colorIce', 'colorDeep', 'primaryColor', 'lightColor',
      ];
      for (const k of keys) {
        if (k in block) {
          block[k] = p.color;
          break;
        }
      }
      if ('lightColor' in block) block.lightColor = p.color;
    }
    if (p.length != null && settings[element] && 'range' in settings[element]) {
      // length GUI scales cast distance; keep within sensible band
      settings[element].range = Math.max(4, p.length);
    }
    if (p.zoneRadius != null && settings[element] && 'zoneRadius' in settings[element]) {
      settings[element].zoneRadius = Math.max(1, p.zoneRadius);
    }
  }

  function doCast(p) {
    applyParams(p);
    const range = settings[element]?.range ?? 16;
    const distance = Math.max(4, p.length ?? range);
    _origin.set(0, 0, 0);
    _dir.set(0, 0, 1);
    manager.cast(_origin, _dir, distance, element);
    sinceCast = 0;
  }

  // First cast immediately
  doCast(params);

  return {
    update(dt, p = params) {
      if (disposed) return;
      const raw = Math.min(dt, 0.05);
      const scaled = raw * (settings.global.timeScale || 1);
      elapsed += scaled;
      sinceCast += scaled;

      frame.uTime.value = elapsed;
      frame.uDelta.value = scaled;
      if (renderer) {
        renderer.getSize(_size);
        frame.uResolution.value.copy(_size);
        frame.uCameraNear.value = camera.near;
        frame.uCameraFar.value = camera.far;
      }

      applyParams(p);

      const interval = Math.max(1.5, p.recastInterval ?? 4);
      // Recast when idle long enough (ability finished + interval)
      if (sinceCast >= interval && manager.active.length === 0) {
        doCast(p);
      } else if (sinceCast >= interval * 1.8) {
        // Force clear + recast if something stuck
        manager.clear();
        doCast(p);
      }

      manager.update(scaled);
      particles.flush();
      decals.update(scaled);
      fissures.update(scaled);
      bursts.update(scaled);
      lights.update(scaled);
      shake.update(raw);
      flash.update(raw);
    },
    dispose() {
      disposed = true;
      try { manager.dispose(); } catch (_) { /* */ }
      try { particles.dispose(); } catch (_) { /* */ }
      try { decals.dispose(); } catch (_) { /* */ }
      try { fissures.dispose(); } catch (_) { /* */ }
      try { bursts.dispose(); } catch (_) { /* */ }
      try { lights.dispose(); } catch (_) { /* */ }
      try { shake.reset(); } catch (_) { /* */ }
      scene.remove(ground);
      scene.remove(caster);
      ground.geometry.dispose();
      ground.material.dispose();
      body.geometry.dispose();
      body.material.dispose();
    },
  };
}


const ARCHIVE_CTORS = {
  fire: FireAbility,
  water: WaterAbility,
  earth: EarthAbility,
  wind: WindAbility,
};

/**
 * Mount an archived spline-driven ability (Fire/Water/Earth/Wind).
 * Builds a CatmullRomCurve3 along +Z and calls ability.spawn(curve).
 * Same stubs / auto-recast as mountAbility.
 */
export function mountArchiveAbility(galleryCtx, element, params = {}) {
  const Ctor = ARCHIVE_CTORS[element];
  if (!Ctor) throw new Error(`Unknown archive element: ${element}`);

  const { scene, camera, renderer } = galleryCtx;

  if (!frame.uSceneDepth.value) {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1);
    tex.needsUpdate = true;
    frame.uSceneDepth.value = tex;
  }

  camera.layers.enable(LAYER.WORLD);
  camera.layers.enable(LAYER.VFX);
  camera.layers.enable(LAYER.DISTORTION);

  camera.position.set(-6, 8, -10);
  camera.lookAt(0, 1.2, 8);
  camera.near = 0.1;
  camera.far = 400;
  camera.updateProjectionMatrix();
  if (renderer) renderer.toneMappingExposure = 1.15;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({
      color: 0x1a1e24,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  ground.name = 'linear-ability-ground';
  ground.layers.set(LAYER.WORLD);
  scene.add(ground);

  const caster = new THREE.Group();
  caster.name = 'linear-ability-caster';
  const bodyGeo = (typeof THREE.CapsuleGeometry === 'function')
    ? new THREE.CapsuleGeometry(0.35, 0.9, 4, 8)
    : new THREE.CylinderGeometry(0.35, 0.35, 1.6, 8);
  const body = new THREE.Mesh(
    bodyGeo,
    new THREE.MeshStandardMaterial({ color: 0x3a4555, roughness: 0.7 }),
  );
  body.position.y = 0.85;
  body.layers.set(LAYER.WORLD);
  caster.add(body);
  scene.add(caster);

  const environment = createStubEnvironment(scene);
  const particles = new ParticleEngine(scene);
  const lights = new LightPool(scene);
  const decals = new DecalSystem(scene);
  const fissures = new FissureSystem(scene);
  const bursts = new BurstSystem(scene);
  const shake = createShakeStub(camera);
  const flash = new ScreenFlash();

  const abilityCtx = {
    scene,
    camera,
    environment,
    particles,
    lights,
    decals,
    fissures,
    bursts,
    shake,
    flash,
  };

  const ability = new Ctor(abilityCtx);
  scene.add(ability.group);

  let elapsed = 0;
  let sinceCast = 999;
  let disposed = false;

  function applyParams(p) {
    const g = settings.global;
    if (p.intensity != null) {
      g.shaderIntensity = p.intensity;
      g.glow = p.intensity;
      g.lightIntensity = p.intensity;
      g.explosionIntensity = p.intensity;
      frame.uShaderIntensity.value = p.intensity;
      frame.uGlobalGlow.value = p.intensity;
    }
    const block = settings[element];
    if (p.color && block) {
      const keys = [
        'colorCore', 'colorMid', 'colorEdge', 'colorHot',
        'colorDeep', 'colorShallow', 'colorFoam',
        'colorRock', 'colorInner', 'colorOuter',
        'lightColor', 'primaryColor',
      ];
      for (const k of keys) {
        if (k in block) {
          block[k] = p.color;
          break;
        }
      }
      if ('lightColor' in block) block.lightColor = p.color;
    }
  }

  function buildCurve(length) {
    const L = Math.max(4, length ?? 16);
    // Slight lift so water/earth read against ground; fire flies via pathHeight
    const y = 0.05;
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, y, 0),
      new THREE.Vector3(0, y + 0.15, L * 0.35),
      new THREE.Vector3(0, y + 0.08, L * 0.7),
      new THREE.Vector3(0, y, L),
    ], false, 'catmullrom', 0.5);
  }

  function doCast(p) {
    applyParams(p);
    // DONE / leftover travel must be destroyed so spawn can reset cleanly
    if (ability.phase !== 'idle') {
      try { ability.destroy(); } catch (_) { /* */ }
    }
    const len = p.length
      ?? settings[element]?.streamLength
      ?? settings[element]?.ribbonLength
      ?? 16;
    const curve = buildCurve(len);
    ability.spawn(curve);
    sinceCast = 0;
  }

  doCast(params);

  return {
    update(dt, p = params) {
      if (disposed) return;
      const raw = Math.min(dt, 0.05);
      const scaled = raw * (settings.global.timeScale || 1);
      elapsed += scaled;
      sinceCast += scaled;

      frame.uTime.value = elapsed;
      frame.uDelta.value = scaled;
      if (renderer) {
        renderer.getSize(_size);
        frame.uResolution.value.copy(_size);
        frame.uCameraNear.value = camera.near;
        frame.uCameraFar.value = camera.far;
      }

      applyParams(p);

      const interval = Math.max(1.5, p.recastInterval ?? 4);
      if (ability.isFinished || ability.phase === 'done' || ability.phase === 'idle') {
        if (sinceCast >= interval) {
          doCast(p);
        }
      } else if (sinceCast >= interval * 2.2) {
        try { ability.destroy(); } catch (_) { /* */ }
        doCast(p);
      }

      ability.update(scaled);
      particles.flush();
      decals.update(scaled);
      fissures.update(scaled);
      bursts.update(scaled);
      lights.update(scaled);
      shake.update(raw);
      flash.update(raw);
    },
    dispose() {
      disposed = true;
      try { if (ability.isActive) ability.destroy(); } catch (_) { /* */ }
      try { ability.dispose(); } catch (_) { /* */ }
      try { particles.dispose(); } catch (_) { /* */ }
      try { decals.dispose(); } catch (_) { /* */ }
      try { fissures.dispose(); } catch (_) { /* */ }
      try { bursts.dispose(); } catch (_) { /* */ }
      try { lights.dispose(); } catch (_) { /* */ }
      try { shake.reset(); } catch (_) { /* */ }
      scene.remove(ground);
      scene.remove(caster);
      ground.geometry.dispose();
      ground.material.dispose();
      body.geometry.dispose();
      body.material.dispose();
    },
  };
}

/** Shared guiSchema knobs for skillshot demos. Full params → settings.js */
export function skillshotGuiSchema(extra = []) {
  return [
    { key: 'intensity', label: '强度 Intensity', min: 0.3, max: 2.0, step: 0.05, default: 1.0 },
    { key: 'length', label: '射程 Length', min: 6, max: 36, step: 0.5, default: 16 },
    { key: 'recastInterval', label: '重放间隔 Recast s', min: 2, max: 10, step: 0.5, default: 4 },
    {
      key: 'color',
      label: '主色 Color',
      options: {
        '冰蓝 Ice': '#5fd0ff',
        '电蓝 Storm': '#7fb4ff',
        '熔火 Ember': '#ff8a3c',
        '新星 Cyan': '#7ff0ff',
        '伏特 Violet': '#a98bff',
        '霜白 Frost': '#8ee8ff',
        '烈焰 Fire': '#ff6a1a',
        '碧水 Water': '#31b6ff',
        '岩土 Earth': '#b98a4d',
        '清风 Air': '#c9f0ff',
      },
      default: '#5fd0ff',
    },
    ...extra,
  ];
}

export { settings, frame, LAYER };
