// The construction orbit (tools/cinematic/make-orbit.mjs): one continuous
// path-traced camera move around the lot while the residence is built.
// The video only loads when its section approaches, plays muted while it is
// on screen, and pauses when it leaves. With reduced motion or Data Saver it
// never starts by itself: the poster shows and the native controls play it.
import { h } from './dom.js';

const base = new URL('../../assets/cinematic/', import.meta.url);

/**
 * @param {HTMLElement} host  element with data-film-video="<lot>"
 * @param {{ reducedMotion?: boolean }} options
 */
export function mountFilmVideo(host, { reducedMotion = false } = {}) {
  const lot = host.dataset.filmVideo;
  const sources = [
    ['orbit.mp4', 'video/mp4'],
    ['orbit.webm', 'video/webm; codecs="vp9"'],
  ].map(([file, type]) => ({ src: new URL(`${lot}/${file}`, base).href, type }));
  const poster = new URL(`${lot}/orbit-poster.webp`, base).href;
  const quiet = reducedMotion || navigator.connection?.saveData === true;
  const video = h('video', {
    class: 'film-video__media',
    muted: '',
    playsinline: '',
    loop: '',
    preload: 'none',
    poster,
    'aria-label': `Recorrido renderizado alrededor de la residencia conceptual sobre el lote ${lot}, desde el terreno vacío hasta la casa terminada`,
  });
  video.muted = true;
  if (quiet) video.controls = true;
  host.replaceChildren(video);

  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    // H.264 for reach, VP9 where H.264 is not available; the browser picks.
    const els = sources.filter((s) => video.canPlayType(s.type)).map((s) => h('source', { src: s.src, type: s.type }));
    if (!els.length) return unavailable();
    els.at(-1).addEventListener('error', unavailable);
    video.append(...els);
    video.preload = 'auto';
    video.load();
  };
  const unavailable = () => (host.closest('.film-video') || host).classList.add('is-unavailable');
  video.addEventListener('play', load, { once: true });
  if (!('IntersectionObserver' in window)) return { video };
  // Fetch a little ahead; play only while at least half of it is visible.
  new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), { rootMargin: '600px 0px' }).observe(host);
  if (!quiet) {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.intersectionRatio >= 0.5) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: [0, 0.5] },
    ).observe(host);
  }
  return { video };
}
