// 2D plan of the illustrative layout, drawn from the same data as the 3D scene.
// Used as a figure on the page and as the accessible, WebGL-free lot picker.
import { h } from './dom.js';
import { LOTS, lakeRoad, boulevard, lakePolygon, ROAD } from '../data/viva-lago.js';
import { lotLabel } from '../core/format.js';

const VIEW = { minX: -270, minZ: -150, maxX: 270, maxZ: 300 };

const pts = (list) => list.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(' ');

/**
 * @param {{ interactive?: boolean, selectedId?: string|null, onSelect?: (id: string) => void, labels?: boolean }} options
 */
export function planSvg({ interactive = false, selectedId = null, onSelect, labels = false } = {}) {
  const svg = h('svg:svg', {
    class: 'plan-svg',
    viewBox: `${VIEW.minX} ${VIEW.minZ} ${VIEW.maxX - VIEW.minX} ${VIEW.maxZ - VIEW.minZ}`,
    role: interactive ? 'group' : 'img',
    'aria-label': interactive ? 'Plano ilustrativo: elegí un lote' : 'Plano ilustrativo del desarrollo (no oficial)',
  });
  svg.append(h('svg:polygon', { class: 'lake', points: pts(lakePolygon()) }));
  const line = (path, width) => h('svg:polyline', { class: 'road', points: pts(path.points.filter((_, i) => i % 8 === 0).concat([path.pointAt(path.length)])), 'stroke-width': width });
  svg.append(line(lakeRoad, ROAD.laneWidth), line(boulevard, ROAD.boulevardHalfWidth * 2));

  const nodes = new Map();
  for (const lot of LOTS) {
    const poly = h('svg:polygon', {
      class: `lot${lot.id === selectedId ? ' is-selected' : ''}`,
      points: pts(lot.polygon),
      ...(interactive
        ? {
            tabindex: '0',
            role: 'button',
            'aria-label': `${lotLabel(lot)} (numeración ilustrativa)`,
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
    poly.append(h('svg:title', {}, `${lotLabel(lot)} · ilustrativo`));
    nodes.set(lot.id, poly);
    svg.append(poly);
    if (labels) {
      svg.append(h('svg:text', { class: 'label', x: lot.centroid.x.toFixed(1), y: (lot.centroid.z + 2).toFixed(1), 'text-anchor': 'middle' }, lot.id));
    }
  }

  svg.setSelected = (id) => {
    for (const [lotId, node] of nodes) {
      node.classList.toggle('is-selected', lotId === id);
      if (interactive) node.setAttribute('aria-pressed', lotId === id ? 'true' : 'false');
    }
  };
  return svg;
}
