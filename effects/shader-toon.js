/**
 * shader-toon.js — 卡通着色 / Toon (GradientMap + outline)
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'shader-toon';
export const title = '卡通 Toon';
export const category = 'shaders';

export const guiSchema = [
  { key: 'steps', label: '色阶 Steps', options: { '2阶': 2, '3阶': 3, '4阶': 4, '5阶': 5 }, default: 3 },
  { key: 'outline', label: '描边宽度 Outline', min: 0, max: 0.08, step: 0.001, default: 0.025 },
  { key: 'baseColor', label: '固有色 Base', default: '#5b8cff' },
  { key: 'ambient', label: '环境光 Ambient', min: 0, max: 1, step: 0.01, default: 0.35 },
];

let root, mesh, outline, toonMat, sceneRef, light, lastSteps;

function makeGradient(steps) {
  const c = document.createElement('canvas');
  c.width = steps;
  c.height = 1;
  const g = c.getContext('2d');
  for (let i = 0; i < steps; i++) {
    const v = Math.floor((i / (steps - 1)) * 255);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(i, 0, 1, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'toon';
  lastSteps = Number(params.steps);

  toonMat = new THREE.MeshToonMaterial({
    color: new THREE.Color(params.baseColor),
    gradientMap: makeGradient(lastSteps),
  });
  mesh = new THREE.Mesh(new THREE.SphereGeometry(1.1, 48, 48), toonMat);
  mesh.position.y = 1.5;
  root.add(mesh);

  // inverted-hull outline
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x0a0c12,
    side: THREE.BackSide,
  });
  outline = new THREE.Mesh(mesh.geometry, outlineMat);
  outline.scale.setScalar(1 + params.outline);
  outline.position.copy(mesh.position);
  root.add(outline);

  // extra key for toon bands
  light = new THREE.DirectionalLight(0xffffff, 1.4);
  light.position.set(3, 5, 2);
  root.add(light);
  const amb = new THREE.AmbientLight(0xffffff, params.ambient);
  amb.name = 'toonAmb';
  root.add(amb);

  ctx.scene.add(root);
  ctx.camera.position.set(0, 2.2, 5);
  ctx.camera.lookAt(0, 1.4, 0);
}

export function update(dt, params) {
  if (!mesh) return;
  const steps = Number(params.steps);
  if (steps !== lastSteps) {
    if (toonMat.gradientMap) toonMat.gradientMap.dispose();
    toonMat.gradientMap = makeGradient(steps);
    lastSteps = steps;
  }
  toonMat.color.set(params.baseColor);
  outline.scale.setScalar(1 + params.outline);
  outline.visible = params.outline > 0.001;
  const amb = root.getObjectByName('toonAmb');
  if (amb) amb.intensity = params.ambient;
  mesh.rotation.y += dt * 0.6;
  outline.rotation.copy(mesh.rotation);
  outline.position.copy(mesh.position);
}

export function dispose() {
  if (toonMat?.gradientMap) toonMat.gradientMap.dispose();
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = mesh = outline = toonMat = light = sceneRef = null;
}
