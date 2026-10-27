// Page bootstrap: header, navigation, reveals, hero sequence, location, lot
// browser, common areas, contact form and the 3D explorer (loaded on demand).
import { BRAND } from './config/brand.js';
import { h, prefersReducedMotion } from './ui/dom.js';
import { mountInquiryForm } from './ui/inquiry-form.js';
import { mountLotBrowser } from './ui/lot-browser.js';
import { locationSvg, keyPlanSvg } from './ui/site-maps.js';
import { mountStageViewer } from './ui/stage-viewer.js';
import { mountFilmVideo } from './ui/film-video.js';
import { mountGallery } from './ui/gallery.js';
import { mountFab } from './ui/fab.js';
import { SITE as SITE_CONFIG } from './config/site.js';
import { initAnalytics, track } from './core/track.js';
import { initHeroSequence } from './hero-sequence.js';
import { findLot, DEVELOPMENT, SITE_LOCATION, COMMON_AREA_TABLE } from './data/viva-lago.js';
import { formatDms, formatDecimal } from './core/geo.js';

const reducedMotion = prefersReducedMotion();

/**
 * Builds a below-the-fold section when it approaches the viewport (or when the
 * browser is idle), keeping that work off the first paint.
 */
function whenNear(host, build) {
  if (!host) return;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    io?.disconnect();
    build(host);
  };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && run(), { rootMargin: '900px 0px' }) : null;
  if (io) io.observe(host);
  if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

// Official wordmark replaces the typeset name: ivory over dark grounds, colour
// once the header turns solid (CSS picks the visible one).
if (BRAND.logo.wordmarkMono) {
  for (const a of document.querySelectorAll('[data-brand]')) {
    const mono = Object.assign(document.createElement('img'), { src: BRAND.logo.wordmarkMono, alt: BRAND.legalName, className: 'brand__logo brand__logo--mono' });
    const colour = Object.assign(document.createElement('img'), { src: BRAND.logo.wordmarkColor, alt: '', className: 'brand__logo brand__logo--color' });
    colour.setAttribute('aria-hidden', 'true');
    a.replaceChildren(mono, colour);
  }
}

// Header: transparent over the hero, solid afterwards.
const header = document.getElementById('header');
const hero = document.getElementById('inicio');
const updateHeader = () => {
  const limit = hero ? hero.offsetHeight - innerHeight - 10 : 40;
  header.classList.toggle('is-solid', scrollY > Math.max(40, limit));
};
addEventListener('scroll', updateHeader, { passive: true });
addEventListener('resize', updateHeader);
updateHeader();

const toggle = header.querySelector('.nav-toggle');
toggle.addEventListener('click', () => {
  const open = !header.classList.contains('nav-open');
  header.classList.toggle('nav-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
});
header.querySelectorAll('.nav a').forEach((a) =>
  a.addEventListener('click', () => {
    header.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
  }),
);

// Reveal on scroll.
const io = 'IntersectionObserver' in window
  ? new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    )
  : null;
document.querySelectorAll('.reveal').forEach((el) => (io && !reducedMotion ? io.observe(el) : el.classList.add('is-in')));

// Contact form.
const contactHost = document.querySelector('[data-contact-form]');
const contactForm = contactHost ? mountInquiryForm(contactHost) : null;

/** Carries a lot into the contact form and moves the visitor there. */
function inquireAbout(lotId) {
  contactForm?.setLot(lotId);
  const section = document.getElementById('contacto');
  section?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
  section?.querySelector('input[name="name"]')?.focus({ preventScroll: true });
}

// Location: coordinates from the survey, map pin from Génesis, site sketch.
const dms = document.querySelector('[data-coords-dms]');
const dec = document.querySelector('[data-coords-decimal]');
if (dms) dms.textContent = formatDms(SITE_LOCATION);
if (dec) dec.textContent = formatDecimal(SITE_LOCATION);
document.querySelector('[data-maps-link]')?.setAttribute('href', DEVELOPMENT.mapsUrl);
whenNear(document.querySelector('[data-location-map]'), (host) => host.append(locationSvg()));
const copyBtn = document.querySelector('[data-copy-coords]');
const copyStatus = document.querySelector('[data-copy-status]');
copyBtn?.addEventListener('click', async () => {
  const text = formatDecimal(SITE_LOCATION);
  try {
    // Some browsers leave the request pending when permission is not granted.
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 1200));
    await Promise.race([navigator.clipboard.writeText(text), timeout]);
    copyStatus.textContent = 'Coordenadas copiadas.';
  } catch {
    // Clipboard refused or unavailable: select the text instead.
    const range = document.createRange();
    range.selectNodeContents(dec);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    copyStatus.textContent = 'Seleccionadas: copialas con Ctrl+C o mantené presionado.';
  }
});

// Lot browser (plan, list and lot sheet; no WebGL needed).
let lotBrowser = null;
let pendingLot = null;
whenNear(document.querySelector('[data-lot-browser]'), (host) => {
  lotBrowser = mountLotBrowser(host, { onExplore: (id) => open(id), onInquire: inquireAbout, reducedMotion });
  if (pendingLot) lotBrowser.select(pendingLot);
});

// Launch settings (js/config/site.js): measurement, absolute preview URLs, brochure.
initAnalytics();
if (SITE_CONFIG.siteUrl) {
  for (const [sel, attr] of [['meta[property="og:image"]', 'content']]) {
    const el = document.querySelector(sel);
    if (el) el.setAttribute(attr, new URL(el.getAttribute(attr), SITE_CONFIG.siteUrl).href);
  }
  const og = document.createElement('meta');
  og.setAttribute('property', 'og:url');
  og.content = SITE_CONFIG.siteUrl;
  const canonical = document.createElement('link');
  canonical.rel = 'canonical';
  canonical.href = SITE_CONFIG.siteUrl;
  document.head.append(og, canonical);
}
document.querySelectorAll('[data-brochure]').forEach((a) => {
  if (!SITE_CONFIG.brochureUrl) return;
  a.href = SITE_CONFIG.brochureUrl;
  a.hidden = false;
  a.addEventListener('click', () => track('brochure_download'));
});
// Which buttons people use (no personal data).
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-open-explorer], .fab, [data-maps-link], .showcase__open, .spec .btn');
  if (!el) return;
  const name = el.matches('[data-open-explorer]') ? 'open_explorer' : el.matches('.fab') ? 'contact_button' : el.matches('[data-maps-link]') ? 'open_map' : el.matches('.showcase__open') ? 'gallery_fullscreen' : 'spec_action';
  track(name, { label: el.textContent.trim().slice(0, 40) });
});

// Contact always within reach.
mountFab();

// The club: Génesis' images, with a lightbox.
const galleryHost = document.querySelector('[data-club-gallery]');
if (galleryHost) mountGallery(galleryHost, { reducedMotion });

// The construction orbit (a path-traced video; loads only near the viewport).
const filmHost = document.querySelector('[data-film-video]');
if (filmHost) mountFilmVideo(filmHost, { reducedMotion });

// Construction stages under the visitor's control.
whenNear(document.querySelector('[data-stage-viewer]'), (host) => mountStageViewer(host, { reducedMotion }));

// Common areas, each with a key plan.
const infraHost = document.querySelector('[data-infra]');
whenNear(infraHost, () => {
  infraHost.replaceChildren(
    ...COMMON_AREA_TABLE.map((c, i) =>
      h(
        'li',
        { class: 'infra__item' },
        keyPlanSvg(c.id, `Plano de ubicación de ${c.name}`),
        h('div', { class: 'infra__text' },
          h('span', { class: 'infra__n' }, String(i + 1).padStart(2, '0')),
          h('h3', {}, c.name),
          h('p', { class: 'infra__area' }, `${c.areaM2.toLocaleString('es-PY', { minimumFractionDigits: 2 })} m²`, h('span', {}, ` · ${c.parcel}`)),
          h('p', {}, c.note),
          c.parts ? h('ul', { class: 'infra__parts' }, ...c.parts.map(([n, a]) => h('li', {}, h('span', {}, n), h('span', {}, `${a.toLocaleString('es-PY', { minimumFractionDigits: 2 })} m²`)))) : null,
        ),
      ),
    ),
  );
});

// Year.
document.querySelectorAll('[data-year]').forEach((n) => (n.textContent = String(new Date().getFullYear())));

// Explorer (loaded on first use; prefetched when the experience section approaches).
let explorerModule = null;
const loadExplorer = () => (explorerModule ||= import('./explorer.js'));
let heroManifest = null;

async function open(lotId = null) {
  const mod = await loadExplorer();
  if (heroManifest) mod.setHeroManifest(heroManifest);
  return mod.openExplorer({ lotId });
}
document.querySelectorAll('[data-open-explorer]').forEach((b) => b.addEventListener('click', () => open()));
const xpSection = document.getElementById('experiencia');
if (xpSection && 'IntersectionObserver' in window) {
  const pre = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) {
      loadExplorer();
      pre.disconnect();
    }
  }, { rootMargin: '600px 0px' });
  pre.observe(xpSection);
}

// Deep link: #lote=B-05 opens the experience on that lot.
function handleHash() {
  const m = location.hash.match(/^#lote=([A-Z]-\d{2})$/);
  if (m && findLot(m[1])) {
    open(m[1]);
    contactForm?.setLot(m[1]);
    if (lotBrowser) lotBrowser.select(m[1]);
    else pendingLot = m[1];
  }
}
addEventListener('hashchange', handleHash);
handleHash();

// Hero sequence.
if (hero) {
  initHeroSequence(hero, { reducedMotion }).then((r) => {
    heroManifest = r?.manifest || null;
    if (heroManifest && explorerModule) explorerModule.then((m) => m.setHeroManifest(heroManifest));
  });
}
