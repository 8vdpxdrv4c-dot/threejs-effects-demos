/**
 * main.js — Gallery bootstrap: sidebar, effect switching, GUI, dispose previous
 * 画廊入口：侧边栏、切换特效、参数面板、完整释放上一特效
 */
import * as THREE from 'three';
import { createBase, addDefaultLights, resizeRendererToDisplaySize, startLoop } from './lib/setup.js';
import { clearSceneChildren, disposeComposer } from './lib/dispose.js';
import { bindGui, defaultsFromSchema, destroyGui } from './lib/gui.js';
import { effects, categories } from './effects/index.js';

const canvas = document.getElementById('c');
const nav = document.getElementById('effect-nav');
const guiHost = document.getElementById('gui-host');
const titleEl = document.getElementById('effect-title');
const hintEl = document.getElementById('effect-hint');
const modulePathEl = document.getElementById('module-path');
const codePanel = document.getElementById('code-panel');
const btnCopy = document.getElementById('btn-copy-path');

const { renderer, scene, camera, clock } = createBase(canvas);
addDefaultLights(scene);

let current = null; // { mod, params, gui, root? }
let composer = null;
let stopLoop = null;

const KEEP = ['__default_hemi', '__default_key', '__default_fill', '__default_rim', '__default_ground', '__default_grid'];

/** 中文分类标签 */
const CAT_LABELS = {
  particles: '粒子 Particles',
  'fluid-gas': '流体 / 气体 Fluid-Gas',
  shaders: '着色器 Shaders',
  postprocessing: '后处理 Post',
  lighting: '光照 Lighting',
  terrain: '地形草地 Terrain',
  'motion-arrows': '运动箭头 Motion',
  'pipe-flow': '管道流 Pipe',
  alerts: '告警 Alerts',
  skillshot: '技能射击 Skillshot',
};

function buildNav() {
  const byCat = new Map();
  for (const e of effects) {
    if (!byCat.has(e.category)) byCat.set(e.category, []);
    byCat.get(e.category).push(e);
  }
  // Prefer declared category order
  const order = categories.length ? categories : [...byCat.keys()];
  nav.replaceChildren();
  for (const cat of order) {
    const list = byCat.get(cat);
    if (!list || !list.length) continue;
    const section = document.createElement('div');
    section.className = 'cat';
    const h = document.createElement('div');
    h.className = 'cat-title';
    h.textContent = CAT_LABELS[cat] || cat;
    section.appendChild(h);
    const ul = document.createElement('ul');
    for (const e of list) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = e.title;
      btn.dataset.id = e.id;
      btn.addEventListener('click', () => selectEffect(e.id));
      li.appendChild(btn);
      ul.appendChild(li);
    }
    section.appendChild(ul);
    nav.appendChild(section);
  }
}

function setActiveNav(id) {
  nav.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.id === id);
  });
}

async function disposeCurrent() {
  if (!current) return;
  try {
    if (current.mod && typeof current.mod.dispose === 'function') {
      current.mod.dispose();
    }
  } catch (err) {
    console.warn('effect.dispose error', err);
  }
  destroyGui(current.gui);
  clearSceneChildren(scene, { keepNames: KEEP });
  if (composer) {
    disposeComposer(composer);
    composer = null;
  }
  // reset camera defaults
  camera.position.set(0, 3.5, 8);
  camera.lookAt(0, 1, 0);
  camera.near = 0.1;
  camera.far = 200;
  camera.updateProjectionMatrix();
  renderer.toneMappingExposure = 1.05;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  current = null;
}

async function selectEffect(id) {
  const mod = effects.find((e) => e.id === id);
  if (!mod) return;

  await disposeCurrent();
  setActiveNav(id);

  const params = defaultsFromSchema(mod.guiSchema);
  titleEl.textContent = mod.title;
  hintEl.textContent = `分类: ${CAT_LABELS[mod.category] || mod.category} · id=${mod.id}`;
  modulePathEl.textContent = `effects/${mod.id}.js`;
  codePanel.hidden = false;

  const ctx = { scene, camera, renderer, clock, composer: null, setComposer };
  function setComposer(c) {
    composer = c;
    ctx.composer = c;
  }

  try {
    mod.create(ctx, params);
  } catch (err) {
    console.error('create failed', err);
    hintEl.textContent = `创建失败: ${err.message}`;
  }

  const gui = bindGui(guiHost, mod.guiSchema, params, () => {
    // live params mutated in place; update() reads them each frame
  });

  current = { mod, params, gui };
}

btnCopy?.addEventListener('click', async () => {
  const t = modulePathEl.textContent || '';
  try {
    await navigator.clipboard.writeText(t);
    btnCopy.textContent = '已复制';
    setTimeout(() => { btnCopy.textContent = '复制路径'; }, 1200);
  } catch {
    btnCopy.textContent = '复制失败';
  }
});

// Animate
stopLoop = startLoop(clock, (dt) => {
  resizeRendererToDisplaySize(renderer, camera, canvas);
  if (current?.mod?.update) {
    try {
      current.mod.update(dt, current.params, {
        scene, camera, renderer, clock, composer,
      });
    } catch (err) {
      console.warn('update error', err);
    }
  }
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
});

window.addEventListener('resize', () => {
  resizeRendererToDisplaySize(renderer, camera, canvas);
  if (composer && composer.setSize) {
    composer.setSize(canvas.clientWidth, canvas.clientHeight);
  }
});

buildNav();
// Auto-select first effect
if (effects.length) {
  selectEffect(effects[0].id);
}

export { scene, camera, renderer };
