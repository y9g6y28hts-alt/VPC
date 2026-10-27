// Bootstrap for the Génesis pages (home and barrios privados): the shared
// shell and, where the page has one, the contact form.
import { prefersReducedMotion } from './ui/dom.js';
import { initShell } from './ui/shell.js';
import { mountInquiryForm } from './ui/inquiry-form.js';

const reducedMotion = prefersReducedMotion();
initShell({ reducedMotion });
const contactHost = document.querySelector('[data-contact-form]');
if (contactHost) mountInquiryForm(contactHost);
