// Inquiry form shared by the contact section and the explorer. It never claims
// a message was sent unless the configured endpoint confirms it.
import { h } from './dom.js';
import { CONTACT } from '../config/contact.js';
import { DEVELOPMENT, LOTS, findLot } from '../data/viva-lago.js';
import { hasAnyChannel, submitInquiry, validateInquiry } from '../core/inquiry.js';
import { lotLabel } from '../core/format.js';

let counter = 0;

/**
 * @param {HTMLElement} container
 * @param {{ lotId?: string|null, compact?: boolean, onSubmitted?: (result: object) => void }} options
 * @returns {{ setLot: (id: string|null) => void, element: HTMLElement }}
 */
export function mountInquiryForm(container, { lotId = null, compact = false, onSubmitted } = {}) {
  const uid = `iq${++counter}`;
  const configured = hasAnyChannel(CONTACT);
  let currentLot = lotId;

  const field = (name, label, input) => h('div', { class: 'field' }, h('label', { for: `${uid}-${name}` }, label), input, h('div', { class: 'error', id: `${uid}-${name}-err`, 'aria-live': 'polite' }));

  const lotSelect = h(
    'select',
    { id: `${uid}-lot`, name: 'lot' },
    h('option', { value: '' }, 'Sin lote específico'),
    ...['A', 'B', 'C', 'D'].map((block) =>
      h('optgroup', { label: `Manzana ${block} (ilustrativa)` }, ...LOTS.filter((l) => l.block === block).map((l) => h('option', { value: l.id }, `${lotLabel(l)} · ${l.id}`))),
    ),
  );
  lotSelect.value = currentLot || '';
  lotSelect.addEventListener('change', () => (currentLot = lotSelect.value || null));

  const name = h('input', { id: `${uid}-name`, name: 'name', autocomplete: 'name', required: true, 'aria-describedby': `${uid}-name-err` });
  const phone = h('input', { id: `${uid}-phone`, name: 'phone', type: 'tel', autocomplete: 'tel', inputmode: 'tel', 'aria-describedby': `${uid}-contact-err` });
  const email = h('input', { id: `${uid}-email`, name: 'email', type: 'email', autocomplete: 'email', 'aria-describedby': `${uid}-email-err` });
  const message = h('textarea', { id: `${uid}-message`, name: 'message', rows: compact ? 3 : 4, placeholder: 'Contanos qué te interesa saber (opcional)' });
  const status = h('div', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
  const submit = h('button', { class: 'btn', type: 'submit' }, configured ? 'Enviar consulta' : 'Preparar consulta', h('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'));

  const form = h(
    'form',
    { class: 'form', novalidate: true },
    configured
      ? null
      : h('p', { class: 'notice' }, 'El canal de contacto oficial todavía no está integrado en este sitio, así que este formulario no envía mensajes. Te preparamos la consulta para que la copies y la envíes por el canal oficial de Génesis.'),
    h('div', { class: 'row' }, field('name', 'Nombre', name), field('lot', 'Lote de interés', lotSelect)),
    h('div', { class: 'row' }, field('phone', 'Teléfono o WhatsApp', phone), field('email', 'Correo electrónico', email)),
    h('div', { class: 'error', id: `${uid}-contact-err`, 'aria-live': 'polite' }),
    field('message', 'Mensaje', message),
    h('div', {}, submit),
    status,
  );

  const showErrors = (errors) => {
    for (const key of ['name', 'email', 'contact']) {
      const el = form.querySelector(`#${uid}-${key}-err`);
      if (el) el.textContent = errors[key] || '';
    }
    name.setAttribute('aria-invalid', errors.name ? 'true' : 'false');
    email.setAttribute('aria-invalid', errors.email ? 'true' : 'false');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = { name: name.value, phone: phone.value, email: email.value, message: message.value, lotId: currentLot };
    const { valid, errors } = validateInquiry(payload);
    showErrors(errors);
    if (!valid) {
      (errors.name ? name : phone).focus();
      return;
    }
    submit.disabled = true;
    status.removeAttribute('data-tone');
    status.textContent = configured ? 'Enviando…' : '';
    const result = await submitInquiry(payload, CONTACT, { developmentName: DEVELOPMENT.name });
    submit.disabled = false;
    status.replaceChildren();
    if (result.status === 'sent') {
      status.dataset.tone = 'ok';
      status.append('Recibimos tu consulta. Un asesor de Génesis te va a contactar.');
      form.reset();
      lotSelect.value = currentLot || '';
    } else if (result.status === 'handoff') {
      window.open(result.url, '_blank', 'noopener');
      status.append(
        result.channel === 'whatsapp'
          ? 'Abrimos WhatsApp con tu consulta. El envío se completa desde WhatsApp.'
          : 'Abrimos tu correo con la consulta. El envío se completa desde tu aplicación de correo.',
      );
    } else if (result.status === 'not-configured') {
      const pre = h('pre', {}, result.text);
      const copy = h('button', { class: 'btn btn--ghost', type: 'button', style: { marginTop: '12px' } }, 'Copiar consulta');
      const copyStatus = h('span', { class: 'small', style: { marginLeft: '12px' }, 'aria-live': 'polite' });
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(result.text);
          copyStatus.textContent = 'Copiada.';
        } catch {
          copyStatus.textContent = 'No se pudo copiar automáticamente: seleccioná el texto.';
        }
      });
      status.append('Tu consulta no fue enviada: el canal oficial aún no está integrado. Este es el texto listo para enviar:', pre, copy, copyStatus);
    } else {
      status.dataset.tone = 'error';
      status.append(`No pudimos enviar la consulta (${result.error}). Probá nuevamente en unos minutos.`);
    }
    onSubmitted?.(result);
  });

  container.replaceChildren(form);
  return {
    element: form,
    setLot(id) {
      currentLot = id && findLot(id) ? id : null;
      lotSelect.value = currentLot || '';
    },
    focus() {
      name.focus();
    },
  };
}
