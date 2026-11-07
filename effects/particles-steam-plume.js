/**
 * particles-steam-plume.js — Cooling-tower white mist / chimney plume / near steam
 *
 * Haber-proven stack: Canvas smokeTex (multi-blob + destination-out soft edge)
 * → InstancedMesh PlaneGeometry billboards with onBeforeCompile camera-space
 * billboard + per-instance aOp. Cool translucent vapor (not dark smoke).
 *
 * One scene, three source families (cooling towers / chimney / ground steam);
 * `preset` retunes the main knobs toward that look.
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'particles-steam-plume';
export const title = '白雾/烟羽 Steam Plume';
export const category = 'particles';

export const guiSchema = [
  {
    key: 'preset',
    label: '预设 Preset',
    options: {
      '冷却塔 Cooling': 'cooling-tower',
      '烟囱 Chimney': 'chimney',
      '蒸汽 Steam': 'steam',
    },
    default: 'cooling-tower',
  },
  { key: 'density', label: '密度 Density', min: 0.3, max: 2.5, step: 0.05, default: 1.0 },
  { key: 'opacity', label: '不透明度 Opacity', min: 0.05, max: 0.8, step: 0.01, default: 0.26 },
  { key: 'riseHeight', label: '上升高度 H', min: 3, max: 28, step: 0.5, default: 10 },
  { key: 'spread', label: '扩散 Spread', min: 0.5, max: 12, step: 0.1, default: 2.2 },
  { key: 'life', label: '寿命 Life', min: 2, max: 16, step: 0.2, default: 9 },
  { key: 'windStrength', label: '风力 Wind', min: 0, max: 2, step: 0.05, default: 0.55 },
  { key: 'sizeStart', label: '起始尺寸 Size0', min: 0.3, max: 6, step: 0.1, default: 1.6 },
  { key: 'sizeEnd', label: '结束尺寸 Size1', min: 1, max: 14, step: 0.1, default: 6.5 },
  {
    key: 'color',
    label: '颜色 Color',
    options: {
      '冷却塔青灰': '#9db3d4',
      '烟囱灰蓝': '#8090a8',
      '近景白汽': '#b0c4e0',
      '更白': '#d0dceb',
    },
    default: '#9db3d4',
  },
];

/** Preset recipes — applied when preset changes (then GUI can fine-tune) */
const PRESETS = {
  'cooling-tower': {
    density: 1.0,
    opacity: 0.26,
    riseHeight: 10,
    spread: 2.2,
    life: 9,
    windStrength: 0.55,
    sizeStart: 1.6,
    sizeEnd: 6.5,
    color: '#9db3d4',
  },
  chimney: {
    density: 0.85,
    opacity: 0.2,
    riseHeight: 16,
    spread: 1.6,
    life: 8,
    windStrength: 0.5,
    sizeStart: 1.0,
    sizeEnd: 4.5,
    color: '#8090a8',
  },
  steam: {
    density: 1.4,
    opacity: 0.3,
    riseHeight: 5,
    spread: 1.4,
    life: 5,
    windStrength: 0.35,
    sizeStart: 1.2,
    sizeEnd: 3.8,
    color: '#b0c4e0',
  },
};

let root, sceneRef, plumeMesh, aOpAttr;
let items = [];
let sources = [];
let propsGroup = null;
let presetCache = '';
let densCache = -1;
let colorCache = '';
const M4 = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const P = new THREE.Vector3();
const SC = new THREE.Vector3();
const tmpColor = new THREE.Color();

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/** Haber plant.js smokeTex: multilayer radial blobs + destination-out soft edge */
function smokeTex() {
  return canvasTex(256, 256, (g) => {
    for (let i = 0; i < 28; i++) {
      const x = 128 + (Math.random() - 0.5) * 120;
      const y = 128 + (Math.random() - 0.5) * 120;
      const r = 30 + Math.random() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,.18)');
      gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, 256, 256);
    }
    const m = g.createRadialGradient(128, 128, 60, 128, 128, 128);
    m.addColorStop(0, 'rgba(0,0,0,0)');
    m.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = m;
    g.fillRect(0, 0, 256, 256);
  });
}

/** Haber motion.js billboardMat — camera-space billboard + aOp */
function billboardMat(map) {
  const m = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    fog: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aOp; varying float vOp;',
      )
      .replace(
        '#include <project_vertex>',
        [
          'vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);',
          'mvPosition.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));',
          'gl_Position = projectionMatrix * mvPosition;',
          'vOp = aOp;',
        ].join('\n'),
      );
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vOp;')
      .replace(
        '#include <opaque_fragment>',
        'diffuseColor.a *= vOp;\n#include <opaque_fragment>',
      );
  };
  return m;
}

function rnd(a = 0, b = 1) {
  return a + (b - a) * Math.random();
}

function hyperboloidTower(mat, H = 4.2, rBot = 1.35, rTop = 0.85, rThroat = 0.72) {
  const g = new THREE.Group();
  const seg = 28;
  const profile = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const y = t * H;
    // approximate cooling-tower waist
    const mid = 0.42;
    const r =
      t < mid
        ? THREE.MathUtils.lerp(rBot, rThroat, t / mid)
        : THREE.MathUtils.lerp(rThroat, rTop, (t - mid) / (1 - mid));
    profile.push(new THREE.Vector2(r, y));
  }
  const lathe = new THREE.LatheGeometry(profile, seg);
  const shell = new THREE.Mesh(lathe, mat);
  shell.castShadow = true;
  shell.receiveShadow = true;
  g.add(shell);
  // rim ring
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(rTop * 0.98, 0.06, 8, 24),
    mat,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = H;
  g.add(rim);
  g.userData.mouthY = H;
  g.userData.mouthR = rTop * 0.55;
  return g;
}

function makeChimney(mat, H = 9, r = 0.38) {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 0.85, r, H, 16),
    mat,
  );
  shaft.position.y = H / 2;
  shaft.castShadow = true;
  g.add(shaft);
  const lip = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.05, r * 0.95, 0.18, 16),
    mat,
  );
  lip.position.y = H;
  g.add(lip);
  g.userData.mouthY = H + 0.05;
  g.userData.mouthR = r * 0.5;
  return g;
}

function makeSteamVent(mat) {
  const g = new THREE.Group();
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.45, 0.22, 16),
    mat,
  );
  base.position.y = 0.11;
  base.castShadow = true;
  g.add(base);
  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.14, 0.55, 12),
    mat,
  );
  pipe.position.y = 0.45;
  g.add(pipe);
  g.userData.mouthY = 0.75;
  g.userData.mouthR = 0.1;
  return g;
}

function buildProps() {
  if (propsGroup) {
    root.remove(propsGroup);
    disposeDeep(propsGroup);
  }
  propsGroup = new THREE.Group();
  propsGroup.name = 'steamProps';

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x8a9098,
    roughness: 0.78,
    metalness: 0.08,
  });
  const steel = new THREE.MeshStandardMaterial({
    color: 0x6a7380,
    roughness: 0.45,
    metalness: 0.65,
  });
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({
      color: 0x2a2e34,
      roughness: 0.92,
      metalness: 0.05,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  propsGroup.add(ground);

  // 3 cooling towers in a row
  const towerXs = [-5.5, 0, 5.5];
  sources = [];
  for (let i = 0; i < 3; i++) {
    const tw = hyperboloidTower(concrete);
    tw.position.set(towerXs[i], 0, -2.5);
    propsGroup.add(tw);
    sources.push({
      kind: 'cooling-tower',
      x: towerXs[i],
      y: tw.userData.mouthY,
      z: -2.5,
      // relative scale vs GUI (Haber-ish ratios)
      nBase: 14,
      Hmul: 1.0,
      spreadMul: 1.0,
      sizeMul: 1.0,
      opMul: 1.0,
      lifeMul: 1.0,
      colorHex: 0x9db3d4,
    });
  }

  // chimney
  const chim = makeChimney(steel, 9.5, 0.42);
  chim.position.set(10.5, 0, 1.5);
  propsGroup.add(chim);
  sources.push({
    kind: 'chimney',
    x: 10.5,
    y: chim.userData.mouthY,
    z: 1.5,
    nBase: 10,
    Hmul: 1.45,
    spreadMul: 0.75,
    sizeMul: 0.7,
    opMul: 0.85,
    lifeMul: 0.9,
    colorHex: 0x8090a8,
  });

  // ground steam vents
  for (const [x, z] of [
    [-3.2, 3.8],
    [2.8, 4.2],
  ]) {
    const vent = makeSteamVent(steel);
    vent.position.set(x, 0, z);
    propsGroup.add(vent);
    sources.push({
      kind: 'steam',
      x,
      y: vent.userData.mouthY,
      z,
      nBase: 8,
      Hmul: 0.45,
      spreadMul: 0.55,
      sizeMul: 0.55,
      opMul: 1.05,
      lifeMul: 0.55,
      colorHex: 0xb0c4e0,
    });
  }

  // subtle cool fill light near towers
  const fill = new THREE.PointLight(0xa8c4e8, 0.45, 28);
  fill.position.set(0, 6, 2);
  propsGroup.add(fill);

  root.add(propsGroup);
}

function disposeDeep(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

function applyPresetToParams(params) {
  const p = PRESETS[params.preset] || PRESETS['cooling-tower'];
  params.density = p.density;
  params.opacity = p.opacity;
  params.riseHeight = p.riseHeight;
  params.spread = p.spread;
  params.life = p.life;
  params.windStrength = p.windStrength;
  params.sizeStart = p.sizeStart;
  params.sizeEnd = p.sizeEnd;
  params.color = p.color;
}

function rebuildPlumes(params) {
  if (plumeMesh) {
    root.remove(plumeMesh);
    if (plumeMesh.geometry) plumeMesh.geometry.dispose();
    if (plumeMesh.material) {
      if (plumeMesh.material.map) plumeMesh.material.map.dispose();
      plumeMesh.material.dispose();
    }
    plumeMesh = null;
  }

  items = [];
  const dens = Math.max(0.25, params.density);
  for (const s of sources) {
    // Bias density toward active preset kind
    let bias = 1;
    if (params.preset === 'cooling-tower') {
      bias = s.kind === 'cooling-tower' ? 1.15 : s.kind === 'steam' ? 0.7 : 0.75;
    } else if (params.preset === 'chimney') {
      bias = s.kind === 'chimney' ? 1.35 : s.kind === 'cooling-tower' ? 0.65 : 0.7;
    } else if (params.preset === 'steam') {
      bias = s.kind === 'steam' ? 1.5 : 0.7;
    }
    const n = Math.max(2, Math.round(s.nBase * dens * bias));
    for (let i = 0; i < n; i++) {
      items.push({
        s,
        ph: i / n + rnd(0, 0.05),
        jx: rnd(-1, 1),
        jz: rnd(-1, 1),
      });
    }
  }

  const geo = new THREE.PlaneGeometry(1, 1);
  const op = new Float32Array(items.length);
  aOpAttr = new THREE.InstancedBufferAttribute(op, 1);
  aOpAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aOp', aOpAttr);

  const mat = billboardMat(smokeTex());
  plumeMesh = new THREE.InstancedMesh(geo, mat, items.length);
  plumeMesh.frustumCulled = false;
  plumeMesh.renderOrder = 5;
  plumeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  plumeMesh.count = items.length;

  const guiCol = new THREE.Color(params.color || '#9db3d4');
  items.forEach((it, i) => {
    // Blend source characteristic color with GUI color
    tmpColor.set(it.s.colorHex).lerp(guiCol, 0.55);
    plumeMesh.setColorAt(i, tmpColor);
  });
  if (plumeMesh.instanceColor) plumeMesh.instanceColor.needsUpdate = true;

  root.add(plumeMesh);
  densCache = params.density;
  colorCache = params.color;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'steamPlume';

  if (!params.preset) params.preset = 'cooling-tower';
  // seed from preset if still defaults-ish on first load
  presetCache = params.preset;
  applyPresetToParams(params);

  buildProps();
  rebuildPlumes(params);

  ctx.scene.add(root);
  ctx.camera.position.set(8.5, 7.5, 16);
  ctx.camera.lookAt(1, 5, -1);
  if (ctx.controls) {
    ctx.controls.target.set(1, 4.5, -1);
    ctx.controls.update();
  }
}

export function update(dt, params, ctx) {
  if (!root || !plumeMesh) return;

  // Topology / recipe rebuild
  if (params.preset !== presetCache) {
    presetCache = params.preset;
    applyPresetToParams(params);
    rebuildPlumes(params);
  } else if (
    Math.abs(params.density - densCache) > 0.04 ||
    params.color !== colorCache
  ) {
    rebuildPlumes(params);
  }

  const t = ctx.clock.elapsedTime;
  const windK = params.windStrength;
  const H0 = params.riseHeight;
  const spread0 = params.spread;
  const life0 = Math.max(0.5, params.life);
  const size0 = params.sizeStart;
  const size1 = params.sizeEnd;
  const op0 = params.opacity;
  const opArr = aOpAttr.array;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const s = it.s;
    const life = life0 * s.lifeMul;
    const u = (it.ph + t / life) % 1;
    const H = H0 * s.Hmul;
    const spread = spread0 * s.spreadMul;
    const wind = u * u * H * windK;
    P.set(
      s.x + it.jx * u * spread + wind,
      s.y + u * H,
      s.z + it.jz * u * spread + wind * 0.3,
    );
    const sc0 = size0 * s.sizeMul;
    const sc1 = size1 * s.sizeMul;
    const sc = sc0 + (sc1 - sc0) * u;
    SC.set(sc, sc, 1);
    M4.compose(P, Q.identity(), SC);
    plumeMesh.setMatrixAt(i, M4);
    // Haber opacity envelope
    opArr[i] = op0 * s.opMul * Math.min(1, u * 6) * (1 - u) * 1.3;
  }
  plumeMesh.instanceMatrix.needsUpdate = true;
  aOpAttr.needsUpdate = true;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = sceneRef = plumeMesh = aOpAttr = propsGroup = null;
  items = [];
  sources = [];
  presetCache = '';
  densCache = -1;
  colorCache = '';
}
