// Club gallery: a lightbox over the editorial grid. Native <dialog> (focus is
// trapped and Escape closes it), arrow keys and swipes move between images,
// the large file only loads when an image is opened.
import { h } from './dom.js';

export function mountGallery(host) {
  const buttons = [...host.querySelectorAll('.club-shot__open')];
  if (!buttons.length) return null;
  const items = buttons.map((b) => {
    const img = b.querySelector('img');
    const fig = b.closest('figure');
    return {
      src: img.dataset.full,
      alt: img.alt,
      caption: fig.querySelector('figcaption span')?.textContent || img.alt,
      kind: fig.querySelector('.club-shot__kind')?.textContent || '',
    };
  });

  const img = h('img', { class: 'lightbox__img', alt: '' });
  const caption = h('p', { class: 'lightbox__caption' });
  const count = h('span', { class: 'lightbox__count' });
  const prev = h('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', 'aria-label': 'Imagen anterior' }, '←');
  const next = h('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', 'aria-label': 'Imagen siguiente' }, '→');
  const close = h('button', { class: 'lightbox__close', type: 'button', 'aria-label': 'Cerrar' }, '×');
  const dialog = h('dialog', { class: 'lightbox', 'aria-label': 'Galería del club' }, h('figure', { class: 'lightbox__figure' }, img, h('figcaption', {}, caption, count)), prev, next, close);
  document.body.append(dialog);

  let index = 0;
  const show = (i) => {
    index = (i + items.length) % items.length;
    const it = items[index];
    img.src = it.src;
    img.alt = it.alt;
    caption.textContent = it.kind ? `${it.caption} · ${it.kind}` : it.caption;
    count.textContent = `${index + 1} / ${items.length}`;
    // Warm the neighbours.
    for (const k of [index + 1, index - 1]) new Image().src = items[(k + items.length) % items.length].src;
  };
  buttons.forEach((b, i) =>
    b.addEventListener('click', () => {
      show(i);
      dialog.showModal();
      document.body.classList.add('is-locked');
    }),
  );
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    buttons[index]?.focus();
  });
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  });
  let x0 = null;
  dialog.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  dialog.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
    x0 = null;
  });
  return { show, dialog };
}
