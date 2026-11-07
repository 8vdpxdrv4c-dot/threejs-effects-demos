/**
 * shader-hologram.js — 全息扫描线 / Hologram scanlines + fresnel
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'shader-hologram';
export const title = '全息 Hologram';
export const category = 'shaders';

export const guiSchema = [
  { key: 'scanSpeed', label: '扫描速度 Scan', min: 0, max: 5, step: 0.05, default: 1.2 },
  { key: 'scanDensity', label: '扫描线密度 Density', min: 10, max: 120, step: 1, default: 40 },
  { key: 'fresnelPower', label: '菲涅尔 Fresnel', min: 0.5, max: 5, step: 0.1, default: 2.2 },
  { key: 'opacity', label: '透明度 Opacity', min: 0.1, max: 1, step: 0.01, default: 0.65 },
  { key: 'tint', label: '色调 Tint', default: '#33ffcc' },
  { key: 'glitch', label: '故障 Glitch', min: 0, max: 1, step: 0.01, default: 0.15 },
];

const vert = /* glsl */`
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vPos;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vPos = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const frag = /* glsl */`
uniform float uTime;
uniform float uScanSpeed;
uniform float uScanDensity;
uniform float uFresnel;
uniform float uOpacity;
uniform float uGlitch;
uniform vec3 uTint;
varying vec3 vWorldNormal;
varying vec3 vViewDir;
varying vec3 vPos;

void main() {
  float fres = pow(1.0 - max(dot(normalize(vWorldNormal), normalize(vViewDir)), 0.0), uFresnel);
  float scan = sin((vPos.y + uTime * uScanSpeed) * uScanDensity) * 0.5 + 0.5;
  scan = pow(scan, 2.0);
  float g = step(0.97, fract(sin(uTime * 20.0 + vPos.y * 8.0) * 43758.5)) * uGlitch;
  vec3 col = uTint * (0.25 + fres * 1.2 + scan * 0.35);
  col += vec3(g);
  float alpha = (0.2 + fres * 0.7 + scan * 0.2) * uOpacity;
  gl_FragColor = vec4(col, alpha);
}
`;

let root, mesh, mat, sceneRef;

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'hologram';
  mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uScanSpeed: { value: params.scanSpeed },
      uScanDensity: { value: params.scanDensity },
      uFresnel: { value: params.fresnelPower },
      uOpacity: { value: params.opacity },
      uGlitch: { value: params.glitch },
      uTint: { value: new THREE.Color(params.tint) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  mesh = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.2, 32), mat);
  mesh.position.y = 1.5;
  root.add(mesh);
  // pedestal
  const ped = new THREE.Mesh(
    new THREE.CylinderGeometry(0.7, 0.9, 0.2, 32),
    new THREE.MeshStandardMaterial({ color: 0x222833, metalness: 0.6, roughness: 0.3 })
  );
  ped.position.y = 0.1;
  root.add(ped);
  ctx.scene.add(root);
  ctx.camera.position.set(0, 2.2, 5);
  ctx.camera.lookAt(0, 1.4, 0);
}

export function update(dt, params, ctx) {
  if (!mat) return;
  mat.uniforms.uTime.value = ctx.clock.elapsedTime;
  mat.uniforms.uScanSpeed.value = params.scanSpeed;
  mat.uniforms.uScanDensity.value = params.scanDensity;
  mat.uniforms.uFresnel.value = params.fresnelPower;
  mat.uniforms.uOpacity.value = params.opacity;
  mat.uniforms.uGlitch.value = params.glitch;
  mat.uniforms.uTint.value.set(params.tint);
  mesh.rotation.y += dt * 0.5;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = mesh = mat = sceneRef = null;
}
