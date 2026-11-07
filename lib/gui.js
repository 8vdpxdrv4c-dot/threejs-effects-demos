/**
 * gui.js — Bind guiSchema → lil-gui (Chinese labels OK)
 * 将特效 guiSchema 绑定到 lil-gui 控件
 */
import GUI from 'lil-gui';

/**
 * @param {HTMLElement} host
 * @param {Array<{key:string,label:string,min?:number,max?:number,step?:number,options?:any,default:any}>} schema
 * @param {Record<string,any>} params  mutable params object
 * @param {(key:string, value:any) => void} [onChange]
 * @returns {GUI}
 */
export function bindGui(host, schema, params, onChange) {
  host.replaceChildren();
  const gui = new GUI({ container: host, title: '参数 Parameters' });

  for (const item of schema) {
    const { key, label, min, max, step, options } = item;
    if (!(key in params)) params[key] = item.default;

    let controller;
    const val = params[key];

    if (options != null) {
      controller = gui.add(params, key, options).name(label || key);
    } else if (typeof val === 'boolean') {
      controller = gui.add(params, key).name(label || key);
    } else if (typeof val === 'string' && /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(val)) {
      controller = gui.addColor(params, key).name(label || key);
    } else if (typeof val === 'number') {
      const lo = min ?? 0;
      const hi = max ?? 1;
      const st = step ?? (hi - lo) / 100;
      controller = gui.add(params, key, lo, hi, st).name(label || key);
    } else {
      controller = gui.add(params, key).name(label || key);
    }

    if (controller && onChange) {
      controller.onChange((v) => onChange(key, v));
    }
  }

  return gui;
}

/** Build default params object from schema */
export function defaultsFromSchema(schema) {
  const params = {};
  for (const item of schema) {
    params[item.key] = item.default;
  }
  return params;
}

export function destroyGui(gui) {
  if (gui) gui.destroy();
}
