/**
 * dispose.js — Deep dispose helpers to avoid GPU leaks when switching effects
 * 切换特效时深度释放几何体 / 材质 / 纹理 / 渲染目标
 */
import * as THREE from 'three';

export function disposeMaterial(mat) {
  if (!mat) return;
  const maps = [
    'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap',
    'emissiveMap', 'envMap', 'lightMap', 'metalnessMap', 'normalMap',
    'roughnessMap', 'specularMap', 'gradientMap',
  ];
  for (const k of maps) {
    if (mat[k] && mat[k].dispose) mat[k].dispose();
  }
  if (mat.uniforms) {
    for (const u of Object.values(mat.uniforms)) {
      if (u && u.value && u.value.isTexture) u.value.dispose();
    }
  }
  mat.dispose();
}

export function disposeObject3D(root) {
  if (!root) return;
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(disposeMaterial);
      else disposeMaterial(obj.material);
    }
  });
}

/** 从 scene 移除并 dispose 一组对象 */
export function removeAndDispose(scene, objects) {
  const list = Array.isArray(objects) ? objects : [objects];
  for (const o of list) {
    if (!o) continue;
    if (o.parent) o.parent.remove(o);
    else if (scene) scene.remove(o);
    disposeObject3D(o);
  }
}

/** EffectComposer 及其 Pass / 渲染目标 */
export function disposeComposer(composer) {
  if (!composer || composer.__disposed) return;
  composer.__disposed = true;
  try {
    if (composer.passes) {
      for (const pass of composer.passes) {
        try {
          if (pass.dispose) pass.dispose();
          if (pass.material) disposeMaterial(pass.material);
          if (pass.fsQuad && pass.fsQuad.dispose) pass.fsQuad.dispose();
        } catch (_) { /* already freed */ }
      }
    }
    if (composer.renderTarget1) composer.renderTarget1.dispose();
    if (composer.renderTarget2) composer.renderTarget2.dispose();
    if (composer.writeBuffer && composer.writeBuffer.dispose) composer.writeBuffer.dispose();
    if (composer.readBuffer && composer.readBuffer.dispose) composer.readBuffer.dispose();
  } catch (_) { /* idempotent */ }
}

/** 清空 scene 中非默认命名对象（保留灯光/地面若需要） */
export function clearSceneChildren(scene, { keepNames = [] } = {}) {
  const keep = new Set(keepNames);
  const toRemove = [];
  for (const child of scene.children) {
    if (keep.has(child.name)) continue;
    toRemove.push(child);
  }
  for (const c of toRemove) {
    scene.remove(c);
    disposeObject3D(c);
  }
}
