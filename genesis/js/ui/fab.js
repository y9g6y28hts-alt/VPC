// Floating contact button. With a verified WhatsApp number in
// js/config/contact.js it opens WhatsApp with a prepared message; until then
// it takes the visitor to the contact form (it never pretends a channel
// exists). It steps aside while the contact form is on screen.
import { h } from './dom.js';
import { CONTACT } from '../config/contact.js';
import { DEVELOPMENT } from '../data/viva-lago.js';

const svg = (d) => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'currentColor');
  s.append(p);
  return s;
};
const WHATSAPP =
  'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.6-1.3.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2s.2-1.1.1-1.2l-.5-.2z';
const CHAT = 'M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm3 5v2h10V9H7zm0 4v2h7v-2H7z';

export function mountFab() {
  const wa = CONTACT.whatsapp && /^\d{8,15}$/.test(CONTACT.whatsapp);
  const text = encodeURIComponent(`Hola, me interesa ${DEVELOPMENT.name}. Quisiera recibir información.`);
  const fab = wa
    ? h('a', { class: 'fab fab--whatsapp', href: `https://wa.me/${CONTACT.whatsapp}?text=${text}`, target: '_blank', rel: 'noopener', 'aria-label': 'Escribir por WhatsApp a Génesis' }, svg(WHATSAPP), h('span', { class: 'fab__label' }, 'WhatsApp'))
    : h('a', { class: 'fab', href: '#contacto', 'aria-label': 'Consultar con un asesor' }, svg(CHAT), h('span', { class: 'fab__label' }, 'Consultar'));
  document.body.append(fab);
  const contact = document.getElementById('contacto');
  if (contact && 'IntersectionObserver' in window) {
    new IntersectionObserver((e) => fab.classList.toggle('is-hidden', e.some((x) => x.isIntersecting)), { threshold: 0.15 }).observe(contact);
  }
  return fab;
}
