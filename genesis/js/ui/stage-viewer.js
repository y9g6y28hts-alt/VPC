// "De la obra a la casa": the construction sequence under the visitor's
// control. The frames are the hero's renders (same lot, same camera), so the
// eight stages read as one continuous take. Images load only when the section
// approaches; the next and previous frames are preloaded.
import { h } from './dom.js';
import { CONSTRUCTION_STAGES } from '../core/timeline.js';

const base = new URL('../../assets/renders/hero/', import.meta.url);

// What the concept model shows at each stage (see js/experience/house/).
const NOTES = {
  site: 'Se limpia el terreno, se marcan ejes con caballetes e hilos y llega la arena.',
  foundation: 'Vigas de fundación y bases con sus hierros de espera; se hormigona el contrapiso.',
  structure: 'Columnas, encofrados y losas; el andamio sube con la estructura y el hormigón fragua.',
  masonry: 'Mampostería de ladrillo común, hilada por hilada, cerrando los volúmenes.',
  envelope: 'Revoques, revestimiento de piedra y madera, cubierta, aleros y babetas.',
  openings: 'Ventanas y puertas desde adentro, portón del garaje y barandas de vidrio.',
  landscape: 'Se retira el andamio; solados, deck, piscina, césped y plantas.',
  complete: 'La residencia terminada, con las luces interiores encendidas al atardecer.',
};

/**
 * @param {HTMLElement} host
 * @param {{ reducedMotion?: boolean }} options
 */
export async function mountStageViewer(host, { reducedMotion = false } = {}) {
  let manifest;
  try {
    const res = await fetch(new URL('manifest.json', base));
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch {
    host.replaceChildren(h('p', { class: 'small' }, 'Las imágenes de las etapas no están disponibles en este momento.'));
    return null;
  }
  const frames = manifest.frames;
  // `frame` is where a stage begins (for the scrubber); `shot` is a frame late
  // in the stage, where its work is visible (for the stage buttons).
  const progress = manifest.progress || Array.from({ length: frames }, (_, i) => i / (frames - 1));
  const closest = (t) => progress.reduce((best, p, i) => (Math.abs(p - t) < Math.abs(progress[best] - t) ? i : best), 0);
  const stageFrames = CONSTRUCTION_STAGES.map((s, i) => ({
    ...s,
    frame: manifest.stages[i]?.frame ?? 0,
    shot: i === CONSTRUCTION_STAGES.length - 1 ? frames - 1 : closest(s.start + 0.85 * (s.end - s.start)),
    note: NOTES[s.id],
  }));
  const variant = () => (host.clientWidth / Math.max(1, innerHeight) < 0.85 && innerWidth < 760 ? 'mobile' : 'desktop');
  const url = (i) => new URL(`${variant()}/f${String(i).padStart(2, '0')}.webp`, base).href;

  const imgA = h('img', { alt: '', decoding: 'async' });
  const imgB = h('img', { alt: '', decoding: 'async', class: 'is-back' });
  const media = h('div', { class: 'stage-media', role: 'img' }, imgA, imgB);
  const caption = h('figcaption', { class: 'stage-caption' });
  const range = h('input', { type: 'range', min: '0', max: String(frames - 1), step: '1', value: String(frames - 1), class: 'stage-range', 'aria-label': 'Avance de obra' });
  const rail = h('ol', { class: 'stage-rail' });
  const buttons = stageFrames.map((s, i) => {
    const b = h('button', { type: 'button', 'aria-pressed': 'false' }, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), h('span', { class: 'l' }, s.label));
    b.addEventListener('click', () => show(s.shot, { animate: true }));
    rail.append(h('li', {}, b));
    return b;
  });

  let front = imgA;
  let current = -1;
  const cache = new Map();
  const preload = (i) => {
    if (i < 0 || i >= frames || cache.has(url(i))) return;
    const im = new Image();
    im.src = url(i);
    cache.set(url(i), im);
  };

  // Stage of a frame by construction progress: the last stage that has begun
  // (stages overlap slightly, so a stage's own shot always maps back to it).
  function stageAt(frame) {
    const shotOf = stageFrames.findIndex((s) => s.shot === frame);
    if (shotOf >= 0) return shotOf;
    let k = 0;
    stageFrames.forEach((s, i) => {
      if (frame >= s.frame) k = i;
    });
    return k;
  }

  async function show(frame, { animate = false } = {}) {
    frame = Math.max(0, Math.min(frames - 1, frame));
    if (frame === current) return;
    current = frame;
    range.value = String(frame);
    const k = stageAt(frame);
    const s = stageFrames[k];
    range.setAttribute('aria-valuetext', `${s.label} (${Math.round((frame / (frames - 1)) * 100)} %)`);
    buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === k)));
    caption.replaceChildren(h('span', { class: 'stage-caption__n' }, `Etapa ${String(k + 1).padStart(2, '0')} de ${String(stageFrames.length).padStart(2, '0')}`), h('strong', {}, s.label), h('span', {}, s.note));
    media.setAttribute('aria-label', `Residencia conceptual: ${s.label.toLowerCase()}`);
    // Cross-fade: draw the new frame on the back image, then swap.
    const back = front === imgA ? imgB : imgA;
    back.src = url(frame);
    try {
      await back.decode();
    } catch {
      /* show whatever arrives */
    }
    if (current !== frame) return; // a newer request superseded this one
    back.classList.remove('is-back');
    front.classList.add('is-back');
    back.classList.toggle('is-quick', !animate || reducedMotion);
    front = back;
    preload(frame + 1);
    preload(frame - 1);
  }

  range.addEventListener('input', () => show(Number(range.value)));

  host.replaceChildren(
    h('figure', { class: 'stage-figure' }, media, caption),
    h('div', { class: 'stage-controls' }, rail, h('label', { class: 'stage-range-wrap' }, h('span', { class: 'visually-hidden' }, 'Recorrer la obra'), range)),
  );
  await show(frames - 1);
  return { show };
}
