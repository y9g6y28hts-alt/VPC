// Lot browser for the page: the surveyed plan, a block filter, a sortable list
// and a contextual lot sheet. Works without WebGL; the 3D tour and the
// inquiry form are reached from the sheet with the selected lot kept.
import { h } from './dom.js';
import { planSvg } from './plan-svg.js';
import { LOTS, findLot, BROCHURE_BLOCK } from '../data/viva-lago.js';
import { lotDetailRows, lotLabel } from '../core/format.js';

const BLOCKS = ['A', 'B', 'C', 'D', 'E'];
const area = (m2) => `${m2.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
const metres = (v) => v.toFixed(1).replace('.', ',');

/**
 * @param {HTMLElement} host
 * @param {{ onExplore: (id: string) => void, onInquire: (id: string) => void, reducedMotion?: boolean }} options
 */
export function mountLotBrowser(host, { onExplore, onInquire, reducedMotion = false }) {
  let selectedId = null;
  let block = null;
  let sortKey = 'id';

  // ------------------------------------------------------------- filter
  const filterButtons = [null, ...BLOCKS].map((b) => {
    const count = b ? LOTS.filter((l) => l.block === b).length : LOTS.length;
    const btn = h('button', { type: 'button', class: 'chip', 'aria-pressed': b === block ? 'true' : 'false', dataset: { block: b || '' } }, b ? `Manzana ${b}` : 'Todas', h('span', { class: 'chip__n' }, String(count)));
    btn.addEventListener('click', () => setBlock(b));
    return btn;
  });
  const filter = h('div', { class: 'lot-filter', role: 'group', 'aria-label': 'Filtrar por manzana' }, ...filterButtons);

  // --------------------------------------------------------------- plan
  // Phones get the plan turned upright (see planSvg's portrait mode).
  const portraitQuery = matchMedia('(max-width: 640px) and (orientation: portrait)');
  const makePlan = () => planSvg({ interactive: true, labels: true, portrait: portraitQuery.matches, onSelect: (id) => select(id, { from: 'plan' }) });
  let plan = makePlan();
  portraitQuery.addEventListener?.('change', () => {
    const next = makePlan();
    plan.replaceWith(next);
    plan = next;
    plan.setFilter(block);
    plan.setSelected(selectedId);
  });
  const planWrap = h('div', { class: 'lot-plan' }, plan, h('p', { class: 'lot-plan__legend' }, h('span', { class: 'key key--lot' }), 'Lote', h('span', { class: 'key key--sold' }), 'Vendido', h('span', { class: 'key key--common' }), 'Área común'));

  // -------------------------------------------------------------- sheet
  const sheet = h('aside', { class: 'lot-sheet', 'aria-live': 'polite', 'aria-label': 'Ficha del lote', tabindex: '-1' });
  function renderSheet() {
    const lot = selectedId ? findLot(selectedId) : null;
    if (!lot) {
      sheet.classList.remove('has-lot');
      sheet.replaceChildren(
        h('p', { class: 'eyebrow on-dark' }, 'Ficha del lote'),
        h('p', { class: 'lot-sheet__empty' }, 'Elegí un lote en el plano o en la lista.'),
        h('p', { class: 'small' }, `${LOTS.length} lotes de ${area(Math.min(...LOTS.map((l) => l.commercial.areaM2)))} a ${area(Math.max(...LOTS.map((l) => l.commercial.areaM2)))} de área propia.`),
      );
      return;
    }
    sheet.classList.add('has-lot');
    const rows = lotDetailRows(lot).filter((r) => r.key !== 'area');
    const explore = h('button', { class: 'btn btn--light', type: 'button' }, 'Ver la construcción en 3D', h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));
    explore.addEventListener('click', () => onExplore(lot.id));
    const inquire = h('button', { class: 'btn btn--ghost-light', type: 'button' }, 'Consultar por este lote');
    inquire.addEventListener('click', () => onInquire(lot.id));
    sheet.replaceChildren(
      h('p', { class: 'eyebrow on-dark' }, `${lotLabel(lot)} · ${lot.id}`),
      h('p', { class: 'lot-sheet__area' }, h('span', {}, area(lot.commercial.areaM2).replace(' m²', '')), h('span', { class: 'unit' }, 'm² de área propia')),
      h('dl', { class: 'facts facts--sheet' }, ...rows.map((r) => h('div', {}, h('dt', {}, r.label), h('dd', {}, r.pending ? h('span', { class: 'pending' }, r.value) : r.value)))),
      h('p', { class: 'small lot-sheet__ref' }, `La manzana ${lot.block} figura como manzana ${BROCHURE_BLOCK[lot.block]} en el folleto de Génesis.${lot.commercial.availabilitySource ? ` Estado según ${lot.commercial.availabilitySource.toLowerCase()}.` : ''}`),
      h('div', { class: 'lot-sheet__actions' }, explore, inquire),
    );
  }

  // --------------------------------------------------------------- list
  const sortSelect = h(
    'select',
    { class: 'lot-sort', 'aria-label': 'Ordenar la lista' },
    h('option', { value: 'id' }, 'Por manzana y número'),
    h('option', { value: 'area-desc' }, 'Mayor superficie primero'),
    h('option', { value: 'area-asc' }, 'Menor superficie primero'),
  );
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value;
    renderList();
  });
  const tbody = h('tbody');
  const table = h(
    'table',
    { class: 'lot-table' },
    h('caption', { class: 'visually-hidden' }, 'Lotes de Viva Lago Country con su superficie y medidas'),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Lote'), h('th', { scope: 'col' }, 'Área propia'), h('th', { scope: 'col', class: 'hide-s' }, 'Total con área común'), h('th', { scope: 'col', class: 'hide-s' }, 'Frente × fondo'), h('th', { scope: 'col' }, 'Estado'))),
    tbody,
  );
  const rowsById = new Map();
  // The full list is long: with no block chosen it opens folded.
  const COLLAPSED_ROWS = 8;
  let expanded = false;
  const more = h('button', { class: 'btn btn--ghost-light lot-list__more', type: 'button' });
  more.addEventListener('click', () => {
    expanded = !expanded;
    renderList();
    if (!expanded) table.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
  });
  function renderList() {
    const list = LOTS.filter((l) => !block || l.block === block).slice();
    if (sortKey === 'area-desc') list.sort((a, b) => b.commercial.areaM2 - a.commercial.areaM2);
    else if (sortKey === 'area-asc') list.sort((a, b) => a.commercial.areaM2 - b.commercial.areaM2);
    const folded = !block && !expanded && list.length > COLLAPSED_ROWS;
    // Keep the selected lot visible even while folded.
    const shown = folded ? list.filter((l, i) => i < COLLAPSED_ROWS || l.id === selectedId) : list;
    more.hidden = block || list.length <= COLLAPSED_ROWS;
    more.textContent = expanded ? 'Mostrar menos' : `Ver los ${list.length} lotes`;
    more.setAttribute('aria-expanded', String(expanded));
    rowsById.clear();
    tbody.replaceChildren(
      ...shown.map((lot) => {
        const sold = lot.commercial.availability === 'sold';
        const btn = h('button', { type: 'button', class: 'lot-row__btn', 'aria-pressed': lot.id === selectedId ? 'true' : 'false' }, h('strong', {}, lot.id), h('span', { class: 'lot-row__sub' }, lotLabel(lot)));
        btn.addEventListener('click', () => select(lot.id, { from: 'list' }));
        const tr = h(
          'tr',
          { class: `lot-row${lot.id === selectedId ? ' is-selected' : ''}${sold ? ' is-sold' : ''}` },
          h('th', { scope: 'row' }, btn),
          h('td', { class: 'num' }, area(lot.commercial.areaM2)),
          h('td', { class: 'num hide-s' }, area(lot.survey.totalAreaM2)),
          h('td', { class: 'num hide-s' }, `${metres(lot.frontage)} × ${metres(lot.depth)} m`),
          h('td', {}, sold ? h('span', { class: 'status status--sold' }, 'Vendido') : h('span', { class: 'status' }, 'Consultar')),
        );
        rowsById.set(lot.id, tr);
        return tr;
      }),
    );
  }
  const listHead = h('div', { class: 'lot-list__head' }, h('p', { class: 'lot-list__count', 'aria-live': 'polite' }), sortSelect);
  const list = h('div', { class: 'lot-list' }, listHead, h('div', { class: 'lot-table-wrap' }, table), more);

  // ------------------------------------------------------------- state
  function setBlock(b) {
    block = b;
    filterButtons.forEach((btn) => btn.setAttribute('aria-pressed', String((btn.dataset.block || null) === b)));
    plan.setFilter(b);
    const n = LOTS.filter((l) => !b || l.block === b).length;
    listHead.firstChild.textContent = b ? `${n} lotes en la manzana ${b}` : `${n} lotes`;
    renderList();
  }

  function select(id, { from } = {}) {
    if (!findLot(id)) return;
    selectedId = id;
    plan.setSelected(id);
    if (!rowsById.has(id)) renderList();
    for (const [lotId, tr] of rowsById) {
      tr.classList.toggle('is-selected', lotId === id);
      tr.querySelector('button').setAttribute('aria-pressed', String(lotId === id));
    }
    renderSheet();
    // On narrow screens the sheet sits below the plan: bring it into view.
    if (from && matchMedia('(max-width: 900px)').matches) {
      sheet.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'nearest' });
    }
    if (from === 'list') sheet.focus({ preventScroll: true });
  }

  host.replaceChildren(filter, h('div', { class: 'lot-browser__grid' }, planWrap, sheet), list);
  setBlock(null);
  renderSheet();
  return { select, setBlock, element: host };
}
