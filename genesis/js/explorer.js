// Explorer overlay: hosts the 3D experience and its quiet, state-driven UI.
//   overview  → "Elegí un lote" panel and lot list
//   approach  → only the lot name
//   building  → stage, progress, pause / replay / finish
//   complete  → lot panel (verified data only), views, inquiry
// If WebGL or the scene fails, a 2D plan with the same lots and actions is shown.
import { h, svgIcon, prefersReducedMotion } from './ui/dom.js';
import { planSvg } from './ui/plan-svg.js';
import { mountInquiryForm } from './ui/inquiry-form.js';
import { BRAND } from './config/brand.js';
import { DEVELOPMENT, CONCEPT_RESIDENCE, LOTS, findLot } from './data/viva-lago.js';
import { CONSTRUCTION_STAGES } from './core/timeline.js';
import { lotDetailRows, lotLabel, formatArea } from './core/format.js';
import { Cinema, loadCinemaManifest, filmFor } from './ui/cinema.js';
import { track } from './core/track.js';

const root = () => document.getElementById('explorer');
let ui = null;
let xp = null;
let opening = null;
let lastFocus = null;
let heroManifest = null;

export function setHeroManifest(m) {
  heroManifest = m;
}

function brandMark() {
  if (BRAND.logo.wordmarkMono) return h('img', { class: 'brand__logo', src: BRAND.logo.wordmarkMono, alt: BRAND.legalName });
  return h('span', { class: 'brand__name' }, BRAND.name);
}

const cinema = new Cinema({ reducedMotion: prefersReducedMotion() });
let currentFilm = null;
let coverTimer = 0;

/** Shows the path-traced film over the scene (or hands back the 3D view). */
function setFilmVisible(on) {
  if (!currentFilm) on = false;
  cinema.show(on);
  ui.viewToggle.setAttribute('aria-pressed', String(on));
  ui.viewToggle.textContent = on ? 'Vista 3D interactiva' : 'Vista cinematográfica';
  clearTimeout(coverTimer);
  if (on) {
    cinema.setProgress(xp?.progress ?? 1);
    // Stop drawing the scene once the film has faded in over it.
    coverTimer = setTimeout(() => xp?.setCovered(true), prefersReducedMotion() ? 0 : 1200);
  } else {
    xp?.setCovered(false);
  }
}

async function prepareFilm(lot) {
  const manifest = await loadCinemaManifest();
  const match = filmFor(manifest, lot, findLot);
  currentFilm = null;
  ui.viewToggle.hidden = true;
  if (!match || !xp) {
    xp?.setFilmShot(null);
    return;
  }
  const { film, exact } = match;
  const portrait = innerWidth / Math.max(1, innerHeight) < 0.85 && film.mobile;
  // Only the film's own lot gets the matched framing (seamless hand-over).
  xp.setFilmShot(exact ? (portrait ? film.shots.mobile : film.shots.desktop) : null);
  try {
    await cinema.load(film, { exact });
    if (xp?.lot?.id !== lot.id) return;
    currentFilm = film;
    ui.viewToggle.hidden = false;
    // Already arrived (fast flight or cached film): hand over now.
    if (['building', 'complete'].includes(xp.state)) setFilmVisible(true);
  } catch {
    xp?.setFilmShot(null);
  }
}

function buildUI() {
  const el = root();
  const stage = h('div', { class: 'explorer__stage' });

  const lotLabelEl = h('span', { class: 'xp-bar__lot', 'aria-live': 'polite' });
  const disclosure = h(
    'div',
    { class: 'xp-disclosure', hidden: true, id: 'xp-disclosure' },
    h('p', {}, h('strong', {}, 'Plano georreferenciado. '), `Lotes, calles, numeración y superficies provienen del ${DEVELOPMENT.planSource}. La vegetación, el entorno y el relieve son una recreación.`),
    h('p', {}, 'La residencia es un concepto arquitectónico, ajustado a las medidas de cada lote, para visualizar el potencial del terreno. No está aprobada para construcción ni incluida en el precio del lote.'),
    h('p', {}, 'Las personas, vehículos y embarcaciones que se ven en la escena son ilustrativos: muestran usos posibles del entorno, no servicios ni equipamientos confirmados.'),
    h('p', {}, 'Precios, disponibilidad y financiación se informan únicamente a través de un asesor de Génesis.'),
  );
  const disclosureBtn = h('button', { class: 'xp-chip', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'xp-disclosure' }, 'Sobre esta escena');
  disclosureBtn.addEventListener('click', () => {
    const open = disclosure.hidden;
    disclosure.hidden = !open;
    disclosureBtn.setAttribute('aria-expanded', String(open));
  });
  const closeBtn = h('button', { class: 'xp-close', type: 'button', 'aria-label': 'Salir de la experiencia' }, svgIcon.close());
  // Film ⇄ interactive 3D, offered only while a lot's film is available.
  const viewToggle = h('button', { class: 'xp-chip xp-view-toggle', type: 'button', hidden: true, 'aria-pressed': 'true' }, 'Vista 3D interactiva');
  viewToggle.addEventListener('click', () => setFilmVisible(!cinema.visible));
  closeBtn.addEventListener('click', () => closeExplorer());

  const bar = h(
    'div',
    { class: 'xp-bar' },
    h('div', { class: 'xp-bar__title' }, brandMark(), h('span', { class: 'sep', 'aria-hidden': 'true', style: { opacity: 0.4 } }, '/'), h('span', { class: 'xp-bar__project' }, DEVELOPMENT.name), lotLabelEl),
    h('div', { class: 'xp-bar__actions' }, viewToggle, disclosureBtn, closeBtn),
  );

  // Loading
  const loadBar = h('i');
  const loadPct = h('span', {}, '0%');
  const loadLabel = h('span', {}, 'Preparando');
  const loading = h(
    'div',
    { class: 'xp-loading', role: 'status' },
    h('div', { class: 'xp-loading__inner' }, h('img', { class: 'xp-loading__logo', src: BRAND.development.logoMono, alt: '' }), h('p', { class: 'xp-loading__title' }, 'Preparando Viva Lago Country'), h('div', { class: 'xp-loading__bar' }, loadBar), h('div', { class: 'xp-loading__meta' }, loadLabel, loadPct)),
  );

  // Overview panel
  const lotSelect = h(
    'select',
    { id: 'xp-lot-select', 'aria-label': 'Elegir un lote de la lista' },
    h('option', { value: '' }, 'Elegir de la lista…'),
    ...['A', 'B', 'C', 'D', 'E'].map((b) => h('optgroup', { label: `Manzana ${b}` }, ...LOTS.filter((l) => l.block === b).map((l) => h('option', { value: l.id }, `${lotLabel(l)} · ${formatArea(l.commercial.areaM2)}${l.commercial.availability === 'sold' ? ' · vendido' : ''}`)))),
  );
  lotSelect.addEventListener('change', () => {
    if (lotSelect.value) selectLot(lotSelect.value);
    lotSelect.value = '';
  });
  // Closer looks from the overview: the club, the river, the entrance.
  const PLACE_LABELS = [
    ['club', 'Club náutico'],
    ['rio', 'Río y pesca'],
    ['portal', 'Portal de acceso'],
  ];
  const placeBtns = PLACE_LABELS.map(([key, label]) => {
    const b = h('button', { class: 'xp-chip xp-place', type: 'button', 'aria-pressed': 'false', dataset: { place: key } }, label);
    b.addEventListener('click', () => {
      const here = b.getAttribute('aria-pressed') === 'true';
      if (xp?.place(here ? 'overview' : key)) setPlace(here ? null : key);
    });
    return b;
  });
  const backBtn = h('button', { class: 'xp-chip xp-place-back', type: 'button', hidden: true }, 'Vista general');
  backBtn.addEventListener('click', () => xp?.place('overview') && setPlace(null));
  function setPlace(key) {
    placeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.place === key)));
    backBtn.hidden = !key;
  }
  const placeRow = h('div', { class: 'xp-places', role: 'group', 'aria-label': 'Lugares' }, ...placeBtns, backBtn);
  const overview = h(
    'section',
    { class: 'xp-panel xp-overview', 'aria-label': 'Elegir un lote' },
    h('p', { class: 'eyebrow' }, DEVELOPMENT.name),
    h('h2', {}, 'Elegí un lote'),
    h('p', {}, 'Tocá una parcela para ver cómo podría construirse una residencia en ella. Podés recorrer la escena arrastrando y acercarte con la rueda o con dos dedos.'),
    h('div', { class: 'field' }, lotSelect),
    h('p', { class: 'note' }, `${LOTS.length} lotes · numeración del plano georreferenciado.`),
    placeRow,
  );

  // Construction controls
  const stageName = h('span', { class: 'xp-build__stage', 'aria-live': 'polite' }, CONSTRUCTION_STAGES[0].label);
  const stageCount = h('span', { class: 'xp-build__count' }, `01 / ${String(CONSTRUCTION_STAGES.length).padStart(2, '0')}`);
  const segments = CONSTRUCTION_STAGES.map((s, i) => {
    const b = h('button', { type: 'button', 'aria-label': `Ir a la etapa ${i + 1}: ${s.label}` }, h('i'));
    b.addEventListener('click', () => xp?.seekStage(i));
    return b;
  });
  const pauseBtn = h('button', { class: 'icon-btn', type: 'button' });
  const setPauseIcon = (paused) => {
    pauseBtn.setAttribute('aria-label', paused ? 'Reanudar' : 'Pausar');
    pauseBtn.replaceChildren(paused ? svgIcon.play() : svgIcon.pause(), h('span', { class: 'label-text', 'aria-hidden': 'true' }, paused ? 'Reanudar' : 'Pausar'));
  };
  setPauseIcon(false);
  pauseBtn.addEventListener('click', () => xp?.togglePause());
  const replayBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Repetir' }, svgIcon.replay(), h('span', { class: 'label-text', 'aria-hidden': 'true' }, 'Repetir'));
  replayBtn.addEventListener('click', () => xp?.replay());
  const skipBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ver terminada' }, svgIcon.skip(), h('span', { class: 'label-text', 'aria-hidden': 'true' }, 'Ver terminada'));
  skipBtn.addEventListener('click', () => xp?.skip());
  const backBtnBuild = h('button', { class: 'icon-btn', type: 'button' }, h('span', {}, 'Volver al desarrollo'));
  backBtnBuild.addEventListener('click', () => xp?.exit());
  const build = h(
    'section',
    { class: 'xp-build', 'aria-label': 'Construcción' },
    h('div', { class: 'xp-build__head' }, stageName, stageCount),
    h('div', { class: 'xp-track', role: 'group', 'aria-label': 'Etapas de construcción' }, ...segments),
    h('div', { class: 'xp-build__controls' }, h('div', { class: 'group' }, pauseBtn, replayBtn), h('div', { class: 'group' }, skipBtn, backBtnBuild)),
  );

  // Details panel
  const detailsLot = h('p', { class: 'eyebrow' });
  const detailsRows = h('dl', { class: 'facts' });
  const viewButtons = [
    ['front', 'Frente'],
    ['garden', 'Jardín'],
    ['aerial', 'Aérea'],
  ].map(([key, label]) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false', dataset: { view: key } }, label);
    b.addEventListener('click', () => {
      // Camera views belong to the live scene: hand it back from the film.
      setFilmVisible(false);
      if (xp?.view(key)) viewButtons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    return b;
  });
  const inquireBtn = h('button', { class: 'btn', type: 'button' }, 'Consultar por este lote', h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));
  inquireBtn.addEventListener('click', () => openSheet());
  const replay2 = h('button', { class: 'btn btn--text', type: 'button', dataset: { action: 'replay' } }, 'Repetir construcción');
  replay2.addEventListener('click', () => xp?.replay());
  const back2 = h('button', { class: 'btn btn--text', type: 'button' }, 'Volver al desarrollo');
  back2.addEventListener('click', () => (xp ? xp.exit() : showFallbackOverview()));
  const sheetToggle = h('button', { class: 'sheet-toggle', type: 'button', 'aria-label': 'Mostrar u ocultar detalles' }, h('span'));
  const details = h(
    'section',
    { class: 'xp-panel xp-details', 'aria-label': 'Detalles del lote' },
    sheetToggle,
    detailsLot,
    h('h2', {}, CONCEPT_RESIDENCE.name),
    h('p', { class: 'concept' }, CONCEPT_RESIDENCE.status),
    h('div', { class: 'collapsible' }, detailsRows, h('div', { class: 'xp-views' }, h('div', { class: 'label' }, 'Vistas'), h('div', { class: 'segmented' }, ...viewButtons))),
    h('div', { class: 'actions' }, inquireBtn, h('div', { class: 'secondary' }, replay2, back2)),
  );
  sheetToggle.addEventListener('click', () => details.classList.toggle('is-collapsed'));

  // Tooltip / toast
  const tooltip = h('div', { class: 'xp-tooltip', 'aria-hidden': 'true' });
  const toast = h('div', { class: 'xp-toast', role: 'status', 'aria-live': 'polite' });

  // Inquiry sheet
  const sheetForm = h('div');
  const sheetClose = h('button', { class: 'xp-sheet__close', type: 'button', 'aria-label': 'Cerrar' }, svgIcon.close());
  const sheet = h(
    'div',
    { class: 'xp-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'xp-sheet-title' },
    h('div', { class: 'xp-sheet__card' }, sheetClose, h('p', { class: 'eyebrow', 'data-sheet-lot': '' }), h('h2', { id: 'xp-sheet-title' }, 'Consultar por este lote'), sheetForm),
  );
  sheetClose.addEventListener('click', () => closeSheet());
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet();
  });
  const form = mountInquiryForm(sheetForm, { compact: true });

  const fallback = h('div', { class: 'xp-fallback', hidden: true });

  // Dragging or tapping the film hands the camera to the visitor.
  cinema.el.addEventListener('pointerdown', () => setFilmVisible(false));
  el.replaceChildren(stage, cinema.el, fallback, bar, disclosure, loading, overview, build, details, tooltip, toast, sheet);
  el.addEventListener('keydown', onKeyDown);

  return {
    viewToggle,
    el, stage, bar, lotLabelEl, disclosure, disclosureBtn, closeBtn, loading, loadBar, loadPct, loadLabel,
    overview, setPlace, lotSelect, build, stageName, stageCount, segments, pauseBtn, setPauseIcon,
    details, detailsLot, detailsRows, viewButtons, tooltip, toast, sheet, form, fallback,
  };
}

function show(panel, on) {
  panel.classList.toggle('is-visible', on);
  panel.toggleAttribute('inert', !on);
}

let toastTimer = 0;
function toastMsg(text, ms = 2600) {
  ui.toast.textContent = text;
  ui.toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ui.toast.classList.remove('is-visible'), ms);
}

function renderDetails(lot) {
  ui.detailsLot.textContent = `${lotLabel(lot)} · ${lot.id}`;
  ui.detailsRows.replaceChildren(
    ...lotDetailRows(lot).map((r) => h('div', {}, h('dt', {}, r.label), h('dd', {}, r.pending ? h('span', { class: 'pending' }, r.value) : r.value))),
  );
  ui.viewButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === 'front')));
}

function setHash(lotId) {
  const url = new URL(location.href);
  url.hash = lotId ? `lote=${lotId}` : 'experiencia';
  history.replaceState(null, '', url);
}

function onState(state, ctx) {
  const lot = ctx.lot;
  ui.el.dataset.state = state; // styling hook, also observed by the end-to-end tests
  ui.lotLabelEl.textContent = lot && state !== 'overview' ? lotLabel(lot) : '';
  show(ui.overview, state === 'overview');
  // Leaving the overview (a lot was chosen): the next return starts from the general view.
  if (state !== 'overview') ui.setPlace(null);
  show(ui.build, state === 'building');
  show(ui.details, state === 'complete' || state === 'exploring');
  if (state === 'approaching') {
    ui.tooltip.classList.remove('is-visible');
    toastMsg(`${lotLabel(lot)} · preparando el terreno`);
    setHash(lot.id);
    setFilmVisible(false);
    prepareFilm(lot);
  }
  // The film takes over when the camera lands (and on replay).
  if (state === 'building' && currentFilm && ctx.previous !== 'building') setFilmVisible(true);
  if (state === 'overview' || state === 'returning') {
    setFilmVisible(false);
    ui.viewToggle.hidden = true;
  }
  if (state === 'building') ui.setPauseIcon(Boolean(ctx.paused));
  if ((state === 'complete' || state === 'exploring') && lot) {
    if (ctx.previous === 'building') renderDetails(lot);
    // On phones the sheet opens collapsed so the residence stays in view.
    if (state === 'complete') ui.details.classList.toggle('is-collapsed', innerWidth <= 760);
    ui.form.setLot(lot.id);
  }
  if (state === 'overview') setHash(null);
}

function onStage(stage, index, progress) {
  if (cinema.visible) cinema.setProgress(progress);
  ui.stageName.textContent = stage.label;
  ui.stageCount.textContent = `${String(index + 1).padStart(2, '0')} / ${String(CONSTRUCTION_STAGES.length).padStart(2, '0')}`;
  ui.segments.forEach((seg, i) => {
    const s = CONSTRUCTION_STAGES[i];
    const f = Math.min(1, Math.max(0, (progress - s.start) / (s.end - s.start)));
    seg.firstChild.style.width = `${(f * 100).toFixed(1)}%`;
    seg.classList.toggle('is-current', i === index);
  });
}

function onHover(lot, pos) {
  if (!lot || !pos) {
    ui.tooltip.classList.remove('is-visible');
    return;
  }
  const rect = ui.el.getBoundingClientRect();
  ui.tooltip.replaceChildren(lotLabel(lot), h('span', { class: 'mono' }, lot.id));
  ui.tooltip.style.left = `${pos.x - rect.left}px`;
  ui.tooltip.style.top = `${pos.y - rect.top}px`;
  ui.tooltip.classList.add('is-visible');
}

function selectLot(id) {
  track('select_lot', { lot: id });
  if (xp) {
    if (!xp.select(id)) toastMsg('Terminá de ver la construcción o volvé al desarrollo para elegir otro lote.');
  } else {
    showFallbackLot(id);
  }
}

function openSheet() {
  const lot = xp?.lot || fallbackLot;
  ui.sheet.querySelector('[data-sheet-lot]').textContent = lot ? `${lotLabel(lot)} · ${lot.id}` : DEVELOPMENT.name;
  ui.form.setLot(lot?.id || null);
  ui.sheet.classList.add('is-visible');
  setTimeout(() => ui.form.focus(), 50);
}

function closeSheet() {
  ui.sheet.classList.remove('is-visible');
}

function onKeyDown(e) {
  if (e.key === 'Escape') {
    if (ui.sheet.classList.contains('is-visible')) closeSheet();
    else if (!ui.disclosure.hidden) {
      ui.disclosure.hidden = true;
      ui.disclosureBtn.setAttribute('aria-expanded', 'false');
    } else closeExplorer();
    e.preventDefault();
    return;
  }
  if (e.key === ' ' && xp?.state === 'building' && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    xp.togglePause();
  }
  if (e.key === 'Tab') {
    // Keep focus inside the dialog (or inside the inquiry sheet while it is open).
    const scope = ui.sheet.classList.contains('is-visible') ? ui.sheet : ui.el;
    const focusables = [...scope.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (n) => !n.closest('[inert]') && !n.closest('[hidden]') && n.offsetParent !== null,
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }
}

// ------------------------------------------------------------------ fallback

let fallbackLot = null;
let fallbackPlan = null;

function stageStills() {
  if (!heroManifest?.stages) return [];
  const base = new URL(heroManifest.source || './', new URL('../assets/renders/hero/', import.meta.url));
  return heroManifest.stages.map((s) => ({ label: s.label, src: new URL(`desktop/f${String(s.frame).padStart(2, '0')}.webp`, base).href }));
}

function enterFallback(reason) {
  ui.el.dataset.state = 'fallback';
  ui.loading.classList.add('is-done');
  show(ui.build, false);
  show(ui.overview, false);
  ui.fallback.hidden = false;
  const stills = stageStills();
  const still = h('img', { alt: '', src: stills.at(-1)?.src || new URL('../assets/renders/overview.webp', import.meta.url).href });
  const stepLabel = h('span', { class: 'small', style: { color: 'rgba(244,239,230,.7)' } }, stills.at(-1)?.label || '');
  const range = stills.length
    ? h('input', { type: 'range', min: 0, max: stills.length - 1, value: stills.length - 1, 'aria-label': 'Etapa de construcción', style: { width: '100%' } })
    : null;
  range?.addEventListener('input', () => {
    const s = stills[Number(range.value)];
    still.src = s.src;
    stepLabel.textContent = s.label;
  });
  fallbackPlan = planSvg({ interactive: true, labels: true, onSelect: (id) => showFallbackLot(id), selectedId: fallbackLot?.id || null });
  ui.fallback.replaceChildren(
    h('div', { class: 'plan' }, fallbackPlan),
    h(
      'div',
      { class: 'side' },
      h('p', { class: 'notice on-dark', style: { color: 'rgba(244,239,230,.8)' } }, reason),
      h('div', { class: 'still' }, still),
      range ? h('div', {}, range, stepLabel) : null,
      h('p', { class: 'small', style: { color: 'rgba(244,239,230,.6)' } }, 'Elegí un lote en el plano para ver sus datos y consultar.'),
    ),
  );
  if (fallbackLot) showFallbackLot(fallbackLot.id);
}

function showFallbackLot(id) {
  const lot = findLot(id);
  if (!lot) return;
  fallbackLot = lot;
  fallbackPlan?.setSelected(id);
  renderDetails(lot);
  ui.lotLabelEl.textContent = lotLabel(lot);
  ui.form.setLot(lot.id);
  ui.details.classList.toggle('is-collapsed', innerWidth <= 760);
  show(ui.details, true);
  setHash(lot.id);
}

function showFallbackOverview() {
  fallbackLot = null;
  fallbackPlan?.setSelected(null);
  show(ui.details, false);
  ui.lotLabelEl.textContent = '';
  setHash(null);
}

// ------------------------------------------------------------------ open/close

export async function openExplorer({ lotId = null } = {}) {
  if (opening) return opening;
  ui = ui || buildUI();
  const el = ui.el;
  lastFocus = document.activeElement;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('is-open'));
  document.body.classList.add('is-locked');
  ui.closeBtn.focus({ preventScroll: true });

  if (xp) {
    if (lotId) selectLot(lotId);
    return xp;
  }
  ui.el.dataset.state = 'loading';
  ui.loading.classList.remove('is-done');
  ui.loadBar.style.width = '0%';
  ui.loadPct.textContent = '0%';
  fallbackLot = lotId ? findLot(lotId) : null;

  opening = (async () => {
    try {
      const mod = await import('./experience/index.js');
      xp = await mod.createExperience(ui.stage, {
        reducedMotion: prefersReducedMotion(),
        onProgress: (f, label) => {
          ui.loadBar.style.width = `${(f * 100).toFixed(1)}%`;
          ui.loadPct.textContent = `${Math.round(f * 100)}%`;
          ui.loadLabel.textContent = label;
        },
        onState,
        onStage,
        onHover,
        onError: (err, info) => {
          if (!info?.fatal) return toastMsg(err.message, 5000);
          // The scene cannot continue: keep the visitor's lot and switch to the plan.
          fallbackLot = xp?.lot || fallbackLot;
          const dead = xp;
          xp = null;
          setTimeout(() => dead?.dispose(), 0);
          enterFallback('La escena 3D se interrumpió en este dispositivo. Seguimos con el plano: podés elegir un lote y consultar.');
        },
      });
      if (!xp) return null;
      if (xp.assetFailures.length) toastMsg('Algunas texturas no se pudieron cargar; la escena se muestra simplificada.', 5000);
      ui.loading.classList.add('is-done');
      if (lotId) selectLot(lotId);
      return xp;
    } catch (err) {
      console.error(err);
      xp?.dispose?.();
      xp = null;
      const reason =
        err?.name === 'WebGLUnavailableError'
          ? 'Tu dispositivo o navegador no permite mostrar la escena 3D. Te mostramos el plano para elegir un lote y consultar.'
          : 'No pudimos iniciar la escena 3D en este dispositivo. Te mostramos el plano para elegir un lote y consultar.';
      enterFallback(reason);
      return null;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

export function closeExplorer() {
  if (!ui) return;
  const el = ui.el;
  closeSheet();
  el.classList.remove('is-open');
  document.body.classList.remove('is-locked');
  xp?.suspend?.();
  // Release the GPU: the scene is rebuilt on the next visit (assets come from cache).
  cinema.show(false);
  currentFilm = null;
  ui.viewToggle.hidden = true;
  clearTimeout(coverTimer);
  const done = () => {
    if (el.classList.contains('is-open')) return;
    el.hidden = true;
    delete el.dataset.state;
    xp?.dispose();
    xp = null;
    ui.fallback.hidden = true;
    ui.fallback.replaceChildren();
    show(ui.details, false);
    show(ui.build, false);
    show(ui.overview, false);
    ui.lotLabelEl.textContent = '';
  };
  setTimeout(done, prefersReducedMotion() ? 0 : 500);
  const url = new URL(location.href);
  if (url.hash.startsWith('#lote=')) {
    url.hash = '';
    history.replaceState(null, '', url);
  }
  lastFocus?.focus?.({ preventScroll: true });
}

/** For automated checks. */
export function _debugExperience() {
  return xp;
}
