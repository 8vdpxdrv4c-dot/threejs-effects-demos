/**
 * shader-dissolve.js — 溶解着色器 / Dissolve (noise threshold + edge glow)
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'shader-dissolve';
export const title = '溶解 Dissolve';
export const category = 'shaders';

export const guiSchema = [
  { key: 'progress', label: '溶解进度 Progress', min: 0, max: 1, step: 0.01, default: 0.35 },
  { key: 'edgeWidth', label: '边缘宽度 Edge', min: 0.01, max: 0.3, step: 0.005, default: 0.08 },
  { key: 'edgeColor', label: '边缘色 EdgeColor', default: '#00ffcc' },
  { key: 'noiseScale', label: '噪声尺度 Noise', min: 0.5, max: 8, step: 0.1, default: 3 },
  { key: 'autoPlay', label: '自动播放 Auto', default: true },
];

const vert = /* glsl */`
varying vec2 vUv;
varying vec3 vPos;
void main() {
  vUv = uv;
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const frag = /* glsl */`
uniform float uProgress;
uniform float uEdge;
uniform float uNoiseScale;
uniform vec3 uEdgeColor;
uniform vec3 uBaseColor;
varying vec2 vUv;
varying vec3 vPos;

// simple 3D hash noise
float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
        mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
        mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
    f.z
  );
}

void main() {
  float n = noise(vPos * uNoiseScale);
  float d = n - uProgress;
  if (d < 0.0) discard;
  float edge = smoothstep(0.0, uEdge, d);
  vec3 col = mix(uEdgeColor, uBaseColor, edge);
  float glow = 1.0 - edge;
  col += uEdgeColor * glow * 1.5;
  gl_FragColor = vec4(col, 1.0);
}
`;

let root, mesh, mat, sceneRef, dir = 1;

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'dissolve';
  mat = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: params.progress },
      uEdge: { value: params.edgeWidth },
      uNoiseScale: { value: params.noiseScale },
      uEdgeColor: { value: new THREE.Color(params.edgeColor) },
      uBaseColor: { value: new THREE.Color(0x6688cc) },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
  });
  mesh = new THREE.Mesh(new THREE.TorusKnotGeometry(1, 0.35, 128, 32), mat);
  mesh.position.y = 1.8;
  root.add(mesh);
  ctx.scene.add(root);
  ctx.camera.position.set(0, 2.2, 5);
  ctx.camera.lookAt(0, 1.8, 0);
}

export function update(dt, params) {
  if (!mat) return;
  if (params.autoPlay) {
    params.progress += dir * dt * 0.25;
    if (params.progress >= 1) { params.progress = 1; dir = -1; }
    if (params.progress <= 0) { params.progress = 0; dir = 1; }
  }
  mat.uniforms.uProgress.value = params.progress;
  mat.uniforms.uEdge.value = params.edgeWidth;
  mat.uniforms.uNoiseScale.value = params.noiseScale;
  mat.uniforms.uEdgeColor.value.set(params.edgeColor);
  mesh.rotation.y += dt * 0.4;
  mesh.rotation.x += dt * 0.15;
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = mesh = mat = sceneRef = null;
}
