// Inquiry composition and submission. Submission only reports `sent` when the
// configured endpoint confirms it; hand-offs to WhatsApp or e-mail are reported
// as hand-offs because the site cannot know whether the user actually sent them.

export function availableChannels(contact) {
  return {
    endpoint: typeof contact?.inquiryEndpoint === 'string' && /^https:\/\//.test(contact.inquiryEndpoint),
    whatsapp: normaliseWhatsapp(contact?.whatsapp) !== null,
    email: typeof contact?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email),
  };
}

export function hasAnyChannel(contact) {
  const c = availableChannels(contact);
  return c.endpoint || c.whatsapp || c.email;
}

/** Digits-only international number (8–15 digits) or null. */
export function normaliseWhatsapp(value) {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/[\s()+-]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function whatsappUrl(number, text) {
  const n = normaliseWhatsapp(number);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

export function mailtoUrl(email, subject, body) {
  if (!availableChannels({ email }).email) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** How the visitor wants to be contacted, and what the conversation is for. */
export const CONTACT_PREFERENCES = Object.freeze({ whatsapp: 'WhatsApp', call: 'Llamada', email: 'Correo electrónico' });
export const INQUIRY_TOPICS = Object.freeze({ info: 'Recibir información del lote', visit: 'Coordinar una visita al predio', advisor: 'Conversar con un asesor', land: 'Terrenos y futuras inversiones' });

export function composeInquiryMessage({ developmentName, lotId, name, message, preferred, topic }) {
  const lines = [];
  lines.push(`Hola, soy ${name?.trim() || '(sin nombre)'}.`);
  if (lotId) lines.push(`Me interesa el lote ${lotId} de ${developmentName}.`);
  else if (topic === 'land') lines.push('Me interesan los terrenos y las futuras inversiones de Génesis.');
  else lines.push(`Me interesa ${developmentName}.`);
  if (INQUIRY_TOPICS[topic] && topic !== 'land') lines.push(`Motivo: ${INQUIRY_TOPICS[topic].toLowerCase()}.`);
  if (CONTACT_PREFERENCES[preferred]) lines.push(`Prefiero que me contacten por ${CONTACT_PREFERENCES[preferred].toLowerCase()}.`);
  if (message?.trim()) lines.push(message.trim());
  lines.push('Quisiera recibir información verificada sobre superficie, precio, disponibilidad y financiación.');
  return lines.join('\n');
}

export function validateInquiry({ name, phone, email, preferred }) {
  const errors = {};
  if (!name || name.trim().length < 2) errors.name = 'Ingresá tu nombre.';
  const hasPhone = typeof phone === 'string' && phone.replace(/\D/g, '').length >= 6;
  const hasEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!hasPhone && !hasEmail) errors.contact = 'Dejanos un teléfono o un correo para responderte.';
  else if ((preferred === 'whatsapp' || preferred === 'call') && !hasPhone) errors.contact = 'Para contactarte por WhatsApp o llamada necesitamos tu teléfono.';
  else if (preferred === 'email' && !hasEmail) errors.contact = 'Para responderte por correo necesitamos tu dirección de correo.';
  if (email && email.trim() && !hasEmail) errors.email = 'Revisá el formato del correo.';
  return { valid: Object.keys(errors).length === 0, errors };
}

/**
 * Submits an inquiry through the best available verified channel.
 * @returns {Promise<{ status: 'sent'|'handoff'|'not-configured'|'error', channel?: string, url?: string, error?: string }>}
 */
export async function submitInquiry(payload, contact, { fetchImpl = globalThis.fetch, developmentName } = {}) {
  const channels = availableChannels(contact);
  const text = composeInquiryMessage({ developmentName, ...payload });

  if (channels.endpoint) {
    try {
      const res = await fetchImpl(contact.inquiryEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...payload, developmentName, message: text }),
      });
      if (res && res.ok) return { status: 'sent', channel: 'endpoint' };
      return { status: 'error', channel: 'endpoint', error: `HTTP ${res?.status ?? '?'}` };
    } catch (err) {
      return { status: 'error', channel: 'endpoint', error: String(err?.message || err) };
    }
  }
  if (channels.whatsapp) {
    return { status: 'handoff', channel: 'whatsapp', url: whatsappUrl(contact.whatsapp, text) };
  }
  if (channels.email) {
    return { status: 'handoff', channel: 'email', url: mailtoUrl(contact.email, `Consulta ${developmentName}`, text) };
  }
  return { status: 'not-configured', text };
}
