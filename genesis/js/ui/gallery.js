// Club gallery. The markup is an editorial grid (works without JavaScript);
// this turns it into a showcase: one large image that dissolves to the next,
// arrows, a counter, a caption and a strip of thumbnails, with swipe and arrow
// keys. Clicking the large image opens a full-screen viewer with the same
// strip (native <dialog>: focus is trapped and Escape closes it). Large files
// load only when they are about to be shown.
import { h } from './dom.js';

const chevron = (dir) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', dir < 0 ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.6');
  s.append(p);
  return s;
};

function thumbs(items, onPick, cls) {
  const row = h('div', { class: cls, role: 'tablist', 'aria-label': 'Imágenes' });
  const buttons = items.map((it, i) => {
    const b = h('button', { type: 'button', role: 'tab', 'aria-selected': 'false', 'aria-label': it.caption }, h('img', { src: it.thumb, alt: '', loading: 'lazy', decoding: 'async' }));
    b.addEventListener('click', () => onPick(i));
    row.append(b);
    return b;
  });
  const select = (i) =>
    buttons.forEach((b, k) => {
      b.setAttribute('aria-selected', String(k === i));
      b.tabIndex = k === i ? 0 : -1;
      if (k === i) b.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
  return { row, select };
}

function swipe(el, go) {
  let x0 = null;
  el.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientX), { passive: true });
  el.addEventListener('touchend', (e) => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    x0 = null;
  });
}

export function mountGallery(host, { reducedMotion = false } = {}) {
  const figures = [...host.querySelectorAll('.club-shot')];
  if (!figures.length) return null;
  const items = figures.map((fig) => {
    const img = fig.querySelector('img');
    return {
      thumb: img.currentSrc || img.src,
      src: img.dataset.full,
      alt: img.alt,
      caption: fig.querySelector('figcaption span')?.textContent || img.alt,
      kind: fig.querySelector('.club-shot__kind')?.textContent || '',
    };
  });

  // ------------------------------------------------------------ showcase
  const a = h('img', { class: 'showcase__img is-front', alt: '', decoding: 'async' });
  const b = h('img', { class: 'showcase__img', alt: '', decoding: 'async' });
  const open = h('button', { class: 'showcase__open', type: 'button', 'aria-label': 'Ver en pantalla completa' }, a, b);
  const prev = h('button', { class: 'showcase__nav showcase__nav--prev', type: 'button', 'aria-label': 'Imagen anterior' }, chevron(-1));
  const next = h('button', { class: 'showcase__nav showcase__nav--next', type: 'button', 'aria-label': 'Imagen siguiente' }, chevron(1));
  const caption = h('span', { class: 'showcase__caption' });
  const kind = h('span', { class: 'showcase__kind' });
  const count = h('span', { class: 'showcase__count' });
  const strip = thumbs(items, (i) => show(i), 'showcase__thumbs');
  const stage = h('div', { class: 'showcase__stage' }, open, prev, next);
  const showcase = h(
    'div',
    { class: 'showcase', role: 'region', 'aria-roledescription': 'carrusel', 'aria-label': 'Imágenes del club' },
    stage,
    h('div', { class: 'showcase__bar' }, h('p', { class: 'showcase__text', 'aria-live': 'polite' }, caption, kind), count),
    strip.row,
  );
  host.replaceWith(showcase);

  let index = -1;
  let front = a;
  function show(i) {
    i = (i + items.length) % items.length;
    if (i === index) return;
    index = i;
    const it = items[i];
    const back = front === a ? b : a;
    back.src = it.src;
    back.alt = it.alt;
    const swap = () => {
      if (index !== i) return;
      back.classList.add('is-front');
      front.classList.remove('is-front');
      back.classList.toggle('is-quick', reducedMotion);
      front = back;
    };
    back.decode ? back.decode().then(swap, swap) : swap();
    caption.textContent = it.caption;
    kind.textContent = it.kind;
    count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
    strip.select(i);
    new Image().src = items[(i + 1) % items.length].src;
  }
  prev.addEventListener('click', () => show(index - 1));
  next.addEventListener('click', () => show(index + 1));
  showcase.addEventListener('keydown', (e) => {
    if (e.target.closest('dialog')) return;
    if (e.key === 'ArrowRight') show(index + 1);
    if (e.key === 'ArrowLeft') show(index - 1);
  });
  swipe(stage, (d) => show(index + d));

  // ------------------------------------------------------------ viewer
  const vImg = h('img', { class: 'lightbox__img', alt: '' });
  const vCaption = h('p', { class: 'lightbox__caption' });
  const vCount = h('span', { class: 'lightbox__count' });
  const vPrev = h('button', { class: 'lightbox__nav lightbox__nav--prev', type: 'button', 'aria-label': 'Imagen anterior' }, chevron(-1));
  const vNext = h('button', { class: 'lightbox__nav lightbox__nav--next', type: 'button', 'aria-label': 'Imagen siguiente' }, chevron(1));
  const vClose = h('button', { class: 'lightbox__close', type: 'button', 'aria-label': 'Cerrar' }, '×');
  const vStrip = thumbs(items, (i) => view(i), 'lightbox__thumbs');
  const dialog = h('dialog', { class: 'lightbox', 'aria-label': 'Galería del club' }, h('figure', { class: 'lightbox__figure' }, vImg, h('figcaption', {}, vCaption, vCount)), vStrip.row, vPrev, vNext, vClose);
  document.body.append(dialog);
  let vIndex = 0;
  function view(i) {
    vIndex = (i + items.length) % items.length;
    const it = items[vIndex];
    vImg.src = it.src;
    vImg.alt = it.alt;
    vCaption.textContent = it.kind ? `${it.caption} · ${it.kind}` : it.caption;
    vCount.textContent = `${vIndex + 1} / ${items.length}`;
    vStrip.select(vIndex);
    for (const k of [vIndex + 1, vIndex - 1]) new Image().src = items[(k + items.length) % items.length].src;
  }
  open.addEventListener('click', () => {
    view(index);
    dialog.showModal();
    document.body.classList.add('is-locked');
  });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-locked');
    show(vIndex);
    open.focus();
  });
  vPrev.addEventListener('click', () => view(vIndex - 1));
  vNext.addEventListener('click', () => view(vIndex + 1));
  vClose.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') view(vIndex + 1);
    if (e.key === 'ArrowLeft') view(vIndex - 1);
  });
  swipe(dialog, (d) => view(vIndex + d));

  show(0);
  return { show, dialog, showcase };
}
