/**
 * fluid-liquid-mix.js — Red/blue liquid mix in open industrial tank (QA fix)
 *
 * QA fixes vs failed build:
 *  1) Opaque falling jet cylinders (not additive glow discs)
 *  2) Open-top basin — fluid plane visible from above with purple mix band
 *  3) Sight glass aligned with liquid volume (gradient strip behind glass)
 *  4) Cheap 3-octave FBM + sin vortices (mixRate clearly shifts blend width)
 *  5) Color contained inside tank; camera sees open top + jets
 *  6) NormalBlending only — colors stay in gamut
 *
 * Params: mixRate, redFlow, blueFlow, viscosity, turbulence,
 *         colorRed, colorBlue, opacity, foam (+ subsurface, caustics kept)
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'fluid-liquid-mix';
export const title = '红蓝水混合 Liquid Mix';
export const category = 'fluid-gas';

export const guiSchema = [
  { key: 'mixRate', label: '混合速度 MixRate', min: 0, max: 2, step: 0.02, default: 0.85 },
  { key: 'redFlow', label: '红流量 RedFlow', min: 0, max: 2, step: 0.05, default: 1.0 },
  { key: 'blueFlow', label: '蓝流量 BlueFlow', min: 0, max: 2, step: 0.05, default: 1.0 },
  { key: 'viscosity', label: '粘滞感 Viscosity', min: 0, max: 1, step: 0.02, default: 0.32 },
  { key: 'turbulence', label: '湍流 Turbulence', min: 0, max: 2, step: 0.05, default: 1.0 },
  { key: 'colorRed', label: '红色 ColorRed', default: '#c41e2a' },
  { key: 'colorBlue', label: '蓝色 ColorBlue', default: '#1a4fd4' },
  { key: 'opacity', label: '不透明度 Opacity', min: 0.4, max: 1, step: 0.01, default: 0.92 },
  { key: 'foam', label: '泡沫 Foam', min: 0, max: 1, step: 0.02, default: 0.5 },
  { key: 'subsurface', label: '次表面 Subsurface', min: 0, max: 1, step: 0.02, default: 0.4 },
  { key: 'caustics', label: '焦散 Caustics', min: 0, max: 1, step: 0.02, default: 0.25 },
];

/* Cheap shared noise — 3 octaves max */
const NOISE = /* glsl */`
float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm3(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p *= 2.05;
    a *= 0.5;
  }
  return v;
}
`;

const SurfaceShader = {
  uniforms: {
    uTime: { value: 0 },
    uMixRate: { value: 0.85 },
    uRedFlow: { value: 1 },
    uBlueFlow: { value: 1 },
    uViscosity: { value: 0.32 },
    uTurbulence: { value: 1 },
    uColorRed: { value: new THREE.Color(0xc41e2a) },
    uColorBlue: { value: new THREE.Color(0x1a4fd4) },
    uOpacity: { value: 0.92 },
    uFoam: { value: 0.5 },
    uSubsurface: { value: 0.4 },
    uCaustics: { value: 0.25 },
  },
  vertexShader: /* glsl */`
    ${NOISE}
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vViewW;
    uniform float uTime;
    uniform float uTurbulence;
    uniform float uViscosity;
    uniform float uRedFlow;
    uniform float uBlueFlow;

    void main() {
      vUv = uv;
      float speed = mix(1.2, 0.25, clamp(uViscosity, 0.0, 1.0));
      float amp = 0.03 * mix(0.4, 1.2, clamp(uTurbulence * 0.5, 0.0, 1.0));
      amp *= mix(0.6, 1.0, clamp((uRedFlow + uBlueFlow) * 0.35, 0.0, 1.0));
      float h = (fbm3(uv * 5.0 + uTime * speed * 0.3) - 0.5) * amp;
      vec3 pos = position;
      pos.z += h;
      float e = 0.02;
      float hx = fbm3((uv + vec2(e, 0.0)) * 5.0 + uTime * speed * 0.3)
               - fbm3((uv - vec2(e, 0.0)) * 5.0 + uTime * speed * 0.3);
      float hy = fbm3((uv + vec2(0.0, e)) * 5.0 + uTime * speed * 0.3)
               - fbm3((uv - vec2(0.0, e)) * 5.0 + uTime * speed * 0.3);
      vec3 nLoc = normalize(vec3(-hx * amp * 40.0, -hy * amp * 40.0, 1.0));
      vec4 wp = modelMatrix * vec4(pos, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * nLoc);
      vViewW = cameraPosition - wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    ${NOISE}
    uniform float uTime;
    uniform float uMixRate;
    uniform float uRedFlow;
    uniform float uBlueFlow;
    uniform float uViscosity;
    uniform float uTurbulence;
    uniform vec3 uColorRed;
    uniform vec3 uColorBlue;
    uniform float uOpacity;
    uniform float uFoam;
    uniform float uSubsurface;
    uniform float uCaustics;
    varying vec2 vUv;
    varying vec3 vNormalW;
    varying vec3 vViewW;

    void main() {
      float visc = clamp(uViscosity, 0.0, 1.0);
      float turb = clamp(uTurbulence, 0.0, 2.0);
      float mixR = clamp(uMixRate, 0.0, 2.0);
      float speed = mix(1.2, 0.22, visc);
      float t = uTime * speed;

      // Flow imbalance shifts mix center (redFlow high → purple moves right)
      float totalF = max(uRedFlow + uBlueFlow, 0.05);
      float center = mix(0.5, uRedFlow / totalF, 0.6);

      // Cheap sin vortices + one fbm3 warp (not multi-step curl)
      vec2 uv = vUv;
      float vx = sin(uv.y * 6.2832 * 2.0 + t * 1.4) * cos(uv.x * 6.2832 + t * 0.7);
      float vy = cos(uv.x * 6.2832 * 2.0 - t * 1.1) * sin(uv.y * 6.2832 + t * 0.5);
      uv += vec2(vx, vy) * turb * mix(0.06, 0.02, visc);
      float n = fbm3(uv * 4.0 + vec2(t * 0.2, 0.0));
      uv.x += (n - 0.5) * turb * mix(0.12, 0.04, visc);

      // mixRate widens purple band — very visible
      float band = mix(0.05, 0.42, clamp(mixR * 0.5, 0.0, 1.0));
      band *= mix(0.9, 1.3, visc);
      float dye = smoothstep(center - band, center + band, uv.x);
      dye = clamp(dye, 0.0, 1.0);

      // Filament hint via cheap sin ridges (not ridge6)
      float fil = sin(uv.x * 40.0 + n * 8.0 + t) * 0.5 + 0.5;
      fil = mix(0.5, fil, clamp(turb * 0.4, 0.0, 1.0));
      float dyeF = clamp(dye + (fil - 0.5) * 0.15 * (1.0 - abs(dye - 0.5) * 2.0), 0.0, 1.0);

      vec3 purple = mix(uColorRed, uColorBlue, 0.5);
      purple = mix(purple, vec3(0.55, 0.12, 0.65), 0.35);

      vec3 col;
      if (dyeF < 0.5) {
        col = mix(uColorRed, purple, pow(clamp(dyeF * 2.0, 0.0, 1.0), 0.9));
      } else {
        col = mix(purple, uColorBlue, pow(clamp((dyeF - 0.5) * 2.0, 0.0, 1.0), 0.9));
      }

      // Soft subsurface (clamped)
      vec3 N = normalize(vNormalW);
      vec3 V = normalize(vViewW);
      float ndv = clamp(dot(N, V), 0.0, 1.0);
      col = mix(col, col * 1.15 + purple * 0.15, clamp(uSubsurface, 0.0, 1.0) * (1.0 - ndv));

      // Mild caustics
      float cau = fbm3(uv * 7.0 + vec2(t * 0.4, -t * 0.3));
      col += vec3(0.7, 0.85, 1.0) * pow(clamp(cau, 0.0, 1.0), 3.0) * clamp(uCaustics, 0.0, 1.0) * 0.25;

      // Foam on mix front
      float front = 1.0 - smoothstep(0.0, 0.25 + mixR * 0.1, abs(dyeF - 0.5) * 2.0);
      float foamN = fbm3(uv * 10.0 + t);
      float foamM = clamp(front * foamN * clamp(uFoam, 0.0, 1.0), 0.0, 1.0);
      col = mix(col, vec3(0.9, 0.92, 0.95), foamM * 0.75);

      // Fresnel (Schlick-ish)
      float fres = 0.04 + 0.96 * pow(1.0 - ndv, 4.0);
      col += vec3(0.5, 0.65, 0.85) * fres * 0.4;
      // Specular
      vec3 L = normalize(vec3(0.4, 0.9, 0.3));
      float spec = pow(clamp(dot(reflect(-L, N), V), 0.0, 1.0), 48.0);
      col += vec3(1.0) * spec * 0.35;

      // Keep in gamut
      col = clamp(col, 0.0, 1.15);

      float alpha = clamp(uOpacity, 0.4, 1.0) * mix(0.88, 1.0, fres);
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

/** Falling jet — opaque/translucent cylinder, NormalBlending, scrolling streaks */
const JetShader = {
  uniforms: {
    uTime: { value: 0 },
    uColor: { value: new THREE.Color(1, 0, 0) },
    uFlow: { value: 1 },
    uViscosity: { value: 0.3 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    ${NOISE}
    uniform float uTime;
    uniform vec3 uColor;
    uniform float uFlow;
    uniform float uViscosity;
    varying vec2 vUv;
    void main() {
      float flow = clamp(uFlow, 0.0, 2.0);
      if (flow < 0.05) discard;
      float speed = mix(3.0, 0.8, clamp(uViscosity, 0.0, 1.0)) * max(flow, 0.2);
      // Cylinder UV: x around, y along height (0=bottom near fluid, 1=top near nozzle)
      float streak = fbm3(vec2(vUv.x * 2.5, vUv.y * 6.0 - uTime * speed));
      float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
      radial = pow(clamp(radial, 0.0, 1.0), 0.85);
      // Solid liquid column — high opacity so both jets read clearly
      float body = mix(0.75, 1.0, radial) * (0.85 + streak * 0.15);
      body *= smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.02, 0.9, vUv.y);
      float alpha = clamp(body * mix(0.82, 0.96, clamp(flow * 0.7, 0.0, 1.0)), 0.0, 0.97);
      if (alpha < 0.02) discard;
      vec3 col = uColor * (0.88 + streak * 0.2);
      col = clamp(col, 0.0, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

/** Vertical dye volume for sight glass — cheap gradient strip */
const VolumeShader = {
  uniforms: {
    uMixRate: { value: 0.85 },
    uRedFlow: { value: 1 },
    uBlueFlow: { value: 1 },
    uColorRed: { value: new THREE.Color(0xc41e2a) },
    uColorBlue: { value: new THREE.Color(0x1a4fd4) },
    uOpacity: { value: 0.85 },
    uTime: { value: 0 },
    uTurbulence: { value: 1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    ${NOISE}
    uniform float uMixRate;
    uniform float uRedFlow;
    uniform float uBlueFlow;
    uniform vec3 uColorRed;
    uniform vec3 uColorBlue;
    uniform float uOpacity;
    uniform float uTime;
    uniform float uTurbulence;
    varying vec2 vUv;
    void main() {
      float totalF = max(uRedFlow + uBlueFlow, 0.05);
      float center = mix(0.5, uRedFlow / totalF, 0.6);
      float band = mix(0.06, 0.4, clamp(uMixRate * 0.5, 0.0, 1.0));
      float n = fbm3(vec2(vUv.x * 3.0, vUv.y * 2.0 + uTime * 0.15)) - 0.5;
      float dye = smoothstep(center - band, center + band, vUv.x + n * 0.08 * uTurbulence);
      vec3 purple = mix(mix(uColorRed, uColorBlue, 0.5), vec3(0.55, 0.12, 0.65), 0.35);
      vec3 col = dye < 0.5
        ? mix(uColorRed, purple, dye * 2.0)
        : mix(purple, uColorBlue, (dye - 0.5) * 2.0);
      // Darker toward bottom
      col *= mix(0.7, 1.05, vUv.y);
      col = clamp(col, 0.0, 1.1);
      gl_FragColor = vec4(col, clamp(uOpacity, 0.75, 1.0));
    }
  `,
};

let root, surface, volume, sightGlass, sightDye;
let redJet, blueJet, foamPts;
let foamPos, foamLife;
let sceneRef;
let redSplash, blueSplash, rSp, rSv, rSl, rSm, bSp, bSv, bSl, bSm;

const TANK_W = 4.2;
const TANK_D = 2.6;
const WALL_H = 1.55;
const FLOOR_Y = 0.08;
const FLUID_Y = 0.88; // open surface below rim
const NOZZLE_X = 1.45; // inset from side walls (±2.1) so jets never clip
const SPOUT_Y = 1.58;  // nozzle tip Y — clear air gap above fluid
const JET_LEN = SPOUT_Y - FLUID_Y; // ~0.70 visible falling column

function steel(hex, rough = 0.32, metal = 0.88) {
  return new THREE.MeshStandardMaterial({
    color: hex,
    metalness: metal,
    roughness: rough,
    envMapIntensity: 1.0,
  });
}

function buildTank() {
  const g = new THREE.Group();
  const s = steel(0x5c6672);
  const dark = steel(0x2a3038, 0.45, 0.7);

  // Floor only — NO lid
  const floor = new THREE.Mesh(new THREE.BoxGeometry(TANK_W, 0.1, TANK_D), dark);
  floor.position.y = FLOOR_Y;
  floor.receiveShadow = true;
  g.add(floor);

  // Four walls — open top
  const walls = [
    { size: [TANK_W, WALL_H, 0.08], pos: [0, WALL_H / 2, -TANK_D / 2] },
    { size: [TANK_W, WALL_H, 0.08], pos: [0, WALL_H / 2, TANK_D / 2] },
    { size: [0.08, WALL_H, TANK_D], pos: [-TANK_W / 2, WALL_H / 2, 0] },
    { size: [0.08, WALL_H, TANK_D], pos: [TANK_W / 2, WALL_H / 2, 0] },
  ];
  walls.forEach((w, i) => {
    // Front wall (z+) gets a cutout for sight — use thinner full wall + glass later
    if (i === 1) {
      // left and right of sight opening
      const left = new THREE.Mesh(new THREE.BoxGeometry(TANK_W * 0.28, WALL_H, 0.08), s);
      left.position.set(-TANK_W * 0.36, WALL_H / 2, TANK_D / 2);
      left.castShadow = true;
      g.add(left);
      const right = new THREE.Mesh(new THREE.BoxGeometry(TANK_W * 0.28, WALL_H, 0.08), s);
      right.position.set(TANK_W * 0.36, WALL_H / 2, TANK_D / 2);
      right.castShadow = true;
      g.add(right);
      const topBar = new THREE.Mesh(new THREE.BoxGeometry(TANK_W * 0.44, WALL_H * 0.22, 0.08), s);
      topBar.position.set(0, WALL_H * 0.89, TANK_D / 2);
      g.add(topBar);
      const botBar = new THREE.Mesh(new THREE.BoxGeometry(TANK_W * 0.44, WALL_H * 0.18, 0.08), s);
      botBar.position.set(0, WALL_H * 0.09, TANK_D / 2);
      g.add(botBar);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...w.size), s);
      m.position.set(...w.pos);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
  });

  // Rim (thin lip, still open)
  const rimMat = steel(0x6a7380, 0.28, 0.9);
  const rimPieces = [
    { s: [TANK_W + 0.12, 0.06, 0.1], p: [0, WALL_H, -TANK_D / 2] },
    { s: [TANK_W + 0.12, 0.06, 0.1], p: [0, WALL_H, TANK_D / 2] },
    { s: [0.1, 0.06, TANK_D], p: [-TANK_W / 2, WALL_H, 0] },
    { s: [0.1, 0.06, TANK_D], p: [TANK_W / 2, WALL_H, 0] },
  ];
  for (const r of rimPieces) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...r.s), rimMat);
    m.position.set(...r.p);
    g.add(m);
  }

  // Legs
  for (const xz of [[-1.6, 0.95], [1.6, 0.95], [-1.6, -0.95], [1.6, -0.95]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.7, 8), dark);
    leg.position.set(xz[0], -0.28, xz[1]);
    g.add(leg);
  }

  return g;
}

function buildInlet(side, paintHex) {
  const g = new THREE.Group();
  const s = steel(0x7a8490, 0.28, 0.9);
  const paint = new THREE.MeshStandardMaterial({
    color: paintHex,
    metalness: 0.3,
    roughness: 0.45,
  });
  const x = side * NOZZLE_X;

  // Horizontal supply from outside toward nozzle
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 16), s);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(side * (NOZZLE_X + 0.7), SPOUT_Y + 0.22, 0);
  g.add(pipe);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 14), paint);
  band.rotation.z = Math.PI / 2;
  band.position.set(side * (NOZZLE_X + 0.45), SPOUT_Y + 0.22, 0);
  g.add(band);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), s);
  elbow.position.set(x, SPOUT_Y + 0.22, 0);
  g.add(elbow);

  const down = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.095, 0.22, 14), s);
  down.position.set(x, SPOUT_Y + 0.08, 0);
  g.add(down);

  // Nozzle tip — jet starts exactly at spout
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.085, 0.1, 12), s);
  nozzle.position.set(x, SPOUT_Y, 0);
  g.add(nozzle);

  g.userData.spout = new THREE.Vector3(x, SPOUT_Y - 0.02, 0);
  return g;
}

function buildJet(side, colorHex) {
  // Closed cylinder spanning nozzle tip → fluid surface (same for L/R)
  const len = Math.max(JET_LEN, 0.55);
  const geo = new THREE.CylinderGeometry(0.07, 0.085, len, 16, 1, false);
  const uniforms = THREE.UniformsUtils.clone(JetShader.uniforms);
  uniforms.uColor.value = new THREE.Color(colorHex);
  uniforms.uFlow.value = 1.0;
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: JetShader.vertexShader,
    fragmentShader: JetShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const x = side * NOZZLE_X;
  const y0 = FLUID_Y + 0.01;
  const y1 = SPOUT_Y - 0.02;
  mesh.position.set(x, (y0 + y1) * 0.5, 0);
  mesh.scale.set(1, Math.max((y1 - y0) / len, 0.01), 1);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  mesh.name = side < 0 ? 'redJet' : 'blueJet';
  return mesh;
}

function buildSplash(n) {
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n * 3);
  const life = new Float32Array(n);
  const maxL = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3 + 1] = -50;
    life[i] = 1;
    maxL[i] = 1;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    })
  );
  pts.frustumCulled = false;
  return { pts, pos, vel, life, maxL };
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'liquidMix';

  root.add(buildTank());
  const redIn = buildInlet(-1, 0xb01a24);
  const blueIn = buildInlet(1, 0x1a48c0);
  redIn.name = 'redInlet';
  blueIn.name = 'blueInlet';
  root.add(redIn, blueIn);

  // Liquid VOLUME — inset so jets at ±NOZZLE_X sit in clear air above / beside
  const volH = FLUID_Y - 0.16;
  const volUni = THREE.UniformsUtils.clone(VolumeShader.uniforms);
  volUni.uColorRed.value = new THREE.Color(params.colorRed);
  volUni.uColorBlue.value = new THREE.Color(params.colorBlue);
  volume = new THREE.Mesh(
    new THREE.BoxGeometry(TANK_W - 0.35, volH, TANK_D - 0.35),
    new THREE.ShaderMaterial({
      uniforms: volUni,
      vertexShader: VolumeShader.vertexShader,
      fragmentShader: VolumeShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
    })
  );
  volume.position.y = 0.16 + volH * 0.5;
  volume.renderOrder = 1;
  root.add(volume);

  // Open fluid SURFACE (seen from above)
  const surfUni = THREE.UniformsUtils.clone(SurfaceShader.uniforms);
  surfUni.uColorRed.value = new THREE.Color(params.colorRed);
  surfUni.uColorBlue.value = new THREE.Color(params.colorBlue);
  surface = new THREE.Mesh(
    new THREE.PlaneGeometry(TANK_W - 0.28, TANK_D - 0.28, 64, 40),
    new THREE.ShaderMaterial({
      uniforms: surfUni,
      vertexShader: SurfaceShader.vertexShader,
      fragmentShader: SurfaceShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = FLUID_Y;
  surface.renderOrder = 2;
  root.add(surface);

  // Sight cutout: dye panel BEHIND glass (must read red→purple→blue through window)
  const glassW = TANK_W * 0.42;
  const glassH = Math.max(FLUID_Y - 0.18, 0.55);
  const glassY = 0.18 + glassH * 0.5;
  const glassZ = TANK_D / 2;

  const dyeUni = THREE.UniformsUtils.clone(VolumeShader.uniforms);
  dyeUni.uColorRed.value = new THREE.Color(params.colorRed);
  dyeUni.uColorBlue.value = new THREE.Color(params.colorBlue);
  dyeUni.uOpacity.value = 1.0;
  sightDye = new THREE.Mesh(
    new THREE.PlaneGeometry(glassW * 0.96, glassH * 0.96),
    new THREE.ShaderMaterial({
      uniforms: dyeUni,
      vertexShader: VolumeShader.vertexShader,
      fragmentShader: VolumeShader.fragmentShader,
      transparent: false,
      depthWrite: true,
      side: THREE.DoubleSide,
    })
  );
  sightDye.position.set(0, glassY, glassZ - 0.06);
  sightDye.name = 'sightDye';
  sightDye.renderOrder = 0;
  root.add(sightDye);

  // Clear glass pane (not opaque gray) — low-opacity physical glass
  sightGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(glassW, glassH),
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.05,
      transmission: 0.95,
      thickness: 0.04,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  sightGlass.position.set(0, glassY, glassZ + 0.035);
  sightGlass.renderOrder = 4;
  root.add(sightGlass);

  // Frame around glass
  const frame = steel(0x3a4450, 0.4, 0.8);
  const fw = glassW + 0.08;
  [
    [fw, 0.045, 0, glassY + glassH / 2 + 0.02],
    [fw, 0.045, 0, glassY - glassH / 2 - 0.02],
    [0.045, glassH + 0.09, -glassW / 2 - 0.02, glassY],
    [0.045, glassH + 0.09, glassW / 2 + 0.02, glassY],
  ].forEach((c) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(c[0], c[1], 0.06), frame);
    m.position.set(c[2], c[3], glassZ + 0.03);
    root.add(m);
  });

  // Jets AFTER volume so they draw on top; mirrored ±NOZZLE_X
  redJet = buildJet(-1, params.colorRed);
  blueJet = buildJet(1, params.colorBlue);
  root.add(redJet, blueJet);

  // Soft splash droplets (NormalBlending, small count)
  const rs = buildSplash(60);
  redSplash = rs.pts; rSp = rs.pos; rSv = rs.vel; rSl = rs.life; rSm = rs.maxL;
  root.add(redSplash);
  const bs = buildSplash(60);
  blueSplash = bs.pts; bSp = bs.pos; bSv = bs.vel; bSl = bs.life; bSm = bs.maxL;
  root.add(blueSplash);

  // Foam on surface (few points)
  const fn = 80;
  foamPos = new Float32Array(fn * 3);
  foamLife = new Float32Array(fn);
  for (let i = 0; i < fn; i++) {
    foamPos[i * 3] = (Math.random() - 0.5) * TANK_W * 0.6;
    foamPos[i * 3 + 1] = FLUID_Y + 0.02;
    foamPos[i * 3 + 2] = (Math.random() - 0.5) * TANK_D * 0.6;
    foamLife[i] = Math.random();
  }
  const fgeo = new THREE.BufferGeometry();
  fgeo.setAttribute('position', new THREE.BufferAttribute(foamPos, 3));
  foamPts = new THREE.Points(
    fgeo,
    new THREE.PointsMaterial({
      color: 0xe8eef4,
      size: 0.05,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.NormalBlending,
      sizeAttenuation: true,
    })
  );
  root.add(foamPts);

  ctx.scene.add(root);

  // Camera: centered front-high — open top + both falling jets
  ctx.camera.position.set(0.15, 3.15, 5.6);
  ctx.camera.lookAt(0, 0.85, 0);
  if (ctx.renderer) ctx.renderer.toneMappingExposure = 1.05;
}

function syncUniforms(params, t) {
  const dyeSets = [surface, volume, sightDye];
  for (const mesh of dyeSets) {
    const u = mesh?.material?.uniforms;
    if (!u) continue;
    if (u.uTime) u.uTime.value = t;
    if (u.uMixRate) u.uMixRate.value = params.mixRate;
    if (u.uRedFlow) u.uRedFlow.value = params.redFlow;
    if (u.uBlueFlow) u.uBlueFlow.value = params.blueFlow;
    if (u.uViscosity) u.uViscosity.value = params.viscosity;
    if (u.uTurbulence) u.uTurbulence.value = params.turbulence;
    if (u.uColorRed) u.uColorRed.value.set(params.colorRed);
    if (u.uColorBlue) u.uColorBlue.value.set(params.colorBlue);
    if (u.uOpacity) u.uOpacity.value = params.opacity;
    if (u.uFoam) u.uFoam.value = params.foam;
    if (u.uSubsurface) u.uSubsurface.value = params.subsurface ?? 0.4;
    if (u.uCaustics) u.uCaustics.value = params.caustics ?? 0.25;
  }
  // Jets — set each side explicitly (avoid shared-uniform mixups)
  if (redJet?.material?.uniforms) {
    const u = redJet.material.uniforms;
    u.uTime.value = t;
    u.uFlow.value = params.redFlow;
    u.uViscosity.value = params.viscosity;
    u.uColor.value.set(params.colorRed);
  }
  if (blueJet?.material?.uniforms) {
    const u = blueJet.material.uniforms;
    u.uTime.value = t;
    u.uFlow.value = params.blueFlow;
    u.uViscosity.value = params.viscosity;
    u.uColor.value.set(params.colorBlue);
  }
}

function updateSplash(dt, pos, vel, life, maxL, colors, spout, flow, toward, colorHex, viscosity) {
  const col = new THREE.Color(colorHex);
  const n = life.length;
  const damp = 1 - Math.min(0.9, viscosity * 1.5) * dt;
  for (let i = 0; i < n; i++) {
    if (life[i] >= maxL[i] || pos[i * 3 + 1] <= FLUID_Y) {
      if (flow > 0.08 && Math.random() < flow * 0.35) {
        pos[i * 3] = spout.x + (Math.random() - 0.5) * 0.08;
        pos[i * 3 + 1] = spout.y;
        pos[i * 3 + 2] = spout.z + (Math.random() - 0.5) * 0.08;
        vel[i * 3] = toward * (0.3 + Math.random() * 0.4) * flow;
        vel[i * 3 + 1] = -1.5 - Math.random() * flow;
        vel[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
        maxL[i] = 0.25 + Math.random() * 0.3;
        life[i] = 0;
      } else {
        pos[i * 3 + 1] = -50;
        life[i] = maxL[i];
      }
    } else {
      life[i] += dt;
      vel[i * 3 + 1] -= 9.0 * dt;
      vel[i * 3] *= damp;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // Stay roughly in tank XZ
      pos[i * 3] = THREE.MathUtils.clamp(pos[i * 3], -TANK_W * 0.45, TANK_W * 0.45);
      pos[i * 3 + 2] = THREE.MathUtils.clamp(pos[i * 3 + 2], -TANK_D * 0.45, TANK_D * 0.45);
    }
    const fade = 1 - Math.min(1, life[i] / Math.max(maxL[i], 1e-3));
    colors[i * 3] = col.r * fade;
    colors[i * 3 + 1] = col.g * fade;
    colors[i * 3 + 2] = col.b * fade;
  }
}

export function update(dt, params, ctx) {
  if (!surface) return;
  const t = ctx.clock.elapsedTime;
  syncUniforms(params, t);

  redJet.visible = params.redFlow > 0.05;
  blueJet.visible = params.blueFlow > 0.05;
  // Radius only (XZ) — preserve Y length from spout→fluid
  const yLen = Math.max((SPOUT_Y - 0.02 - FLUID_Y - 0.01) / Math.max(JET_LEN, 0.55), 0.01);
  const rs = 0.85 + Math.min(Math.max(params.redFlow, 0), 1.5) * 0.35;
  const bs = 0.85 + Math.min(Math.max(params.blueFlow, 0), 1.5) * 0.35;
  redJet.scale.set(rs, yLen, rs);
  blueJet.scale.set(bs, yLen, bs);
  // Keep jets locked under nozzles every frame
  redJet.position.set(-NOZZLE_X, (FLUID_Y + 0.01 + SPOUT_Y - 0.02) * 0.5, 0);
  blueJet.position.set(NOZZLE_X, (FLUID_Y + 0.01 + SPOUT_Y - 0.02) * 0.5, 0);

  const redSpout = root.getObjectByName('redInlet').userData.spout;
  const blueSpout = root.getObjectByName('blueInlet').userData.spout;

  updateSplash(dt, rSp, rSv, rSl, rSm, redSplash.geometry.attributes.color.array,
    redSpout, params.redFlow, 1, params.colorRed, params.viscosity);
  updateSplash(dt, bSp, bSv, bSl, bSm, blueSplash.geometry.attributes.color.array,
    blueSpout, params.blueFlow, -1, params.colorBlue, params.viscosity);
  redSplash.geometry.attributes.position.needsUpdate = true;
  redSplash.geometry.attributes.color.needsUpdate = true;
  blueSplash.geometry.attributes.position.needsUpdate = true;
  blueSplash.geometry.attributes.color.needsUpdate = true;

  if (foamPts) {
    foamPts.material.opacity = 0.15 + params.foam * 0.45;
    foamPts.visible = params.foam > 0.05;
    const totalF = Math.max(params.redFlow + params.blueFlow, 0.05);
    const cx = (params.redFlow / totalF - 0.5) * TANK_W * 0.55;
    const n = foamLife.length;
    for (let i = 0; i < n; i++) {
      foamLife[i] += dt * 0.4;
      foamPos[i * 3] += (cx - foamPos[i * 3]) * params.mixRate * 0.2 * dt;
      foamPos[i * 3] += Math.sin(t * 2 + i) * params.turbulence * 0.05 * dt;
      foamPos[i * 3 + 2] += Math.cos(t * 1.7 + i) * params.turbulence * 0.05 * dt;
      foamPos[i * 3 + 1] = FLUID_Y + 0.02;
      foamPos[i * 3] = THREE.MathUtils.clamp(foamPos[i * 3], -TANK_W * 0.4, TANK_W * 0.4);
      foamPos[i * 3 + 2] = THREE.MathUtils.clamp(foamPos[i * 3 + 2], -TANK_D * 0.38, TANK_D * 0.38);
      if (foamLife[i] > 1) {
        foamLife[i] = 0;
        foamPos[i * 3] = cx + (Math.random() - 0.5) * 0.5;
        foamPos[i * 3 + 2] = (Math.random() - 0.5) * TANK_D * 0.5;
      }
    }
    foamPts.geometry.attributes.position.needsUpdate = true;
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = surface = volume = sightGlass = sightDye = null;
  redJet = blueJet = foamPts = redSplash = blueSplash = null;
  foamPos = foamLife = rSp = rSv = rSl = rSm = bSp = bSv = bSl = bSm = null;
  sceneRef = null;
}
