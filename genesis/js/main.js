// Page bootstrap: header, navigation, reveals, hero sequence, plan figure,
// contact form and the explorer (loaded on demand).
import { BRAND } from './config/brand.js';
import { prefersReducedMotion } from './ui/dom.js';
import { planSvg } from './ui/plan-svg.js';
import { mountInquiryForm } from './ui/inquiry-form.js';
import { initHeroSequence } from './hero-sequence.js';
import { findLot } from './data/viva-lago.js';

const reducedMotion = prefersReducedMotion();

// Official logo, when supplied, replaces the typeset name.
if (BRAND.logo.mono) {
  for (const a of document.querySelectorAll('[data-brand]')) {
    const img = document.createElement('img');
    img.src = BRAND.logo.mono;
    img.alt = BRAND.legalName;
    a.replaceChildren(img);
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

// Plan figure (same data as the 3D scene).
const planHost = document.querySelector('[data-plan-figure]');
if (planHost) planHost.append(planSvg());

// Contact form.
const contactHost = document.querySelector('[data-contact-form]');
const contactForm = contactHost ? mountInquiryForm(contactHost) : null;

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
