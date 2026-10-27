// Bootstrap for the Génesis pages (home, barrios privados, terrenos): the
// shared shell, the contact form, and on the home page the company details
// and the team.
import { prefersReducedMotion } from './ui/dom.js';
import { initShell } from './ui/shell.js';
import { mountInquiryForm } from './ui/inquiry-form.js';
import { mountTeam } from './ui/team.js';
import { COMPANY, TEAM } from './config/company.js';

const reducedMotion = prefersReducedMotion();
initShell({ reducedMotion });

const contactHost = document.querySelector('[data-contact-form]');
if (contactHost) mountInquiryForm(contactHost, { topic: contactHost.dataset.topic || null });

// Vision and office: shown only with the details Génesis supplied.
const vision = document.querySelector('[data-vision]');
if (vision) {
  if (COMPANY.vision) vision.querySelector('[data-vision-text]').textContent = COMPANY.vision;
  else vision.hidden = true;
}
const { office } = COMPANY;
for (const [key, value] of Object.entries({ address: office.address, hours: office.hours })) {
  const el = document.querySelector(`[data-office-${key}]`);
  if (el && value) {
    el.querySelector('dd').textContent = value;
    el.hidden = false;
  }
}
const officeMap = document.querySelector('[data-office-map]');
if (officeMap && office.mapsUrl) {
  officeMap.href = office.mapsUrl;
  officeMap.hidden = false;
}
const officeVisit = document.querySelector('[data-office-visit]');
if (officeVisit) officeVisit.hidden = Boolean(office.address);

mountTeam(document.querySelector('[data-team]'), TEAM, {
  onContact: (m) => {
    const message = contactHost?.querySelector('textarea[name="message"]');
    if (message && !message.value) message.value = `Me gustaría conversar con ${m.name}.`;
    document.getElementById('contacto')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    contactHost?.querySelector('input[name="name"]')?.focus({ preventScroll: true });
  },
});
