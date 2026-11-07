/**
 * lighting-godray.js — Volumetric godrays (shader shafts + dust motes)
 *
 * Technique: Cone/cylinder meshes with custom ShaderMaterial —
 * axial density falloff + scrolling noise + fresnel-ish edge fade,
 * additive blending. Dust Points drift through shafts.
 *
 * Params: intensity, shaftCount, dust, angle, color
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'lighting-godray';
export const title = '体积光 Godray';
export const category = 'lighting';

export const guiSchema = [
  { key: 'intensity', label: '强度 Intensity', min: 0.1, max: 3, step: 0.05, default: 1.25 },
  { key: 'shaftCount', label: '光柱数量 Shafts', min: 1, max: 8, step: 1, default: 4 },
  { key: 'dust', label: '尘埃 Dust', min: 0, max: 500, step: 10, default: 200 },
  { key: 'angle', label: '角度 Angle', min: -1, max: 1, step: 0.01, default: -0.35 },
  { key: 'color', label: '颜色 Color', default: '#ffd9a0' },
];

const ShaftShader = {
  uniforms: {
    uColor: { value: new THREE.Color(0xffd9a0) },
    uIntensity: { value: 1.25 },
    uTime: { value: 0 },
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
    uniform vec3 uColor;
    uniform float uIntensity;
    uniform float uTime;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vView;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p); vec2 f = fract(p);
      f = f*f*(3.0-2.0*f);
      return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x),
                 mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.,1.)), f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0; float a = 0.5;
      for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
      return v;
    }

    void main() {
      // Axial fade: bright near window (vUv.y~1), soft toward floor
      float axial = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.55, vUv.y);
      // Radial soft edges of cylinder UV
      float radial = 1.0 - abs(vUv.x - 0.5) * 2.0;
      radial = pow(clamp(radial, 0.0, 1.0), 1.4);

      float n = fbm(vec2(vUv.x * 4.0, vUv.y * 6.0 - uTime * 0.15));
      float dens = axial * radial * (0.55 + n * 0.55);

      vec3 N = normalize(vNormal);
      vec3 V = normalize(vView);
      float rim = pow(1.0 - abs(dot(N, V)), 1.5);

      float alpha = dens * uIntensity * 0.22 * (0.7 + rim * 0.5);
      if (alpha < 0.005) discard;
      vec3 col = uColor * (0.8 + dens * 0.6) * uIntensity;
      gl_FragColor = vec4(col, alpha);
    }
  `,
};

let root, shafts, dustPts, sceneRef, light, lastShafts, lastDust;

function buildShafts(params) {
  if (shafts) {
    root.remove(shafts);
    shafts.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  shafts = new THREE.Group();
  lastShafts = params.shaftCount;
  const col = new THREE.Color(params.color);
  for (let i = 0; i < params.shaftCount; i++) {
    const geo = new THREE.CylinderGeometry(0.08, 1.05, 9, 20, 1, true);
    const uniforms = THREE.UniformsUtils.clone(ShaftShader.uniforms);
    uniforms.uColor.value = col.clone();
    uniforms.uIntensity.value = params.intensity;
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: ShaftShader.vertexShader,
      fragmentShader: ShaftShader.fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set((i - (params.shaftCount - 1) / 2) * 0.75, 4.2, -1.1);
    m.rotation.z = params.angle;
    m.rotation.x = 0.18;
    shafts.add(m);
  }
  root.add(shafts);
}

function buildDust(params) {
  if (dustPts) {
    root.remove(dustPts);
    dustPts.geometry.dispose();
    dustPts.material.dispose();
  }
  lastDust = params.dust;
  const n = params.dust;
  const pos = new Float32Array(n * 3);
  const sizes = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 8;
    pos[i * 3 + 1] = Math.random() * 6.5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 6;
    sizes[i] = 0.02 + Math.random() * 0.05;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dustPts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: params.color,
      size: 0.045,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    })
  );
  root.add(dustPts);
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'godray';

  // Dark industrial window wall
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(7, 5, 0.25),
    new THREE.MeshStandardMaterial({ color: 0x12161e, roughness: 0.85, metalness: 0.2 })
  );
  wall.position.set(0, 3.2, -3.2);
  root.add(wall);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(5.2, 3.6, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a2030, metalness: 0.5, roughness: 0.5 })
  );
  frame.position.set(0, 3.5, -3.05);
  root.add(frame);

  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(4.4, 2.9),
    new THREE.MeshBasicMaterial({
      color: params.color,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  pane.position.set(0, 3.5, -2.95);
  pane.name = 'pane';
  root.add(pane);

  // Cross bars
  for (const x of [-1.1, 1.1]) {
    const bar = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.9, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x2a3038, metalness: 0.6, roughness: 0.4 })
    );
    bar.position.set(x, 3.5, -2.92);
    root.add(bar);
  }

  light = new THREE.DirectionalLight(params.color, params.intensity * 0.8);
  light.position.set(2, 9, 3);
  root.add(light);
  const spot = new THREE.SpotLight(params.color, params.intensity * 1.5, 20, 0.45, 0.6);
  spot.position.set(0, 6, -2);
  spot.target.position.set(0, 0, 2);
  root.add(spot, spot.target);
  spot.name = 'godSpot';

  ctx.scene.add(root);
  buildShafts(params);
  buildDust(params);
  ctx.camera.position.set(0, 2.6, 7.5);
  ctx.camera.lookAt(0, 2.5, 0);
  if (ctx.scene.fog) ctx.scene.fog.density = 0.018;
}

export function update(dt, params, ctx) {
  if (params.shaftCount !== lastShafts) buildShafts(params);
  if (params.dust !== lastDust) buildDust(params);

  const t = ctx.clock.elapsedTime;
  if (shafts) {
    shafts.children.forEach((m, i) => {
      m.rotation.z = params.angle;
      const u = m.material.uniforms;
      u.uTime.value = t;
      u.uIntensity.value = params.intensity * (0.85 + 0.15 * Math.sin(t * 1.8 + i));
      u.uColor.value.set(params.color);
    });
  }
  if (light) {
    light.color.set(params.color);
    light.intensity = params.intensity * 0.8;
  }
  const spot = root.getObjectByName('godSpot');
  if (spot) {
    spot.color.set(params.color);
    spot.intensity = params.intensity * 1.5;
  }
  const pane = root.getObjectByName('pane');
  if (pane) {
    pane.material.color.set(params.color);
    pane.material.opacity = 0.35 + 0.15 * params.intensity;
  }
  if (dustPts) {
    dustPts.material.color.set(params.color);
    const pos = dustPts.geometry.attributes.position.array;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3 + 1] += dt * (0.12 + (i % 5) * 0.02);
      pos[i * 3] += Math.sin(t * 0.4 + i) * dt * 0.05;
      if (pos[i * 3 + 1] > 6.5) pos[i * 3 + 1] = 0;
    }
    dustPts.geometry.attributes.position.needsUpdate = true;
  }
}

export function dispose() {
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = shafts = dustPts = light = sceneRef = null;
}
