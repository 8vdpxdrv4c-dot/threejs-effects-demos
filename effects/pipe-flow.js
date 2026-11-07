/**
 * pipe-flow.js — Industrial PBR pipe with animated flow shader
 *
 * Technique:
 *  - Outer tube: MeshStandardMaterial (metal roughness/metalness) for industrial shell
 *  - Inner flow: ShaderMaterial on TubeGeometry — fresnel rim + scrolling FBM noise
 *    tinted by medium (liquid/gas/energy); valveOpen slows UV scroll
 *  - Leak: additive spray Points when leak=true
 *
 * Params: flowSpeed, density, medium, valveOpen, leak
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'pipe-flow';
export const title = '管道流 Pipe Flow';
export const category = 'pipe-flow';

export const guiSchema = [
  { key: 'flowSpeed', label: '流速 FlowSpeed', min: 0, max: 5, step: 0.05, default: 1.5 },
  { key: 'density', label: '密度 Density', min: 0.1, max: 3, step: 0.05, default: 1.0 },
  { key: 'medium', label: '介质 Medium', options: { 液体: 'liquid', 气体: 'gas', 能量: 'energy', 水: 'water', 油: 'oil', 蒸汽: 'steam' }, default: 'liquid' },
  { key: 'valveOpen', label: '阀门开度 Valve', min: 0, max: 1, step: 0.01, default: 1.0 },
  { key: 'leak', label: '泄漏 Leak', default: false },
];

const MEDIUM = {
  liquid: { color: new THREE.Color(0x2a9fff), emissive: new THREE.Color(0x0a3060), opacity: 0.75, energy: 0.3 },
  water: { color: new THREE.Color(0x3399ff), emissive: new THREE.Color(0x0a2850), opacity: 0.8, energy: 0.25 },
  oil: { color: new THREE.Color(0x8a6a22), emissive: new THREE.Color(0x2a1a05), opacity: 0.9, energy: 0.15 },
  gas: { color: new THREE.Color(0xa8e0ff), emissive: new THREE.Color(0x204060), opacity: 0.4, energy: 0.55 },
  steam: { color: new THREE.Color(0xe8eef4), emissive: new THREE.Color(0x404850), opacity: 0.35, energy: 0.4 },
  energy: { color: new THREE.Color(0x44ffcc), emissive: new THREE.Color(0x00ff88), opacity: 0.85, energy: 1.4 },
};

const FlowShader = {
  uniforms: {
    uTime: { value: 0 },
    uSpeed: { value: 1.5 },
    uColor: { value: new THREE.Color(0x2a9fff) },
    uEmissive: { value: new THREE.Color(0x0a3060) },
    uOpacity: { value: 0.75 },
    uEnergy: { value: 0.3 },
    uValve: { value: 1.0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;
    void main() {
      vUv = uv;
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vNormal = normalize(mat3(modelMatrix) * normal);
      vView = cameraPosition - wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform float uSpeed;
    uniform vec3 uColor;
    uniform vec3 uEmissive;
    uniform float uOpacity;
    uniform float uEnergy;
    uniform float uValve;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1.0,0.0)), f.x),
                 mix(hash(i+vec2(0.0,1.0)), hash(i+vec2(1.0,1.0)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.11;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      float spd = uSpeed * max(0.04, uValve);
      // Scrolling flow along tube U
      vec2 uv = vUv * vec2(8.0, 2.0);
      uv.x -= uTime * spd * 1.4;

      float n = fbm(uv);
      float bands = smoothstep(0.35, 0.75, n);
      // Secondary faster layer
      float n2 = fbm(uv * 1.7 + vec2(uTime * spd * 0.5, 0.0));
      bands = mix(bands, n2, 0.35);

      // Fresnel rim for liquid/energy look
      vec3 N = normalize(vNormal);
      vec3 V = normalize(vView);
      float fres = pow(1.0 - max(dot(N, V), 0.0), 2.8);

      vec3 col = uColor * (0.35 + bands * 0.9);
      col += uEmissive * uEnergy * (0.4 + bands * 1.2);
      col += vec3(0.6, 0.85, 1.0) * fres * (0.35 + uEnergy * 0.5);

      // Valve nearly closed → darker / stagnant
      float flowVis = mix(0.25, 1.0, uValve);
      float alpha = uOpacity * (0.4 + bands * 0.6) * flowVis;
      alpha = mix(alpha, alpha * 0.5 + fres * 0.4, 0.35);

      gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
    }
  `,
};

let root, pipeShell, branchShell, flowMain, flowBranch;
let particles, progresses, valveMesh, leakPts, leakVel, sceneRef;
let mainCurve, branchCurve, densCache = -1, medCache = '';

function buildCurves() {
  mainCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-4, 1.2, 0),
    new THREE.Vector3(-2, 1.2, 0),
    new THREE.Vector3(0, 1.5, 0.5),
    new THREE.Vector3(2, 1.2, 0),
    new THREE.Vector3(4, 1.2, 0),
  ]);
  branchCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 1.5, 0.5),
    new THREE.Vector3(0.5, 1.8, 1.5),
    new THREE.Vector3(1.2, 2.4, 2.2),
  ]);
}

function makeShell(curve, radial) {
  const geo = new THREE.TubeGeometry(curve, 96, radial, 24, false);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x6a7380,
    metalness: 0.92,
    roughness: 0.28,
    envMapIntensity: 1.1,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.42,
  });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function makeFlow(curve, radial, params) {
  const geo = new THREE.TubeGeometry(curve, 96, radial * 0.72, 20, false);
  const med = MEDIUM[params.medium] || MEDIUM.liquid;
  const uniforms = THREE.UniformsUtils.clone(FlowShader.uniforms);
  uniforms.uColor.value = med.color.clone();
  uniforms.uEmissive.value = med.emissive.clone();
  uniforms.uOpacity.value = med.opacity;
  uniforms.uEnergy.value = med.energy;
  uniforms.uSpeed.value = params.flowSpeed;
  uniforms.uValve.value = params.valveOpen;
  return new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: FlowShader.vertexShader,
      fragmentShader: FlowShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: med.energy > 0.8 ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
  );
}

function rebuildParticles(params) {
  if (particles) {
    root.remove(particles);
    particles.geometry.dispose();
    particles.material.dispose();
  }
  const n = Math.max(24, Math.floor(140 * params.density));
  const pos = new Float32Array(n * 3);
  progresses = new Float32Array(n);
  const which = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    progresses[i] = Math.random();
    which[i] = Math.random() < 0.25 ? 1 : 0;
    pos[i * 3 + 1] = -10;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const med = MEDIUM[params.medium] || MEDIUM.liquid;
  particles = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: med.color,
      size: 0.09,
      transparent: true,
      opacity: Math.min(1, med.opacity + 0.2),
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  particles._which = which;
  root.add(particles);
}

function applyMediumToFlow(mesh, params) {
  if (!mesh?.material?.uniforms) return;
  const med = MEDIUM[params.medium] || MEDIUM.liquid;
  const u = mesh.material.uniforms;
  u.uColor.value.copy(med.color);
  u.uEmissive.value.copy(med.emissive);
  u.uOpacity.value = med.opacity;
  u.uEnergy.value = med.energy;
  u.uSpeed.value = params.flowSpeed;
  u.uValve.value = params.valveOpen;
  mesh.material.blending = med.energy > 0.8 ? THREE.AdditiveBlending : THREE.NormalBlending;
  mesh.material.needsUpdate = true;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'pipeFlow';
  buildCurves();

  pipeShell = makeShell(mainCurve, 0.26);
  branchShell = makeShell(branchCurve, 0.19);
  flowMain = makeFlow(mainCurve, 0.26, params);
  flowBranch = makeFlow(branchCurve, 0.19, params);
  root.add(pipeShell, branchShell, flowMain, flowBranch);

  // Industrial flanges
  for (const t of [0.05, 0.5, 0.95]) {
    const p = mainCurve.getPointAt(t);
    const flange = new THREE.Mesh(
      new THREE.CylinderGeometry(0.38, 0.38, 0.12, 20),
      new THREE.MeshStandardMaterial({ color: 0x4a5560, metalness: 0.85, roughness: 0.35 })
    );
    flange.position.copy(p);
    const tan = mainCurve.getTangentAt(t);
    flange.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan.clone().normalize());
    root.add(flange);
  }

  // Valve
  valveMesh = new THREE.Group();
  const disc = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.055, 10, 28),
    new THREE.MeshStandardMaterial({ color: 0xcc3333, metalness: 0.6, roughness: 0.35, envMapIntensity: 1 })
  );
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.09, 0.22, 14),
    new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.9, roughness: 0.25 })
  );
  hub.rotation.x = Math.PI / 2;
  const spoke = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.04, 0.04),
    new THREE.MeshStandardMaterial({ color: 0xaa2222, metalness: 0.7, roughness: 0.3 })
  );
  valveMesh.add(disc, hub, spoke);
  valveMesh.position.set(0.15, 1.7, 0.9);
  root.add(valveMesh);

  for (const x of [-3, 0, 3]) {
    const s = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 1.25, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.6, roughness: 0.5 })
    );
    s.position.set(x, 0.62, 0);
    s.castShadow = true;
    root.add(s);
  }

  rebuildParticles(params);
  densCache = params.density;
  medCache = params.medium;

  const ln = 100;
  const lp = new Float32Array(ln * 3);
  leakVel = new Float32Array(ln * 3);
  for (let i = 0; i < ln; i++) lp[i * 3 + 1] = -20;
  const lgeo = new THREE.BufferGeometry();
  lgeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  leakPts = new THREE.Points(
    lgeo,
    new THREE.PointsMaterial({
      color: 0x44aaff,
      size: 0.08,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  root.add(leakPts);

  ctx.scene.add(root);
  ctx.camera.position.set(2.2, 4.2, 7.5);
  ctx.camera.lookAt(0, 1.5, 0);
}

export function update(dt, params, ctx) {
  if (!flowMain) return;

  if (Math.abs(params.density - densCache) > 0.05 || params.medium !== medCache) {
    densCache = params.density;
    medCache = params.medium;
    rebuildParticles(params);
    // Rebuild flow materials for blending mode change
    root.remove(flowMain); flowMain.geometry.dispose(); flowMain.material.dispose();
    root.remove(flowBranch); flowBranch.geometry.dispose(); flowBranch.material.dispose();
    flowMain = makeFlow(mainCurve, 0.26, params);
    flowBranch = makeFlow(branchCurve, 0.19, params);
    root.add(flowMain, flowBranch);
  }

  applyMediumToFlow(flowMain, params);
  applyMediumToFlow(flowBranch, params);
  const t = ctx.clock.elapsedTime;
  flowMain.material.uniforms.uTime.value = t;
  flowBranch.material.uniforms.uTime.value = t;
  // Branch restricted more by valve
  flowBranch.material.uniforms.uValve.value = params.valveOpen * params.valveOpen;

  const med = MEDIUM[params.medium] || MEDIUM.liquid;
  if (particles) {
    particles.material.color.copy(med.color);
    particles.material.opacity = Math.min(1, med.opacity + 0.2);
    const effective = params.flowSpeed * Math.max(0.05, params.valveOpen);
    const pos = particles.geometry.attributes.position.array;
    const which = particles._which;
    const n = progresses.length;
    const _p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const onBranch = which[i] > 0.5;
      const spd = onBranch ? effective * params.valveOpen : effective;
      progresses[i] += dt * spd * 0.12;
      if (progresses[i] >= 1) {
        progresses[i] = 0;
        which[i] = Math.random() < 0.3 ? 1 : 0;
      }
      const curve = onBranch ? branchCurve : mainCurve;
      curve.getPointAt(progresses[i], _p);
      pos[i * 3] = _p.x + (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 1] = _p.y + (Math.random() - 0.5) * 0.04;
      pos[i * 3 + 2] = _p.z + (Math.random() - 0.5) * 0.04;
    }
    particles.geometry.attributes.position.needsUpdate = true;
  }

  valveMesh.rotation.z = (1 - params.valveOpen) * Math.PI;
  valveMesh.children[0].material.color.setHex(params.valveOpen > 0.3 ? 0x33aa55 : 0xcc3333);

  leakPts.visible = !!params.leak;
  if (params.leak) {
    const lp = leakPts.geometry.attributes.position.array;
    const origin = branchCurve.getPointAt(0.55);
    for (let i = 0; i < lp.length / 3; i++) {
      if (lp[i * 3 + 1] < -5 || Math.random() < 0.03 * Math.max(0.2, params.valveOpen)) {
        lp[i * 3] = origin.x + (Math.random() - 0.5) * 0.1;
        lp[i * 3 + 1] = origin.y;
        lp[i * 3 + 2] = origin.z;
        leakVel[i * 3] = (Math.random() - 0.5) * 1.2;
        leakVel[i * 3 + 1] = -1.2 - Math.random() * 2.5;
        leakVel[i * 3 + 2] = 0.6 + Math.random() * 1.2;
      } else {
        lp[i * 3] += leakVel[i * 3] * dt;
        lp[i * 3 + 1] += leakVel[i * 3 + 1] * dt;
        lp[i * 3 + 2] += leakVel[i * 3 + 2] * dt;
        leakVel[i * 3 + 1] -= 7 * dt;
      }
    }
    leakPts.geometry.attributes.position.needsUpdate = true;
    leakPts.material.color.copy(med.color);
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = pipeShell = branchShell = flowMain = flowBranch = null;
  particles = progresses = valveMesh = leakPts = leakVel = null;
  sceneRef = mainCurve = branchCurve = null;
  densCache = -1;
  medCache = '';
}
