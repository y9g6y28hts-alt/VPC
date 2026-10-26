// 2D plan of the surveyed subdivision, drawn from the same data as the 3D scene.
// Used as a figure on the page and as the accessible, WebGL-free lot picker.
import { h } from './dom.js';
import { LOTS, ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, COMMON_AREAS, SITE, lakePolygon } from '../data/viva-lago.js';
import { lotLabel } from '../core/format.js';

// Local metres, north up (+z is south). Framed on the title boundary and the river.
const VIEW = { minX: -140, minZ: -78, maxX: 186, maxZ: 80 };

const pts = (list) => list.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');

/**
 * @param {{ interactive?: boolean, selectedId?: string|null, onSelect?: (id: string) => void, labels?: boolean }} options
 */
export function planSvg({ interactive = false, selectedId = null, onSelect, labels = false } = {}) {
  const svg = h('svg:svg', {
    class: 'plan-svg',
    viewBox: `${VIEW.minX} ${VIEW.minZ} ${VIEW.maxX - VIEW.minX} ${VIEW.maxZ - VIEW.minZ}`,
    role: interactive ? 'group' : 'img',
    'aria-label': interactive ? 'Plano de loteamiento: elegí un lote' : 'Plano de loteamiento de Viva Lago Country',
  });
  svg.append(h('svg:polygon', { class: 'lake', points: pts(lakePolygon()) }));
  svg.append(h('svg:polygon', { class: 'site', points: pts(SITE) }));
  svg.append(h('svg:polygon', { class: 'road-area', points: pts(ROADS) }));
  svg.append(h('svg:polygon', { class: 'road-area', points: pts(NAUTICAL_ACCESS) }));
  if (ENTRANCE_PAD.length) svg.append(h('svg:polygon', { class: 'road-area', points: pts(ENTRANCE_PAD) }));
  for (const c of COMMON_AREAS) {
    svg.append(h('svg:polygon', { class: 'common', points: pts(c.polygon) }, h('svg:title', {}, `${c.name} · ${c.areaM2.toLocaleString('es-PY')} m²`)));
    if (labels) svg.append(h('svg:text', { class: 'label label--common', x: c.centroid.x.toFixed(1), y: (c.centroid.z + 1).toFixed(1), 'text-anchor': 'middle' }, c.id === 'club' ? 'CLUB NÁUTICO' : 'ADM.'));
  }

  const nodes = new Map();
  for (const lot of LOTS) {
    const poly = h('svg:polygon', {
      class: `lot${lot.id === selectedId ? ' is-selected' : ''}${lot.commercial.availability === 'sold' ? ' is-sold' : ''}`,
      points: pts(lot.polygon),
      ...(interactive
        ? {
            tabindex: '0',
            role: 'button',
            'aria-label': `${lotLabel(lot)}, ${lot.commercial.areaM2.toLocaleString('es-PY')} m²${lot.commercial.availability === 'sold' ? ', vendido' : ''}`,
            'aria-pressed': lot.id === selectedId ? 'true' : 'false',
            onclick: () => onSelect?.(lot.id),
            onkeydown: (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect?.(lot.id);
              }
            },
          }
        : {}),
    });
    poly.append(h('svg:title', {}, `${lotLabel(lot)} · ${lot.commercial.areaM2.toLocaleString('es-PY')} m²`));
    nodes.set(lot.id, poly);
    svg.append(poly);
    if (labels) {
      svg.append(h('svg:text', { class: 'label', x: lot.centroid.x.toFixed(1), y: (lot.centroid.z + 1.1).toFixed(1), 'text-anchor': 'middle' }, String(lot.number).padStart(2, '0')));
    }
  }
  if (labels) {
    // Block names sit outside the boundary, next to their lots.
    const place = { A: { x: -112, z: -60 }, B: { x: 0, z: -48 }, C: { x: 112, z: -37 }, D: { x: 96, z: 62 }, E: { x: -10, z: 50 } };
    for (const block of ['A', 'B', 'C', 'D', 'E']) {
      svg.append(h('svg:text', { class: 'label label--block', x: place[block].x, y: place[block].z, 'text-anchor': 'middle' }, `MANZANA ${block}`));
    }
    svg.append(h('svg:text', { class: 'label label--river', x: '150', y: '-30', 'text-anchor': 'middle', transform: 'rotate(48 150 -30)' }, 'RÍO ACARAY'));
  }

  svg.setSelected = (id) => {
    for (const [lotId, node] of nodes) {
      node.classList.toggle('is-selected', lotId === id);
      if (interactive) node.setAttribute('aria-pressed', lotId === id ? 'true' : 'false');
    }
  };
  return svg;
}
