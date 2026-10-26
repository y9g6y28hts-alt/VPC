// Small cartographic figures drawn from the surveyed data: the site in its
// surroundings (location section) and key plans that highlight one common
// area at a time (common-areas section). Same geometry as the 3D scene.
import { h } from './dom.js';
import { LOTS, ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, COMMON_AREAS, SITE, OUTSIDE_STREETS, lakePolygon } from '../data/viva-lago.js';

const pts = (list) => list.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');
const line = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.z.toFixed(1)}`).join(' ');

/** North arrow at (x, z), size in metres. */
function northArrow(x, z, size) {
  return h(
    'svg:g',
    { class: 'map-north', transform: `translate(${x} ${z})`, 'aria-hidden': 'true' },
    h('svg:path', { d: `M0 ${-size} L${size * 0.32} ${size * 0.35} L0 ${size * 0.12} L${-size * 0.32} ${size * 0.35} Z` }),
    h('svg:text', { x: 0, y: -size * 1.25, 'text-anchor': 'middle' }, 'N'),
  );
}

/** Scale bar of `metres` at (x, z): alternating segments, labelled. */
function scaleBar(x, z, metres, segments = 4) {
  const g = h('svg:g', { class: 'map-scale', transform: `translate(${x} ${z})`, 'aria-hidden': 'true' });
  const w = metres / segments;
  for (let i = 0; i < segments; i++) g.append(h('svg:rect', { x: i * w, y: 0, width: w, height: metres * 0.03, class: i % 2 ? 'b' : 'a' }));
  g.append(h('svg:text', { x: 0, y: -metres * 0.04 }, '0'), h('svg:text', { x: metres, y: -metres * 0.04, 'text-anchor': 'end' }, `${metres} m`));
  return g;
}

/** The site in its surroundings: water, riverbank, public streets, title boundary. */
export function locationSvg() {
  const view = { minX: -330, minZ: -230, w: 680, h: 420 };
  const svg = h('svg:svg', {
    class: 'site-map site-map--location',
    viewBox: `${view.minX} ${view.minZ} ${view.w} ${view.h}`,
    role: 'img',
    'aria-label': 'Croquis de ubicación: el predio de Viva Lago Country junto a la margen del río Acaray, con calles públicas al sur y al oeste.',
  });
  svg.append(h('svg:rect', { class: 'map-land', x: view.minX, y: view.minZ, width: view.w, height: view.h }));
  svg.append(h('svg:polygon', { class: 'map-water', points: pts(lakePolygon()) }));
  for (const s of OUTSIDE_STREETS) svg.append(h('svg:path', { class: 'map-street', d: line(s.points), 'stroke-width': s.width }));
  svg.append(h('svg:polygon', { class: 'map-site', points: pts(SITE) }));
  svg.append(h('svg:polygon', { class: 'map-roads', points: pts(ROADS) }));
  svg.append(h('svg:text', { class: 'map-label map-label--site', x: 10, y: -66, 'text-anchor': 'middle' }, 'VIVA LAGO COUNTRY'));
  svg.append(h('svg:text', { class: 'map-label map-label--water', x: 250, y: -120, 'text-anchor': 'middle' }, 'RÍO ACARAY'));
  svg.append(h('svg:circle', { class: 'map-pin', cx: 0, cy: 0, r: 4.5 }));
  svg.append(northArrow(view.minX + view.w - 34, view.minZ + 46, 16));
  svg.append(scaleBar(view.minX + 24, view.minZ + view.h - 24, 100));
  return svg;
}

const COMMON_HIGHLIGHT = {
  club: () => COMMON_AREAS.find((c) => c.id === 'club')?.polygon,
  administracion: () => COMMON_AREAS.find((c) => c.id === 'administracion')?.polygon,
  nautico: () => NAUTICAL_ACCESS,
  calles: () => ROADS,
};

/** Key plan of the whole subdivision with one area highlighted. */
export function keyPlanSvg(highlight, label) {
  const svg = h('svg:svg', { class: 'site-map site-map--key', viewBox: '-136 -62 308 128', role: 'img', 'aria-label': label });
  svg.append(h('svg:polygon', { class: 'key-site', points: pts(SITE) }));
  for (const lot of LOTS) svg.append(h('svg:polygon', { class: 'key-lot', points: pts(lot.polygon) }));
  svg.append(h('svg:polygon', { class: 'key-road', points: pts(ROADS) }));
  svg.append(h('svg:polygon', { class: 'key-road', points: pts(NAUTICAL_ACCESS) }));
  if (ENTRANCE_PAD.length) svg.append(h('svg:polygon', { class: 'key-road', points: pts(ENTRANCE_PAD) }));
  for (const c of COMMON_AREAS) svg.append(h('svg:polygon', { class: 'key-lot', points: pts(c.polygon) }));
  const poly = COMMON_HIGHLIGHT[highlight]?.();
  if (poly) svg.append(h('svg:polygon', { class: 'key-hl', points: pts(poly) }));
  return svg;
}
