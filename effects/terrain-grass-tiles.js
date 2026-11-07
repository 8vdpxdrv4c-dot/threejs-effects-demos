/**
 * terrain-grass-tiles.js — Camera-tiled grass field with LOD + wind
 *
 * Architecture (original WebGL/GLSL — inspired by publicly documented
 * tiled-grass ideas, NOT a port of any proprietary Grassworks source):
 *  1. Camera-relative tile grid (tileSize / maxDistance); recycle far tiles
 *  2. Terrain-aware: FBM height-displaced plane; blades sample same heightmap
 *  3. Instanced blade LOD: high / medium / low / veryLow (density + segments)
 *  4. Wind in vertex shader (tip bends more than base)
 *  5. Optional soft influence sphere that flattens nearby blades
 *  6. Soft circular fade near maxDistance
 *
 * GPU budget (mid): ~40–80 tiles, ≤ ~80k instances total.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'terrain-grass-tiles';
export const title = '瓦片草地 Grass Tiles';
export const category = 'terrain';

export const guiSchema = [
  { key: 'tileSize', label: '瓦片尺寸 Tile', min: 6, max: 30, step: 1, default: 12 },
  { key: 'maxDistance', label: '最大距离 Dist', min: 30, max: 200, step: 5, default: 80 },
  { key: 'densityScale', label: '密度倍率 Density', min: 0.3, max: 2, step: 0.05, default: 1 },
  { key: 'bladeHeight', label: '草高 Height', min: 0.3, max: 3, step: 0.05, default: 1.4 },
  { key: 'bladeWidth', label: '草宽 Width', min: 0.02, max: 0.25, step: 0.005, default: 0.12 },
  { key: 'windIntensity', label: '风力 Intensity', min: 0, max: 2, step: 0.05, default: 0.55 },
  { key: 'windDirection', label: '风向 Dir (rad)', min: 0, max: 6.28, step: 0.05, default: 0.8 },
  { key: 'windNoiseScale', label: '风噪 Scale', min: 0.02, max: 0.6, step: 0.01, default: 0.15 },
  { key: 'windSpeed', label: '风速 Speed', min: 0, max: 3, step: 0.05, default: 1.0 },
  { key: 'bladeStiffness', label: '硬度 Stiffness', min: 0.1, max: 1.5, step: 0.05, default: 0.7 },
  { key: 'tipColor', label: '尖端色 Tip', default: '#9ae85a' },
  { key: 'baseColor', label: '根部色 Base', default: '#1a3d12' },
  { key: 'terrainAmp', label: '地形起伏 Amp', min: 0, max: 8, step: 0.1, default: 2.5 },
  { key: 'showInfluence', label: '影响球 Influence', default: true },
  {
    key: 'quality',
    label: '质量 Quality',
    options: { Low: 'low', Mid: 'mid', High: 'high' },
    default: 'mid',
  },
];

/** LOD bands: normalized distance vs maxDistance */
const LOD_BANDS = [
  { name: 'high', min: 0, max: 0.35, density: 1.0, segments: 4 },
  { name: 'medium', min: 0.35, max: 0.55, density: 0.55, segments: 3 },
  { name: 'low', min: 0.55, max: 0.75, density: 0.3, segments: 2 },
  { name: 'veryLow', min: 0.75, max: 1.01, density: 0.15, segments: 1 },
];

const QUALITY = {
  low: { baseBlades: 280, tileBudget: 36 },
  mid: { baseBlades: 800, tileBudget: 64 },
  high: { baseBlades: 900, tileBudget: 81 },
};

const HEIGHT_RES = 256;
const TERRAIN_EXTENT = 220; // world half-extent covered by heightmap

// ── shared FBM (CPU; mirrored conceptually in heightmap sampling) ──────────
function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, z) {
  let v = 0;
  let a = 0.5;
  let px = x;
  let pz = z;
  for (let i = 0; i < 5; i++) {
    v += a * noise2(px, pz);
    px *= 2.03;
    pz *= 2.03;
    a *= 0.5;
  }
  return v;
}
function terrainHeight(x, z, amp) {
  const s = 0.035;
  return (fbm2(x * s, z * s) * 2 - 0.85) * amp;
}

function buildHeightTexture(amp) {
  // RGBAFormat is WebGL1-safe; RedFormat can fail / leave program unusable on some contexts.
  const data = new Uint8Array(HEIGHT_RES * HEIGHT_RES * 4);
  for (let j = 0; j < HEIGHT_RES; j++) {
    for (let i = 0; i < HEIGHT_RES; i++) {
      const u = i / (HEIGHT_RES - 1);
      const v = j / (HEIGHT_RES - 1);
      const x = (u - 0.5) * 2 * TERRAIN_EXTENT;
      const z = (v - 0.5) * 2 * TERRAIN_EXTENT;
      const h = terrainHeight(x, z, amp);
      const n = THREE.MathUtils.clamp((h / (amp * 1.2 + 1e-4)) * 0.5 + 0.5, 0, 1);
      const byte = (n * 255) | 0;
      const idx = (j * HEIGHT_RES + i) * 4;
      data[idx] = byte;
      data[idx + 1] = byte;
      data[idx + 2] = byte;
      data[idx + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, HEIGHT_RES, HEIGHT_RES, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  if ('NoColorSpace' in THREE) tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** Tapered two-sided blade strip along +Y. segments = vertical subdivisions. */
function createBladeGeometry(segments, width, height) {
  const seg = Math.max(1, segments | 0);
  const verts = [];
  const uvs = [];
  const indices = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const y = t * height;
    // taper toward tip
    const w = width * (1.0 - t * 0.92);
    verts.push(-w * 0.5, y, 0, w * 0.5, y, 0);
    uvs.push(0, t, 1, t);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const BladeShader = {
  uniforms: {
    uTime: { value: 0 },
    uTipColor: { value: new THREE.Color('#9ae85a') },
    uBaseColor: { value: new THREE.Color('#1a3d12') },
    uWindIntensity: { value: 0.55 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindNoiseScale: { value: 0.15 },
    uWindSpeed: { value: 1 },
    uBladeStiffness: { value: 0.7 },
    uBladeHeight: { value: 1.4 },
    uHeightMap: { value: null },
    uTerrainExtent: { value: TERRAIN_EXTENT },
    uTerrainAmp: { value: 2.5 },
    uCamXZ: { value: new THREE.Vector2(0, 0) },
    uMaxDistance: { value: 80 },
    uInfluenceCenter: { value: new THREE.Vector3(0, 0, 0) },
    uInfluenceRadius: { value: 3.5 },
    uInfluenceEnabled: { value: 1 },
  },
  vertexShader: /* glsl */ `
    attribute vec2 aOffset;
    attribute float aYaw;
    attribute float aHeightScale;
    attribute float aColorVary;

    uniform float uTime;
    uniform float uWindIntensity;
    uniform vec2 uWindDir;
    uniform float uWindNoiseScale;
    uniform float uWindSpeed;
    uniform float uBladeStiffness;
    uniform float uBladeHeight;
    uniform sampler2D uHeightMap;
    uniform float uTerrainExtent;
    uniform float uTerrainAmp;
    uniform vec2 uCamXZ;
    uniform float uMaxDistance;
    uniform vec3 uInfluenceCenter;
    uniform float uInfluenceRadius;
    uniform float uInfluenceEnabled;

    varying float vH;
    varying float vColorVary;
    varying float vFade;
    varying vec3 vWorldNormal;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    float sampleHeight(vec2 xz) {
      vec2 uv = xz / (uTerrainExtent * 2.0) + 0.5;
      float n = texture2D(uHeightMap, clamp(uv, 0.0, 1.0)).r;
      return (n * 2.0 - 1.0) * uTerrainAmp * 1.2;
    }

    void main() {
      vUv = uv;
      vH = vUv.y;
      vColorVary = aColorVary;

      float cy = cos(aYaw);
      float sy = sin(aYaw);
      vec3 local = position;
      local.y *= aHeightScale;
      // yaw around Y
      vec3 rotated = vec3(
        local.x * cy - local.z * sy,
        local.y,
        local.x * sy + local.z * cy
      );

      // tile origin from model matrix translation
      vec3 tileOrigin = vec3(modelMatrix[3][0], modelMatrix[3][1], modelMatrix[3][2]);
      vec2 baseXZ = tileOrigin.xz + aOffset;
      float groundY = sampleHeight(baseXZ);

      float tipFactor = vUv.y * vUv.y; // tip bends more
      float stiff = max(uBladeStiffness, 0.05);
      vec2 windDir = normalize(uWindDir + vec2(1e-5));
      float n = noise(baseXZ * uWindNoiseScale + vec2(uTime * uWindSpeed * 0.35));
      float gust = noise(baseXZ * uWindNoiseScale * 0.45 - vec2(uTime * uWindSpeed * 0.2));
      float bend = uWindIntensity * tipFactor * (0.55 + n * 0.9 + gust * 0.35) / stiff;
      rotated.x += windDir.x * bend * uBladeHeight;
      rotated.z += windDir.y * bend * uBladeHeight;
      // slight droop
      rotated.y -= bend * 0.15 * uBladeHeight * tipFactor;

      // soft influence flatten
      if (uInfluenceEnabled > 0.5) {
        vec2 dInf = baseXZ - uInfluenceCenter.xz;
        float dist = length(dInf);
        float flattenAmt = 1.0 - smoothstep(uInfluenceRadius * 0.25, uInfluenceRadius, dist);
        flattenAmt *= uInfluenceEnabled;
        rotated.y *= mix(1.0, 0.12, flattenAmt * (0.4 + tipFactor * 0.6));
        rotated.xz += normalize(dInf + vec2(1e-4)) * flattenAmt * tipFactor * 0.55;
      }

      vec3 worldPos = vec3(baseXZ.x, groundY, baseXZ.y) + rotated;

      float camDist = length(baseXZ - uCamXZ);
      vFade = 1.0 - smoothstep(uMaxDistance * 0.72, uMaxDistance, camDist);

      // approximate normal
      vec3 nrm = normalize(vec3(-sy * 0.15, 1.0, -cy * 0.15));
      vWorldNormal = nrm;

      gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTipColor;
    uniform vec3 uBaseColor;

    varying float vH;
    varying float vColorVary;
    varying float vFade;
    varying vec3 vWorldNormal;
    varying vec2 vUv;

    void main() {
      if (vFade < 0.02) discard;
      vec3 col = mix(uBaseColor, uTipColor, pow(vH, 0.75));
      col *= 0.8 + vColorVary * 0.4;
      // cheap hemispheric shade
      float ndl = clamp(dot(normalize(vWorldNormal), normalize(vec3(0.35, 1.0, 0.25))), 0.0, 1.0);
      col *= 0.5 + ndl * 0.6;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// ── module state ───────────────────────────────────────────────────────────
let sceneRef;
let cameraRef;
let rendererRef;
let root;
let controls;
let terrainMesh;
let heightTex;
let sharedMat;
let bladeGeos = {}; // segments -> geometry
let tiles = new Map(); // key -> { mesh, lod, ix, iz, count }
let influenceMesh;
let hiddenDefaults = [];
let savedFog = null;
let savedBg = null;
let lastQuality = '';
let lastTileSize = -1;
let lastMaxDist = -1;
let lastDensity = -1;
let lastTerrainAmp = -1;
let influenceAngle = 0;

function hideDefaults(scene) {
  hiddenDefaults = [];
  for (const n of ['__default_ground', '__default_grid']) {
    const o = scene.getObjectByName(n);
    if (o && o.visible) {
      o.visible = false;
      hiddenDefaults.push(o);
    }
  }
}

function restoreDefaults() {
  for (const o of hiddenDefaults) {
    if (o) o.visible = true;
  }
  hiddenDefaults = [];
}

function lodIndexForNorm(d) {
  for (let i = 0; i < LOD_BANDS.length; i++) {
    if (d >= LOD_BANDS[i].min && d < LOD_BANDS[i].max) return i;
  }
  return LOD_BANDS.length - 1;
}

function bladeCountFor(lodIdx, params) {
  const q = QUALITY[params.quality] || QUALITY.mid;
  const band = LOD_BANDS[lodIdx];
  return Math.max(8, Math.floor(q.baseBlades * band.density * params.densityScale));
}

function ensureBladeGeo(segments, params) {
  const key = `${segments}_${params.bladeWidth.toFixed(3)}_${params.bladeHeight.toFixed(3)}`;
  if (!bladeGeos[key]) {
    // dispose old geos with same segment count that are unused later via disposeAllGeos
    bladeGeos[key] = createBladeGeometry(segments, params.bladeWidth, params.bladeHeight);
  }
  return bladeGeos[key];
}

function disposeAllGeos() {
  for (const g of Object.values(bladeGeos)) g.dispose();
  bladeGeos = {};
}

function seededRand(ix, iz, i, salt) {
  return hash2(ix * 19.1 + i * 0.17 + salt, iz * 23.7 + i * 0.31 + salt * 1.3);
}

function fillInstances(mesh, ix, iz, count, tileSize) {
  const half = tileSize * 0.5;
  const offset = new Float32Array(count * 2);
  const yaw = new Float32Array(count);
  const hScale = new Float32Array(count);
  const colorVary = new Float32Array(count);
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const rx = (seededRand(ix, iz, i, 1) - 0.5) * tileSize;
    const rz = (seededRand(ix, iz, i, 2) - 0.5) * tileSize;
    // keep inside tile with slight margin
    offset[i * 2] = THREE.MathUtils.clamp(rx, -half + 0.05, half - 0.05);
    offset[i * 2 + 1] = THREE.MathUtils.clamp(rz, -half + 0.05, half - 0.05);
    yaw[i] = seededRand(ix, iz, i, 3) * Math.PI * 2;
    hScale[i] = 0.7 + seededRand(ix, iz, i, 4) * 0.55;
    colorVary[i] = seededRand(ix, iz, i, 5);
    // Identity instance matrices — placement is entirely via aOffset in the shader
    dummy.position.set(0, 0, 0);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  const geo = mesh.geometry;
  geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offset, 2));
  geo.setAttribute('aYaw', new THREE.InstancedBufferAttribute(yaw, 1));
  geo.setAttribute('aHeightScale', new THREE.InstancedBufferAttribute(hScale, 1));
  geo.setAttribute('aColorVary', new THREE.InstancedBufferAttribute(colorVary, 1));
  // Bounds are undeformed (shader displaces via aOffset); disable culling until stable
  const r = tileSize * 0.75 + 4.0;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.0, 0), r);
  geo.boundingBox = null;
  mesh.frustumCulled = false;
}

function createTileMesh(ix, iz, lodIdx, params) {
  const band = LOD_BANDS[lodIdx];
  const count = bladeCountFor(lodIdx, params);
  const baseGeo = ensureBladeGeo(band.segments, params);
  // Explicit InstancedBufferGeometry (.copy clones attrs) so instance attrs bind on r150–r160
  const geo = new THREE.InstancedBufferGeometry().copy(baseGeo);
  geo.instanceCount = count;
  const mesh = new THREE.InstancedMesh(geo, sharedMat, count);
  mesh.frustumCulled = false;
  mesh.position.set(ix * params.tileSize, 0, iz * params.tileSize);
  mesh.count = count;
  fillInstances(mesh, ix, iz, count, params.tileSize);
  mesh.userData.lod = lodIdx;
  mesh.userData.key = `${ix},${iz}`;
  root.add(mesh);
  return { mesh, lod: lodIdx, ix, iz, count };
}

function destroyTile(tile) {
  if (!tile) return;
  root.remove(tile.mesh);
  // .copy() gave this geo its own attribute clones — safe to dispose
  tile.mesh.geometry.dispose();
  // sharedMat kept
}

function rebuildTerrain(params) {
  if (terrainMesh) {
    root.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
    terrainMesh = null;
  }
  if (heightTex) {
    heightTex.dispose();
    heightTex = null;
  }
  heightTex = buildHeightTexture(params.terrainAmp);
  if (sharedMat) sharedMat.uniforms.uHeightMap.value = heightTex;

  const size = TERRAIN_EXTENT * 2;
  const seg = 128;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z, params.terrainAmp));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a6b28,
    roughness: 0.92,
    metalness: 0.05,
    flatShading: false,
  });
  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.receiveShadow = true;
  terrainMesh.name = 'grass-terrain';
  root.add(terrainMesh);
}

function clearTiles() {
  for (const t of tiles.values()) destroyTile(t);
  tiles.clear();
}

function syncTiles(params, cam) {
  const q = QUALITY[params.quality] || QUALITY.mid;
  const tileSize = params.tileSize;
  const maxDist = params.maxDistance;
  const cx = cam.position.x;
  const cz = cam.position.z;
  const cix = Math.floor(cx / tileSize + 1e-6);
  const ciz = Math.floor(cz / tileSize + 1e-6);
  const range = Math.ceil(maxDist / tileSize) + 1;

  const needed = new Set();
  const candidates = [];

  for (let dz = -range; dz <= range; dz++) {
    for (let dx = -range; dx <= range; dx++) {
      const ix = cix + dx;
      const iz = ciz + dz;
      const ox = (ix + 0.5) * tileSize;
      const oz = (iz + 0.5) * tileSize;
      const dist = Math.hypot(ox - cx, oz - cz);
      if (dist > maxDist + tileSize * 0.75) continue;
      const norm = dist / maxDist;
      const lod = lodIndexForNorm(norm);
      candidates.push({ ix, iz, dist, lod, key: `${ix},${iz}` });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  const budget = q.tileBudget;
  const keep = candidates.slice(0, budget);
  for (const c of keep) needed.add(c.key);

  // remove far / excess
  for (const [key, tile] of tiles) {
    if (!needed.has(key)) {
      destroyTile(tile);
      tiles.delete(key);
    }
  }

  // create / lod-swap
  for (const c of keep) {
    const existing = tiles.get(c.key);
    if (!existing) {
      tiles.set(c.key, createTileMesh(c.ix, c.iz, c.lod, params));
    } else if (existing.lod !== c.lod) {
      destroyTile(existing);
      tiles.set(c.key, createTileMesh(c.ix, c.iz, c.lod, params));
    } else {
      // keep position in sync if tileSize changed (handled by full rebuild)
      existing.mesh.position.set(c.ix * tileSize, 0, c.iz * tileSize);
    }
  }
}

function updateUniforms(params, cam, elapsed) {
  if (!sharedMat) return;
  const u = sharedMat.uniforms;
  u.uTime.value = elapsed;
  u.uTipColor.value.set(params.tipColor);
  u.uBaseColor.value.set(params.baseColor);
  u.uWindIntensity.value = params.windIntensity;
  u.uWindDir.value.set(Math.cos(params.windDirection), Math.sin(params.windDirection));
  u.uWindNoiseScale.value = params.windNoiseScale;
  u.uWindSpeed.value = params.windSpeed;
  u.uBladeStiffness.value = params.bladeStiffness;
  u.uBladeHeight.value = params.bladeHeight;
  u.uTerrainAmp.value = params.terrainAmp;
  u.uCamXZ.value.set(cam.position.x, cam.position.z);
  u.uMaxDistance.value = params.maxDistance;
  u.uInfluenceEnabled.value = params.showInfluence ? 1 : 0;
}


export function create(ctx, params) {
  dispose();

  sceneRef = ctx.scene;
  cameraRef = ctx.camera;
  rendererRef = ctx.renderer;

  savedBg = sceneRef.background ? sceneRef.background.clone() : new THREE.Color(0x030508);
  savedFog = sceneRef.fog
    ? { color: sceneRef.fog.color.clone(), density: sceneRef.fog.density }
    : { color: new THREE.Color(0x030508), density: 0.028 };

  // Outdoor daytime look
  sceneRef.background = new THREE.Color(0x7eb0d0);
  sceneRef.fog = new THREE.FogExp2(0x9ec4d8, 0.0065);

  hideDefaults(sceneRef);

  root = new THREE.Group();
  root.name = 'terrain-grass-tiles';
  sceneRef.add(root);

  // Extra sun for outdoor
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.1);
  sun.position.set(40, 60, 20);
  sun.name = 'grass-sun';
  root.add(sun);
  const hemi = new THREE.HemisphereLight(0xb8d8ff, 0x3a5a28, 0.55);
  hemi.name = 'grass-hemi';
  root.add(hemi);

  sharedMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.clone(BladeShader.uniforms),
    vertexShader: BladeShader.vertexShader,
    fragmentShader: BladeShader.fragmentShader,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  // ShaderMaterial links on first use; three defaults checkShaderErrors=true and logs GLSL errors
  if (rendererRef && rendererRef.debug) {
    rendererRef.debug.checkShaderErrors = true;
  }
  // clone() of Color/Vector uniforms needs fresh objects:
  sharedMat.uniforms.uTipColor.value = new THREE.Color(params.tipColor);
  sharedMat.uniforms.uBaseColor.value = new THREE.Color(params.baseColor);
  sharedMat.uniforms.uWindDir.value = new THREE.Vector2(1, 0);
  sharedMat.uniforms.uCamXZ.value = new THREE.Vector2();
  sharedMat.uniforms.uInfluenceCenter.value = new THREE.Vector3();

  rebuildTerrain(params);

  influenceMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.1, 24, 16),
    new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xaa6622,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
    })
  );
  influenceMesh.visible = !!params.showInfluence;
  influenceMesh.name = 'grass-influence';
  root.add(influenceMesh);

  // Camera framing
  cameraRef.position.set(0, 14, 32);
  cameraRef.near = 0.5;
  cameraRef.far = 500;
  cameraRef.updateProjectionMatrix();
  cameraRef.lookAt(0, 0, 0);

  if (rendererRef) {
    controls = new OrbitControls(cameraRef, rendererRef.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = 6;
    controls.maxDistance = 160;
    controls.target.set(0, 2, 0);
    controls.update();
  }

  lastQuality = params.quality;
  lastTileSize = params.tileSize;
  lastMaxDist = params.maxDistance;
  lastDensity = params.densityScale;
  lastTerrainAmp = params.terrainAmp;

  syncTiles(params, cameraRef);
  updateUniforms(params, cameraRef, 0);
}

export function update(dt, params, ctx) {
  if (!root || !cameraRef) return;
  const cam = ctx?.camera || cameraRef;
  const elapsed = ctx?.clock?.elapsedTime ?? 0;

  if (controls) controls.update();

  // topology rebuild
  const topo =
    params.quality !== lastQuality ||
    params.tileSize !== lastTileSize ||
    params.maxDistance !== lastMaxDist ||
    params.densityScale !== lastDensity;
  const terrainChanged = Math.abs(params.terrainAmp - lastTerrainAmp) > 0.05;

  if (terrainChanged) {
    rebuildTerrain(params);
    lastTerrainAmp = params.terrainAmp;
  }

  if (topo) {
    // wipe tiles (cloned geos) before disposing shared base geos
    clearTiles();
    disposeAllGeos();
    lastQuality = params.quality;
    lastTileSize = params.tileSize;
    lastMaxDist = params.maxDistance;
    lastDensity = params.densityScale;
  }

  // soft live rebuild when blade dimensions change meaningfully — recycle tiles
  // (geometries bake width/height; recreate tiles occasionally)
  syncTiles(params, cam);

  // influence orbits slowly in front of camera target area
  influenceAngle += dt * 0.35;
  const ix = Math.sin(influenceAngle) * 18;
  const iz = Math.cos(influenceAngle * 0.85) * 14;
  const iy = terrainHeight(ix, iz, params.terrainAmp) + 1.2;
  if (influenceMesh) {
    influenceMesh.visible = !!params.showInfluence;
    influenceMesh.position.set(ix, iy, iz);
    if (sharedMat) {
      sharedMat.uniforms.uInfluenceCenter.value.set(ix, iy, iz);
      sharedMat.uniforms.uInfluenceRadius.value = 4.0;
    }
  }

  updateUniforms(params, cam, elapsed);

  // If blade height/width changed, rebuild geos next frame cheaply by clearing tiles
  // Detect via material blade height uniform vs geometry — force geo refresh
  if (!sharedMat.userData._bh) sharedMat.userData._bh = params.bladeHeight;
  if (!sharedMat.userData._bw) sharedMat.userData._bw = params.bladeWidth;
  if (
    Math.abs(sharedMat.userData._bh - params.bladeHeight) > 0.001 ||
    Math.abs(sharedMat.userData._bw - params.bladeWidth) > 0.0001
  ) {
    sharedMat.userData._bh = params.bladeHeight;
    sharedMat.userData._bw = params.bladeWidth;
    clearTiles();
    disposeAllGeos();
    syncTiles(params, cam);
  }
}

export function dispose() {
  if (controls) {
    controls.dispose();
    controls = null;
  }
  clearTiles();
  disposeAllGeos();
  if (heightTex) {
    heightTex.dispose();
    heightTex = null;
  }
  if (sharedMat) {
    sharedMat.dispose();
    sharedMat = null;
  }
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = terrainMesh = influenceMesh = null;

  restoreDefaults();

  if (sceneRef) {
    if (savedBg) sceneRef.background = savedBg;
    else sceneRef.background = new THREE.Color(0x030508);
    if (savedFog) {
      sceneRef.fog = new THREE.FogExp2(savedFog.color, savedFog.density);
    } else {
      sceneRef.fog = new THREE.FogExp2(0x030508, 0.028);
    }
  }

  sceneRef = cameraRef = rendererRef = null;
  savedFog = savedBg = null;
  lastQuality = '';
  lastTileSize = lastMaxDist = lastDensity = lastTerrainAmp = -1;
  tiles.clear();
}
