/**
 * shader-glass.js — Photoreal glass via MeshPhysicalMaterial transmission + IBL
 *
 * Technique: MeshPhysicalMaterial (transmission, thickness, ior, roughness,
 * attenuationColor) relying on scene.environment from RoomEnvironment PMREM.
 * Colorful backdrop + chrome stand for refraction/reflection read.
 *
 * Params: transmission, thickness, ior, roughness, tint
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'shader-glass';
export const title = '玻璃 Glass';
export const category = 'shaders';

export const guiSchema = [
  { key: 'transmission', label: '透射 Transmission', min: 0, max: 1, step: 0.01, default: 0.97 },
  { key: 'thickness', label: '厚度 Thickness', min: 0, max: 4, step: 0.05, default: 1.4 },
  { key: 'ior', label: '折射率 IOR', min: 1.0, max: 2.3, step: 0.01, default: 1.5 },
  { key: 'roughness', label: '粗糙 Roughness', min: 0, max: 0.5, step: 0.01, default: 0.04 },
  { key: 'tint', label: '染色 Tint', default: '#c8e8ff' },
];

let root, mesh, mat, sceneRef, prevExposure;

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'glass';

  // Colorful emissive backdrop for transmission read
  const colors = [0xff4466, 0x44ff88, 0x4488ff, 0xffcc33, 0xff66cc, 0x66ffee];
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Mesh(
      new THREE.SphereGeometry(0.32 + (i % 3) * 0.08, 28, 28),
      new THREE.MeshStandardMaterial({
        color: colors[i],
        emissive: colors[i],
        emissiveIntensity: 0.55,
        roughness: 0.35,
        metalness: 0.1,
      })
    );
    const a = (i / 6) * Math.PI * 2;
    b.position.set(Math.cos(a) * 2.4, 0.7 + (i % 2) * 0.9, Math.sin(a) * 2.4);
    root.add(b);
  }

  // Chrome pedestal
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.7, 0.25, 32),
    new THREE.MeshStandardMaterial({
      color: 0xccccdd,
      metalness: 1.0,
      roughness: 0.15,
      envMapIntensity: 1.4,
    })
  );
  pedestal.position.y = 0.12;
  pedestal.receiveShadow = true;
  root.add(pedestal);

  mat = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(params.tint),
    metalness: 0,
    roughness: params.roughness,
    transmission: params.transmission,
    thickness: params.thickness,
    ior: params.ior,
    transparent: true,
    opacity: 1,
    envMapIntensity: 1.25,
    attenuationColor: new THREE.Color(params.tint),
    attenuationDistance: 2.5,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
    specularIntensity: 1.0,
  });
  mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 3), mat);
  mesh.position.y = 1.65;
  mesh.castShadow = true;
  root.add(mesh);

  // Thin glass torus accent
  const torus = new THREE.Mesh(
    new THREE.TorusGeometry(1.55, 0.08, 24, 64),
    mat.clone()
  );
  torus.position.y = 1.65;
  torus.rotation.x = Math.PI / 2.4;
  torus.name = 'glassRing';
  root.add(torus);

  ctx.scene.add(root);
  ctx.camera.position.set(0, 2.6, 6.2);
  ctx.camera.lookAt(0, 1.4, 0);
  prevExposure = ctx.renderer.toneMappingExposure;
  ctx.renderer.toneMappingExposure = 1.2;
}

export function update(dt, params) {
  if (!mat) return;
  mat.transmission = params.transmission;
  mat.thickness = params.thickness;
  mat.ior = params.ior;
  mat.roughness = params.roughness;
  mat.color.set(params.tint);
  mat.attenuationColor.set(params.tint);
  mesh.rotation.y += dt * 0.32;
  mesh.rotation.x = Math.sin(performance.now() * 0.00045) * 0.18;
  const ring = root.getObjectByName('glassRing');
  if (ring) {
    ring.material.transmission = params.transmission;
    ring.material.thickness = params.thickness * 0.5;
    ring.material.ior = params.ior;
    ring.material.roughness = params.roughness;
    ring.material.color.set(params.tint);
    ring.rotation.z += dt * 0.2;
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = mesh = mat = sceneRef = null;
}
