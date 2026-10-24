// Minimal DOM construction helpers (no framework).

/**
 * h('button', { class: 'btn', onclick: fn, 'aria-label': 'x' }, 'Texto', child)
 * Attributes starting with "on" become listeners; `dataset` and `style` objects are merged.
 */
export function h(tag, attrs = {}, ...children) {
  const el = tag.includes(':') ? document.createElementNS('http://www.w3.org/2000/svg', tag.split(':')[1]) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const svgIcon = {
  close: () => h('svg:svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, h('svg:path', { d: 'M1 1l12 12M13 1L1 13', stroke: 'currentColor', 'stroke-width': '1.4', fill: 'none' })),
  pause: () => h('svg:svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, h('svg:path', { d: 'M4 2v10M10 2v10', stroke: 'currentColor', 'stroke-width': '1.6', fill: 'none' })),
  play: () => h('svg:svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, h('svg:path', { d: 'M3.5 2l8 5-8 5z', fill: 'currentColor' })),
  replay: () =>
    h('svg:svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, h('svg:path', { d: 'M2.5 7a4.5 4.5 0 1 0 1.4-3.3M2.5 1.5v2.8h2.8', stroke: 'currentColor', 'stroke-width': '1.4', fill: 'none' })),
  skip: () => h('svg:svg', { viewBox: '0 0 14 14', 'aria-hidden': 'true' }, h('svg:path', { d: 'M2 2l6 5-6 5zM10.5 2v10', stroke: 'currentColor', 'stroke-width': '1.4', fill: 'none' })),
};

export const prefersReducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
