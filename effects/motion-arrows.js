/**
 * motion-arrows.js — 路径跟随箭头 / Path-following arrows
 * CatmullRomCurve3 + ArrowHelper / custom cones, trail, count, speed
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'motion-arrows';
export const title = '运动箭头 Arrows';
export const category = 'motion-arrows';

export const guiSchema = [
  { key: 'count', label: '数量 Count', min: 1, max: 24, step: 1, default: 8 },
  { key: 'speed', label: '速度 Speed', min: 0.05, max: 1.5, step: 0.01, default: 0.35 },
  { key: 'trail', label: '拖尾 Trail', min: 0, max: 1, step: 0.01, default: 0.55 },
  { key: 'scale', label: '尺寸 Scale', min: 0.3, max: 2, step: 0.05, default: 1 },
  { key: 'color', label: '颜色 Color', default: '#5bff9a' },
];

let root, curve, arrows, trails, progresses, sceneRef, pathLine, lastCount;

function makeCurve() {
  const pts = [
    new THREE.Vector3(-3, 0.5, 2),
    new THREE.Vector3(-1.5, 2.5, 0),
    new THREE.Vector3(0, 1.2, -2),
    new THREE.Vector3(1.5, 3.0, 0.5),
    new THREE.Vector3(3, 1.0, 2),
    new THREE.Vector3(1, 0.8, 3),
    new THREE.Vector3(-2, 1.5, 2.5),
  ];
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.4);
}

function buildArrows(params) {
  if (arrows) {
    arrows.forEach((a) => {
      root.remove(a.group);
      a.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    });
  }
  if (trails) {
    trails.forEach((t) => {
      root.remove(t);
      t.geometry.dispose();
      t.material.dispose();
    });
  }
  lastCount = params.count;
  arrows = [];
  trails = [];
  progresses = [];
  const col = new THREE.Color(params.color);

  for (let i = 0; i < params.count; i++) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.45, 8),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 })
    );
    body.rotation.x = Math.PI / 2;
    body.position.z = -0.1;
    const head = new THREE.Mesh(
      new THREE.ConeGeometry(0.1, 0.28, 10),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7 })
    );
    head.rotation.x = Math.PI / 2;
    head.position.z = 0.22;
    group.add(body, head);
    group.scale.setScalar(params.scale);
    root.add(group);

    // trail line
    const trailN = 20;
    const tpos = new Float32Array(trailN * 3);
    const tgeo = new THREE.BufferGeometry();
    tgeo.setAttribute('position', new THREE.BufferAttribute(tpos, 3));
    const tmat = new THREE.LineBasicMaterial({
      color: col,
      transparent: true,
      opacity: params.trail * 0.7,
    });
    const line = new THREE.Line(tgeo, tmat);
    root.add(line);

    arrows.push({ group, body, head });
    trails.push(line);
    progresses.push(i / params.count);
  }
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'motionArrows';
  curve = makeCurve();

  const pathGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(100));
  pathLine = new THREE.Line(
    pathGeo,
    new THREE.LineDashedMaterial({ color: 0x445566, dashSize: 0.2, gapSize: 0.1 })
  );
  pathLine.computeLineDistances();
  root.add(pathLine);

  ctx.scene.add(root);
  buildArrows(params);
  ctx.camera.position.set(0, 5, 8);
  ctx.camera.lookAt(0, 1.5, 0);
}

const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _look = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);

export function update(dt, params) {
  if (!curve) return;
  if (params.count !== lastCount) buildArrows(params);

  const col = new THREE.Color(params.color);
  for (let i = 0; i < arrows.length; i++) {
    progresses[i] = (progresses[i] + dt * params.speed * 0.15) % 1;
    const u = progresses[i];
    curve.getPointAt(u, _p);
    curve.getTangentAt(u, _t).normalize();
    arrows[i].group.position.copy(_p);
    // orient +Z along tangent
    _look.lookAt(new THREE.Vector3(), _t, _up);
    _q.setFromRotationMatrix(_look);
    arrows[i].group.quaternion.slerp(_q, 0.35);
    arrows[i].group.scale.setScalar(params.scale);
    arrows[i].body.material.color.copy(col);
    arrows[i].body.material.emissive.copy(col);
    arrows[i].head.material.color.copy(col);
    arrows[i].head.material.emissive.copy(col);

    // update trail
    const line = trails[i];
    const arr = line.geometry.attributes.position.array;
    const trailN = arr.length / 3;
    for (let k = 0; k < trailN; k++) {
      const tu = (u - (k / trailN) * 0.12 * params.trail + 1) % 1;
      curve.getPointAt(tu, _p);
      arr[k * 3] = _p.x;
      arr[k * 3 + 1] = _p.y;
      arr[k * 3 + 2] = _p.z;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.material.opacity = params.trail * 0.7;
    line.material.color.copy(col);
    line.visible = params.trail > 0.02;
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = curve = arrows = trails = progresses = pathLine = sceneRef = null;
}
