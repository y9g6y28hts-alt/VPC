// Path-traced construction film for the explorer.
//
// When a lot is selected, the real-time camera lands on the same framing as a
// sequence rendered offline with Cycles (tools/cinematic/). The film then takes
// over: frames are chosen by construction progress and dissolve into each
// other, with a slow push-in, so the build reads like an architectural
// time-lapse. The real-time scene stays underneath for free exploration.
import { h } from './dom.js';

const base = new URL('../../assets/cinematic/', import.meta.url);

/** Loads the film manifest once (null if the films are not available). */
let manifestPromise = null;
export function loadCinemaManifest() {
  manifestPromise ||= fetch(new URL('manifest.json', base))
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return manifestPromise;
}

/**
 * Film for a lot: its own (exact framing, seamless hand-over) or, as a labelled
 * reference, the film whose lot faces the most similar direction.
 * @returns {{ film: object, exact: boolean } | null}
 */
export function filmFor(manifest, lot, findLot) {
  if (!manifest?.films?.length || !lot) return null;
  const own = manifest.films.find((f) => f.lots.includes(lot.id));
  if (own) return { film: own, exact: true };
  let best = null;
  let bestDot = -Infinity;
  for (const f of manifest.films) {
    const ref = findLot?.(f.lot);
    if (!ref) continue;
    const dot = ref.frame.inward.x * lot.frame.inward.x + ref.frame.inward.z * lot.frame.inward.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = f;
    }
  }
  return best ? { film: best, exact: false } : null;
}

export class Cinema {
  constructor({ reducedMotion = false } = {}) {
    this.reducedMotion = reducedMotion;
    this.a = h('img', { alt: '', decoding: 'async', draggable: 'false' });
    this.b = h('img', { alt: '', decoding: 'async', draggable: 'false' });
    this.caption = h('p', { class: 'xp-cinema__caption' });
    this.el = h('div', { class: 'xp-cinema', 'aria-hidden': 'true' }, h('div', { class: 'xp-cinema__frame' }, this.a, this.b), this.caption);
    this.film = null;
    this.variant = 'desktop';
    this.cache = new Map();
    this.shown = [-1, -1];
  }

  /** Prepares a film (preloads the first frames); resolves when frame 0 is decoded. */
  async load(film, { exact = true } = {}) {
    this.film = film;
    this.variant = innerWidth / Math.max(1, innerHeight) < 0.85 && film.mobile ? 'mobile' : 'desktop';
    this.caption.textContent = exact ? film.caption || '' : `Render de referencia: la residencia conceptual sobre el lote ${film.lot}, de orientación similar · Cycles`;
    this.shown = [-1, -1];
    await this._img(0);
    // Warm the cache in the background, nearest frames first.
    for (let i = 1; i < film.frames.length; i++) this._img(i).catch(() => {});
  }

  _url(i) {
    return new URL(`${this.film.dir}/${this.variant}/${this.film.frames[i].file}`, base).href;
  }

  _img(i) {
    const url = this._url(i);
    if (!this.cache.has(url)) {
      const im = new Image();
      im.decoding = 'async';
      im.src = url;
      this.cache.set(url, im.decode().then(() => im));
    }
    return this.cache.get(url);
  }

  /** Shows the film at construction progress t ∈ [0, 1] (dissolve between neighbours). */
  async setProgress(t) {
    if (!this.film) return;
    const fr = this.film.frames;
    let i = 0;
    while (i < fr.length - 2 && t >= fr[i + 1].t) i++;
    const span = Math.max(1e-6, fr[i + 1].t - fr[i].t);
    // Hold each frame, then dissolve over the last part of its span.
    const local = Math.min(1, Math.max(0, (t - fr[i].t) / span));
    const mix = this.reducedMotion ? (local > 0.5 ? 1 : 0) : Math.min(1, Math.max(0, (local - 0.55) / 0.45));
    if (this.shown[0] !== i) {
      this.shown[0] = i;
      this._img(i).then((im) => this.shown[0] === i && (this.a.src = im.src)).catch(() => {});
    }
    if (this.shown[1] !== i + 1) {
      this.shown[1] = i + 1;
      this._img(i + 1).then((im) => this.shown[1] === i + 1 && (this.b.src = im.src)).catch(() => {});
    }
    this.b.style.opacity = mix.toFixed(3);
    // Slow push-in across the whole build (camera-like, never more than 6 %).
    if (!this.reducedMotion) this.el.style.setProperty('--push', (1.06 - 0.06 * (1 - t)).toFixed(4));
  }

  show(on) {
    this.el.classList.toggle('is-visible', on);
  }

  get visible() {
    return this.el.classList.contains('is-visible');
  }
}
