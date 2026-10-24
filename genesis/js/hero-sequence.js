// Scroll-driven hero: a sequence of frames rendered by the experience engine
// (tools/capture-renders.mjs) in which the residence is built as the visitor
// scrolls. Frames load progressively after the poster; the nearest loaded
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
  const frameUrl = (v, i) => new URL(`${v}/f${String(i).padStart(2, '0')}.webp`, base).href;
  // The sequence opens on the empty lot; without scroll-scrubbing, show the result.
  poster.src = frameUrl(variant, reducedMotion ? manifest.frames - 1 : 0);

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
  let current = -1;

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
      img.onload = () => {
        if (v !== variant) return;
        images[i] = img;
        if (current < 0 || Math.abs(i - target) < Math.abs(current - target)) draw();
        next();
      };
      img.onerror = next;
      img.src = frameUrl(v, i);
    };
    // A few parallel lanes.
    next();
    next();
    next();
  }

  let target = 0;
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
    current = -1;
    draw();
  }

  function draw() {
    const i = nearestLoaded(target);
    if (i < 0) return;
    if (i === current) return;
    current = i;
    const img = images[i];
    // object-fit: cover
    const s = Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight);
    const w = img.naturalWidth * s;
    const hgt = img.naturalHeight * s;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - hgt) / 2, w, hgt);
    poster.style.visibility = 'hidden';
  }

  function onScroll() {
    const rect = section.getBoundingClientRect();
    const span = section.offsetHeight - innerHeight;
    const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, span)));
    target = Math.round(p * (manifest.frames - 1));
    draw();
    if (progressBar) progressBar.style.width = `${(p * 100).toFixed(1)}%`;
    if (stageLabel && manifest.stages) {
      let label = manifest.stages[0].label;
      for (const s of manifest.stages) if (target >= s.frame) label = s.label;
      stageLabel.textContent = label;
    }
    if (cue) cue.style.opacity = p > 0.04 ? '0' : '';
  }

  load(variant);
  resize();
  onScroll();
  addEventListener('scroll', () => requestAnimationFrame(onScroll), { passive: true });
  addEventListener('resize', () => {
    const v = portrait() ? 'mobile' : 'desktop';
    if (v !== variant) {
      variant = v;
      poster.src = frameUrl(variant, 0);
      poster.style.visibility = '';
      load(variant);
    }
    resize();
    onScroll();
  });
  return { manifest };
}
