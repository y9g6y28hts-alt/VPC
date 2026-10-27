// Scroll-driven hero: a sequence of frames in which the residence is built as
// the visitor scrolls (rendered by the experience engine, or path-traced by
// tools/cinematic/ when the manifest points at a film). Scroll position is
// construction progress; between two frames the image dissolves, so a short
// path-traced sequence still reads as continuous. Only the poster loads with
// the page; the other frames stream in once the browser is idle or the visitor
// starts scrolling, are decoded off the main thread, and the nearest loaded
// frame is always drawn, so scrolling never waits on the network.

const base = new URL('../assets/renders/hero/', import.meta.url);

export async function initHeroSequence(section, { reducedMotion = false } = {}) {
  const media = section.querySelector('[data-hero-media]');
  const poster = section.querySelector('[data-hero-poster]');
  const stageLabel = section.querySelector('[data-hero-stage]');
  const progressBar = section.querySelector('[data-hero-progress]');
  const cue = section.querySelector('[data-hero-cue]');

  let manifest;
  try {
    const res = await fetch(new URL('manifest.json', base));
    if (!res.ok) throw new Error(String(res.status));
    manifest = await res.json();
  } catch {
    // No frames available: keep the poster, drop the scroll behaviour.
    section.style.height = '100vh';
    cue?.remove();
    return null;
  }

  const portrait = () => innerWidth / innerHeight < 0.85;
  let variant = portrait() ? 'mobile' : 'desktop';
  const src = manifest.source ? new URL(manifest.source, base) : base;
  const frameUrl = (v, i) => new URL(`${v}/f${String(i).padStart(2, '0')}.webp`, src).href;
  // Scroll position of each frame (a film's frames sit at their construction
  // progress; engine frames are evenly spaced).
  const at = manifest.positions || Array.from({ length: manifest.frames }, (_, i) => i / (manifest.frames - 1));
  /** Fractional frame index at scroll progress p. */
  const frameAt = (p) => {
    let i = 0;
    while (i < at.length - 2 && p >= at[i + 1]) i++;
    const f = (p - at[i]) / Math.max(1e-6, at[i + 1] - at[i]);
    return i + Math.min(1, Math.max(0, f));
  };
  // The sequence opens on the empty lot (already in the markup, chosen per
  // orientation by <picture>); without scroll-scrubbing, show the result.
  if (reducedMotion) {
    poster.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
    poster.src = frameUrl(variant, manifest.frames - 1);
  }

  if (reducedMotion) {
    if (stageLabel) stageLabel.textContent = manifest.stages.at(-1).label;
    // Static final image; no scroll-scrubbing.
    section.style.height = '100vh';
    cue?.remove();
    if (progressBar) progressBar.style.width = '100%';
    return { manifest };
  }

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  media.append(canvas);
  const ctx = canvas.getContext('2d');
  let images = [];
  let current = null;

  function load(v) {
    images = new Array(manifest.frames).fill(null);
    // Load the first and last frames first, then fill in between.
    const order = [0, manifest.frames - 1];
    for (let step = Math.floor(manifest.frames / 2); step >= 1; step = Math.floor(step / 2)) {
      for (let i = step; i < manifest.frames - 1; i += step) if (!order.includes(i)) order.push(i);
    }
    let k = 0;
    const next = () => {
      if (k >= order.length || v !== variant) return;
      const i = order[k++];
      const img = new Image();
      img.decoding = 'async';
      img.src = frameUrl(v, i);
      // decode() keeps image decoding off the main thread before first draw.
      img
        .decode()
        .then(() => {
          if (v !== variant) return;
          images[i] = img;
          current = null;
          draw();
        })
        .catch(() => {})
        .finally(next);
    };
    // A few parallel lanes.
    next();
    next();
    next();
  }

  let target = 0;
  let targetF = 0;
  function nearestLoaded(i) {
    for (let d = 0; d < images.length; d++) {
      if (images[i - d]) return i - d;
      if (images[i + d]) return i + d;
    }
    return -1;
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(media.clientWidth * dpr);
    canvas.height = Math.round(media.clientHeight * dpr);
    current = null;
    draw();
  }

  function cover(img, alpha = 1) {
    // object-fit: cover
    const s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const w = img.naturalWidth * s;
    const hgt = img.naturalHeight * s;
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - hgt) / 2, w, hgt);
    ctx.globalAlpha = 1;
  }

  function draw() {
    const i0 = Math.floor(targetF);
    // Hold each frame, then dissolve into the next over the second half.
    const mix = Math.min(1, Math.max(0, (targetF - i0 - 0.45) / 0.55));
    const a = images[i0] ? i0 : nearestLoaded(i0);
    if (a < 0) return;
    const b = images[i0 + 1] && mix > 0 ? i0 + 1 : -1;
    const key = `${a}:${b}:${b >= 0 ? mix.toFixed(2) : 0}`;
    if (key === current) return;
    current = key;
    cover(images[a]);
    if (b >= 0) cover(images[b], mix);
    poster.style.visibility = 'hidden';
  }

  function onScroll() {
    const rect = section.getBoundingClientRect();
    const span = section.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, span)));
    targetF = frameAt(p);
    target = Math.round(targetF);
    draw();
    if (progressBar) progressBar.style.width = `${(p * 100).toFixed(1)}%`;
    if (stageLabel && manifest.stages) {
      let label = manifest.stages[0].label;
      for (const st of manifest.stages) if ((st.start != null ? p >= st.start : target >= st.frame)) label = st.label;
      stageLabel.textContent = label;
    }
    if (cue) cue.style.opacity = p > 0.04 ? '0' : '';
  }

  // Start streaming frames when the page is idle or on the first scroll.
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    load(variant);
  };
  // With Data Saver on, frames are only fetched once the visitor scrolls.
  const saveData = navigator.connection?.saveData === true;
  if (!saveData) {
    if ('requestIdleCallback' in window) requestIdleCallback(start, { timeout: 2500 });
    else setTimeout(start, 1200);
  }
  images = new Array(manifest.frames).fill(null);
  resize();
  onScroll();
  let scheduled = false;
  addEventListener(
    'scroll',
    () => {
      start();
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        onScroll();
      });
    },
    { passive: true },
  );
  addEventListener('resize', () => {
    const v = portrait() ? 'mobile' : 'desktop';
    if (v !== variant) {
      variant = v;
      poster.closest('picture')?.querySelectorAll('source').forEach((s) => s.remove());
      poster.src = frameUrl(variant, 0);
      poster.style.visibility = '';
      if (started) load(variant);
    }
    resize();
    onScroll();
  });
  return { manifest };
}
