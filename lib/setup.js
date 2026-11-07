/**
 * setup.js — Renderer / Scene / Camera / Lights / IBL / Resize / Animate helpers
 * Industrial dark env: ACES tonemap + RoomEnvironment PMREM for PBR reflections.
 * 渲染器、场景、相机、灯光、IBL、自适应与循环辅助
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/**
 * @param {HTMLCanvasElement} canvas
 * @returns {{ renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, clock: THREE.Clock, pmrem: THREE.PMREMGenerator }}
 */
export function createBase(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || 1, canvas.clientHeight || 1, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // Dark industrial clear — near-black cool steel
  scene.background = new THREE.Color(0x030508);
  scene.fog = new THREE.FogExp2(0x030508, 0.028);

  // Procedural IBL via RoomEnvironment (no external HDR assets)
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  try {
    const envScene = new RoomEnvironment();
    const envMap = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    if (envScene.dispose) envScene.dispose();
  } catch (err) {
    console.warn('RoomEnvironment PMREM failed', err);
  }

  const camera = new THREE.PerspectiveCamera(
    50,
    (canvas.clientWidth || 1) / Math.max(canvas.clientHeight || 1, 1),
    0.1,
    200
  );
  camera.position.set(0, 3.5, 8);
  camera.lookAt(0, 1, 0);

  const clock = new THREE.Clock();

  return { renderer, scene, camera, clock, pmrem };
}

/** 默认三点光 + 微反射地面（PBR 友好） */
export function addDefaultLights(scene) {
  const hemi = new THREE.HemisphereLight(0x6a7a9a, 0x06080c, 0.35);
  hemi.name = '__default_hemi';
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xfff2e0, 1.35);
  key.position.set(5, 10, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 40;
  key.shadow.camera.left = -12;
  key.shadow.camera.right = 12;
  key.shadow.camera.top = 12;
  key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0002;
  key.name = '__default_key';
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x4a6aff, 0.35);
  fill.position.set(-6, 3, -4);
  fill.name = '__default_fill';
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0x88aacc, 0.2);
  rim.position.set(0, 2, -8);
  rim.name = '__default_rim';
  scene.add(rim);

  // Subtle reflective industrial floor
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(14, 64),
    new THREE.MeshStandardMaterial({
      color: 0x0a0e16,
      roughness: 0.55,
      metalness: 0.45,
      envMapIntensity: 0.6,
    })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.name = '__default_ground';
  scene.add(ground);

  const grid = new THREE.GridHelper(24, 48, 0x1e2838, 0x10151f);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.55;
  grid.name = '__default_grid';
  scene.add(grid);

  return { hemi, key, fill, rim, ground, grid };
}

/** 移除默认辅助（某些特效自带环境时调用） */
export function clearDefaultHelpers(scene) {
  const names = [
    '__default_hemi', '__default_key', '__default_fill', '__default_rim',
    '__default_ground', '__default_grid',
  ];
  for (const n of names) {
    const o = scene.getObjectByName(n);
    if (o) {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    }
  }
}

export function resizeRendererToDisplaySize(renderer, camera, canvas) {
  const w = canvas.clientWidth || 1;
  const h = canvas.clientHeight || 1;
  const need = canvas.width !== Math.floor(w * renderer.getPixelRatio()) ||
    canvas.height !== Math.floor(h * renderer.getPixelRatio());
  if (need) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  return need;
}

/**
 * 启动 RAF 循环；返回 stop()
 * @param {(dt:number, elapsed:number) => void} onFrame
 */
export function startLoop(clock, onFrame) {
  let raf = 0;
  let running = true;
  function frame() {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    const elapsed = clock.elapsedTime;
    onFrame(dt, elapsed);
  }
  raf = requestAnimationFrame(frame);
  return () => {
    running = false;
    cancelAnimationFrame(raf);
  };
}
