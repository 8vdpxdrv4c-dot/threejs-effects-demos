/**
 * alerts.js — Cinematic alert pulse (industrial beacon)
 *
 * Technique: Emissive dome + expanding ring waves (shader soft edge) +
 * volumetric-ish PointLight pulse + HUD sprite. Critical uses faster
 * double-pulse and red bloom-friendly HDR emissive.
 *
 * Params: level, pulseRate, zoneRadius, intensity, showLabel
 */
import * as THREE from 'three';
import { removeAndDispose } from '../lib/dispose.js';

export const id = 'alerts';
export const title = '告警 Alerts';
export const category = 'alerts';

export const guiSchema = [
  { key: 'level', label: '级别 Level', options: { 信息: 'info', 警告: 'warn', 严重: 'critical' }, default: 'warn' },
  { key: 'pulseRate', label: '脉冲频率 Pulse', min: 0.2, max: 6, step: 0.1, default: 1.5 },
  { key: 'zoneRadius', label: '区域半径 Zone', min: 0.5, max: 6, step: 0.1, default: 2.5 },
  { key: 'intensity', label: '亮度 Intensity', min: 0.2, max: 5, step: 0.1, default: 2 },
  { key: 'showLabel', label: '显示标签 Label', default: true },
];

const LEVEL_COLOR = {
  info: 0x3399ff,
  warn: 0xffaa22,
  critical: 0xff2244,
};

const RingShader = {
  uniforms: {
    uColor: { value: new THREE.Color(0xffaa22) },
    uOpacity: { value: 0.7 },
    uPulse: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    uniform float uOpacity;
    uniform float uPulse;
    varying vec2 vUv;
    void main() {
      vec2 c = vUv - 0.5;
      float d = length(c) * 2.0;
      float ring = smoothstep(0.82, 0.92, d) * (1.0 - smoothstep(0.95, 1.0, d));
      float glow = exp(-pow((d - 0.9) * 8.0, 2.0)) * 0.6;
      float a = (ring + glow) * uOpacity * (0.55 + uPulse * 0.45);
      if (a < 0.01) discard;
      vec3 col = uColor * (1.2 + glow * 2.0);
      gl_FragColor = vec4(col, a);
    }
  `,
};

let root, light, ring, ring2, ring3, beacon, sprite, sceneRef, lastLevel = '';

function makeLabelTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 72;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 320, 72);
  g.fillStyle = 'rgba(0,0,0,0.65)';
  if (g.roundRect) { g.roundRect(8, 8, 304, 56, 10); g.fill(); }
  else g.fillRect(8, 8, 304, 56);
  g.strokeStyle = color;
  g.lineWidth = 2;
  if (g.roundRect) { g.roundRect(8, 8, 304, 56, 10); g.stroke(); }
  g.font = 'bold 30px sans-serif';
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 12;
  g.fillText(text, 160, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeRingMesh() {
  const geo = new THREE.PlaneGeometry(2, 2);
  const uniforms = THREE.UniformsUtils.clone(RingShader.uniforms);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: RingShader.vertexShader,
    fragmentShader: RingShader.fragmentShader,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  return m;
}

export function create(ctx, params) {
  sceneRef = ctx.scene;
  root = new THREE.Group();
  root.name = 'alerts';

  beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.28, 0.55, 20),
    new THREE.MeshStandardMaterial({
      color: 0x2a3038,
      metalness: 0.75,
      roughness: 0.35,
      envMapIntensity: 1,
    })
  );
  beacon.position.y = 0.28;
  beacon.castShadow = true;
  root.add(beacon);

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 32, 20, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({
      color: LEVEL_COLOR[params.level],
      emissive: LEVEL_COLOR[params.level],
      emissiveIntensity: 2.2,
      transparent: true,
      opacity: 0.92,
      roughness: 0.25,
    })
  );
  dome.position.y = 0.55;
  dome.name = 'dome';
  root.add(dome);

  light = new THREE.PointLight(LEVEL_COLOR[params.level], params.intensity, params.zoneRadius * 3.5);
  light.position.y = 0.8;
  root.add(light);

  ring = makeRingMesh();
  ring2 = makeRingMesh();
  ring3 = makeRingMesh();
  root.add(ring, ring2, ring3);

  const tex = makeLabelTexture('WARN', '#ffaa22');
  sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  );
  sprite.position.set(0, 1.55, 0);
  sprite.scale.set(1.8, 0.42, 1);
  root.add(sprite);

  const zone = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshBasicMaterial({
      color: LEVEL_COLOR[params.level],
      transparent: true,
      opacity: 0.07,
      depthWrite: false,
    })
  );
  zone.rotation.x = -Math.PI / 2;
  zone.position.y = 0.02;
  zone.name = 'zone';
  root.add(zone);

  // Fence posts
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x444850, metalness: 0.6, roughness: 0.4 })
    );
    post.position.set(Math.cos(a) * params.zoneRadius, 0.2, Math.sin(a) * params.zoneRadius);
    post.name = 'post' + i;
    root.add(post);
  }

  ctx.scene.add(root);
  ctx.camera.position.set(0, 4.2, 6.5);
  ctx.camera.lookAt(0, 0.5, 0);
  lastLevel = '';
}

export function update(dt, params, ctx) {
  if (!light) return;
  const col = LEVEL_COLOR[params.level] || LEVEL_COLOR.warn;
  const t = ctx.clock.elapsedTime;

  const rateMul = params.level === 'critical' ? 1.85 : params.level === 'info' ? 0.65 : 1;
  // Double-beat for critical
  let pulse;
  if (params.level === 'critical') {
    const p = (t * params.pulseRate * rateMul) % 1;
    pulse = p < 0.15 ? 1 : p < 0.3 ? 0.2 : p < 0.45 ? 0.9 : 0.15;
  } else {
    pulse = 0.5 + 0.5 * Math.sin(t * params.pulseRate * rateMul * Math.PI * 2);
  }

  light.color.setHex(col);
  light.intensity = params.intensity * (0.35 + pulse * 1.1);
  light.distance = params.zoneRadius * 3.5;

  const dome = root.getObjectByName('dome');
  if (dome) {
    dome.material.color.setHex(col);
    dome.material.emissive.setHex(col);
    dome.material.emissiveIntensity = 1.0 + pulse * 2.8;
  }

  const waves = [
    { mesh: ring, phase: 0 },
    { mesh: ring2, phase: 0.33 },
    { mesh: ring3, phase: 0.66 },
  ];
  for (const w of waves) {
    const ph = (pulse + w.phase) % 1;
    const s = params.zoneRadius * (0.25 + ph * 0.95);
    w.mesh.scale.setScalar(s);
    w.mesh.material.uniforms.uColor.value.setHex(col);
    w.mesh.material.uniforms.uOpacity.value = 0.85 * (1 - ph);
    w.mesh.material.uniforms.uPulse.value = pulse;
  }

  const zone = root.getObjectByName('zone');
  if (zone) {
    zone.scale.setScalar(params.zoneRadius);
    zone.material.color.setHex(col);
    zone.material.opacity = 0.05 + pulse * 0.06;
  }

  for (let i = 0; i < 8; i++) {
    const post = root.getObjectByName('post' + i);
    if (post) {
      const a = (i / 8) * Math.PI * 2;
      post.position.set(Math.cos(a) * params.zoneRadius, 0.2, Math.sin(a) * params.zoneRadius);
    }
  }

  sprite.visible = params.showLabel;
  sprite.material.opacity = 0.7 + pulse * 0.3;
  if (params.level !== lastLevel) {
    lastLevel = params.level;
    const labels = { info: 'INFO', warn: 'WARN', critical: 'CRITICAL' };
    const hex = '#' + new THREE.Color(col).getHexString();
    if (sprite.material.map) sprite.material.map.dispose();
    sprite.material.map = makeLabelTexture(labels[params.level] || 'ALERT', hex);
    sprite.material.needsUpdate = true;
  }
}

export function dispose() {
  if (sprite?.material?.map) sprite.material.map.dispose();
  if (root && sceneRef) removeAndDispose(sceneRef, root);
  root = light = ring = ring2 = ring3 = beacon = sprite = sceneRef = null;
  lastLevel = '';
}
