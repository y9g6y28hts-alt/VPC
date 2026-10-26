// 2D plan of the surveyed subdivision, drawn from the same data as the 3D scene.
// Used as a figure on the page and as the accessible, WebGL-free lot picker.
import { h } from './dom.js';
import { LOTS, ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, COMMON_AREAS, SITE, lakePolygon } from '../data/viva-lago.js';
import { lotLabel } from '../core/format.js';

// Local metres, north up (+z is south). Framed on the title boundary and the river.
const VIEW = { minX: -140, minZ: -78, maxX: 186, maxZ: 80 };
// Portrait (phones): the plan turned a quarter, east down and north to the
// right, so the long site fills the screen height and lots stay tappable.
const PORTRAIT = { transform: 'rotate(90)', viewBox: `${-VIEW.maxZ} ${VIEW.minX} ${VIEW.maxZ - VIEW.minZ} ${VIEW.maxX - VIEW.minX}` };

const pts = (list) => list.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');

/**
 * @param {{ interactive?: boolean, selectedId?: string|null, onSelect?: (id: string) => void, labels?: boolean, portrait?: boolean }} options
 */
export function planSvg({ interactive = false, selectedId = null, onSelect, labels = false, portrait = false } = {}) {
  const root = h('svg:svg', {
    class: `plan-svg${portrait ? ' plan-svg--portrait' : ''}`,
    viewBox: portrait ? PORTRAIT.viewBox : `${VIEW.minX} ${VIEW.minZ} ${VIEW.maxX - VIEW.minX} ${VIEW.maxZ - VIEW.minZ}`,
    role: interactive ? 'group' : 'img',
    'aria-label': interactive ? 'Plano de loteamiento: elegí un lote' : 'Plano de loteamiento de Viva Lago Country',
  });
  // Everything is drawn in plan coordinates inside one group; text is turned
  // back upright when the group is rotated.
  const svg = h('svg:g', portrait ? { transform: PORTRAIT.transform } : {});
  root.append(svg);
  const upright = (x, y) => (portrait ? { transform: `rotate(-90 ${x} ${y})` } : {});
  svg.append(h('svg:polygon', { class: 'lake', points: pts(lakePolygon()) }));
  svg.append(h('svg:polygon', { class: 'site', points: pts(SITE) }));
  svg.append(h('svg:polygon', { class: 'road-area', points: pts(ROADS) }));
  svg.append(h('svg:polygon', { class: 'road-area', points: pts(NAUTICAL_ACCESS) }));
  if (ENTRANCE_PAD.length) svg.append(h('svg:polygon', { class: 'road-area', points: pts(ENTRANCE_PAD) }));
  for (const c of COMMON_AREAS) {
    svg.append(h('svg:polygon', { class: 'common', points: pts(c.polygon) }, h('svg:title', {}, `${c.name} · ${c.areaM2.toLocaleString('es-PY')} m²`)));
    if (labels) svg.append(h('svg:text', { class: 'label label--common', x: c.centroid.x.toFixed(1), y: (c.centroid.z + 1).toFixed(1), 'text-anchor': 'middle', ...upright(c.centroid.x.toFixed(1), c.centroid.z.toFixed(1)) }, c.id === 'club' ? 'CLUB NÁUTICO' : 'ADM.'));
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
      svg.append(h('svg:text', { class: 'label', x: lot.centroid.x.toFixed(1), y: (lot.centroid.z + 1.1).toFixed(1), 'text-anchor': 'middle', ...upright(lot.centroid.x.toFixed(1), lot.centroid.z.toFixed(1)) }, String(lot.number).padStart(2, '0')));
    }
  }
  if (labels) {
    // Block names sit outside the boundary, next to their lots.
    const place = portrait
      ? { A: { x: -112, z: -64 }, B: { x: 0, z: -54 }, C: { x: 112, z: -40 }, D: { x: 96, z: 66 }, E: { x: -10, z: 56 } }
      : { A: { x: -112, z: -60 }, B: { x: 0, z: -48 }, C: { x: 112, z: -37 }, D: { x: 96, z: 62 }, E: { x: -10, z: 50 } };
    for (const block of ['A', 'B', 'C', 'D', 'E']) {
      const { x, z } = place[block];
      svg.append(h('svg:text', { class: 'label label--block', x, y: z, 'text-anchor': 'middle', ...(portrait ? { transform: `rotate(-90 ${x} ${z})`, 'dominant-baseline': 'middle' } : {}) }, portrait ? `MZ. ${block}` : `MANZANA ${block}`));
    }
    svg.append(h('svg:text', { class: 'label label--river', x: '150', y: '-30', 'text-anchor': 'middle', transform: portrait ? 'rotate(-130 150 -30)' : 'rotate(48 150 -30)' }, 'RÍO ACARAY'));
    // North arrow (points right when the plan is turned).
    svg.append(
      h('svg:g', { class: 'plan-north', transform: 'translate(-128 62)', 'aria-hidden': 'true' },
        h('svg:path', { d: 'M0 -7 L2.6 3 L0 1.4 L-2.6 3 Z' }),
        h('svg:text', { x: 0, y: -9.5, 'text-anchor': 'middle', ...(portrait ? { transform: 'rotate(-90 0 -9.5)', 'dominant-baseline': 'middle' } : {}) }, 'N'),
      ),
    );
  }

  /** Dims lots outside a block ('A'…'E'); null shows all. */
  root.setFilter = (block) => {
    for (const lot of LOTS) nodes.get(lot.id).classList.toggle('is-dim', Boolean(block) && lot.block !== block);
  };

  root.setSelected = (id) => {
    for (const [lotId, node] of nodes) {
      node.classList.toggle('is-selected', lotId === id);
      if (interactive) node.setAttribute('aria-pressed', lotId === id ? 'true' : 'false');
    }
  };
  return root;
}
