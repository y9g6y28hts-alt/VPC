// "El predio, hoy": real footage and photographs of the site supplied by
// Génesis. Vertical clips (phone footage) play muted while on screen and can be
// switched with tabs; photographs open in a full-screen viewer with arrows,
// swipe and Escape (native <dialog>). With reduced motion or Data Saver the
// clips never start by themselves.
import { h } from './dom.js';

export function mountReels(host, { reducedMotion = false } = {}) {
  const tabs = [...host.querySelectorAll('[data-reel]')];
  const video = host.querySelector('video');
  if (!video || !tabs.length) return null;
  const quiet = reducedMotion || navigator.connection?.saveData === true;
  video.muted = true;
  if (quiet) video.controls = true;
  let visible = false;

  function select(tab) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
    video.poster = tab.dataset.poster;
    video.src = tab.dataset.reel;
    video.setAttribute('aria-label', tab.dataset.label);
    host.querySelector('[data-reel-caption]').textContent = tab.dataset.label;
    if (visible && !quiet) video.play().catch(() => {});
  }
  tabs.forEach((t) => t.addEventListener('click', () => select(t)));
  // Play through the clips one after another while the section is watched.
  video.addEventListener('ended', () => {
    const i = tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true');
    select(tabs[(i + 1) % tabs.length]);
  });
  video.preload = 'none';
  select(tabs[0]);
  if ('IntersectionObserver' in window && !quiet) {
    new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          visible = e.intersectionRatio >= 0.4;
          if (visible) video.play().catch(() => {});
          else video.pause();
        }
      },
      { threshold: [0, 0.4] },
    ).observe(video);
  }
  return { video, select };
}

export function mountPhotoViewer(host) {
  const shots = [...host.querySelectorAll('[data-photo]')];
  if (!shots.length) return null;
  const items = shots.map((a) => ({ src: a.getAttribute('href'), alt: a.querySelector('img')?.alt || '', caption: a.dataset.caption || '' }));
  const img = h('img', { class: 'lightbox__img', alt: '' });
  const caption = h('p', { class: 'lightbox__caption' });
  const count = h('span', { class: 'lightbox__count' });
  const prev = h('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', 'aria-label': 'Foto anterior' }, '‹');
  const next = h('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', 'aria-label': 'Foto siguiente' }, '›');
  const close = h('button', { class: 'lightbox__close', type: 'button', 'aria-label': 'Cerrar' }, '×');
  const dialog = h('dialog', { class: 'lightbox lightbox--photo', 'aria-label': 'Fotografías del predio' }, h('figure', { class: 'lightbox__figure' }, img, h('figcaption', {}, caption, count)), prev, next, close);
  document.body.append(dialog);
  let index = 0;
  let opener = null;
  const view = (i) => {
    index = (i + items.length) % items.length;
    img.src = items[index].src;
    img.alt = items[index].alt;
    caption.textContent = items[index].caption;
    count.textContent = `${index + 1} / ${items.length}`;
    new Image().src = items[(index + 1) % items.length].src;
  };
  shots.forEach((a, i) =>
    a.addEventListener('click', (e) => {
      e.preventDefault();
      opener = a;
      view(i);
      dialog.showModal();
      document.body.classList.add('is-locked');
    }),
  );
  prev.addEventListener('click', () => view(index - 1));
  next.addEventListener('click', () => view(index + 1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') view(index + 1);
    if (e.key === 'ArrowLeft') view(index - 1);
  });
  let x0 = null;
  dialog.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) view(index + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    opener?.focus();
  });
  return { dialog, view };
}
