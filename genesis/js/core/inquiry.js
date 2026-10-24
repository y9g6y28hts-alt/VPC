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

export function composeInquiryMessage({ developmentName, lotId, name, message }) {
  const lines = [];
  lines.push(`Hola, soy ${name?.trim() || '(sin nombre)'}.`);
  if (lotId) lines.push(`Me interesa el lote ${lotId} de ${developmentName}.`);
  else lines.push(`Me interesa ${developmentName}.`);
  if (message?.trim()) lines.push(message.trim());
  lines.push('Quisiera recibir información verificada sobre superficie, precio, disponibilidad y financiación.');
  return lines.join('\n');
}

export function validateInquiry({ name, phone, email }) {
  const errors = {};
  if (!name || name.trim().length < 2) errors.name = 'Ingresá tu nombre.';
  const hasPhone = typeof phone === 'string' && phone.replace(/\D/g, '').length >= 6;
  const hasEmail = typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  if (!hasPhone && !hasEmail) errors.contact = 'Dejanos un teléfono o un correo para responderte.';
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
