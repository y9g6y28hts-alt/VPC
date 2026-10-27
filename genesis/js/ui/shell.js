// Shared page shell for every page of the site (Génesis home, barrios
// privados, Viva Lago): brand wordmarks, header and mobile menu, reveal on
// scroll, launch settings (analytics, preview URLs, brochure), privacy-safe
// click tracking, the floating contact button and the year in the footer.
import { BRAND } from '../config/brand.js';
import { SITE as SITE_CONFIG } from '../config/site.js';
import { initAnalytics, track } from '../core/track.js';
import { mountFab } from './fab.js';

export function initShell({ reducedMotion = false } = {}) {
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
  const hero = document.querySelector('[data-hero]') || document.getElementById('inicio');
  const updateHeader = () => {
    const limit = hero ? hero.offsetHeight - innerHeight - 10 : 40;
    header?.classList.toggle('is-solid', scrollY > Math.max(40, limit));
  };
  addEventListener('scroll', updateHeader, { passive: true });
  addEventListener('resize', updateHeader);
  updateHeader();

  const toggle = header?.querySelector('.nav-toggle');
  toggle?.addEventListener('click', () => {
    const open = !header.classList.contains('nav-open');
    header.classList.toggle('nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  });
  header?.querySelectorAll('.nav a').forEach((a) =>
    a.addEventListener('click', () => {
      header.classList.remove('nav-open');
      toggle?.setAttribute('aria-expanded', 'false');
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

  // Year.
  document.querySelectorAll('[data-year]').forEach((n) => (n.textContent = String(new Date().getFullYear())));

  return { header, hero };
}
