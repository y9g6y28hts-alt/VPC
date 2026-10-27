import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availableChannels,
  hasAnyChannel,
  normaliseWhatsapp,
  whatsappUrl,
  composeInquiryMessage,
  validateInquiry,
  submitInquiry,
} from '../../js/core/inquiry.js';
import { CONTACT } from '../../js/config/contact.js';
import { lotDetailRows, formatArea, formatPrice, PENDING, ASK, lotLabel } from '../../js/core/format.js';

const NONE = { whatsapp: null, email: null, inquiryEndpoint: null };

test('the shipped configuration has no unverified channels', () => {
  assert.deepEqual(CONTACT, NONE);
  assert.equal(hasAnyChannel(CONTACT), false);
});

test('channel detection validates formats', () => {
  assert.deepEqual(availableChannels({ whatsapp: '+595 981 000000', email: 'x', inquiryEndpoint: 'http://insecure' }), {
    endpoint: false,
    whatsapp: true,
    email: false,
  });
  assert.equal(normaliseWhatsapp('123'), null);
  assert.equal(normaliseWhatsapp('+595 (981) 000-000'), '595981000000');
  assert.equal(whatsappUrl(null, 'hola'), null);
  assert.equal(whatsappUrl('595981000000', 'a b'), 'https://wa.me/595981000000?text=a%20b');
});

test('message carries the selected lot', () => {
  const text = composeInquiryMessage({ developmentName: 'Viva Lago Country', lotId: 'A-07', name: 'Ana', message: 'Hola' });
  assert.match(text, /lote A-07 de Viva Lago Country/);
  assert.match(text, /Ana/);
});

test('validation requires a name and one way to reply', () => {
  assert.equal(validateInquiry({ name: 'Ana', phone: '0981 123 456' }).valid, true);
  assert.equal(validateInquiry({ name: 'Ana', email: 'ana@example.com' }).valid, true);
  const bad = validateInquiry({ name: '', phone: '', email: 'nope' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.name && bad.errors.contact && bad.errors.email);
});

test('without a configured channel nothing is reported as sent', async () => {
  let called = false;
  const r = await submitInquiry({ name: 'Ana', lotId: 'A-01' }, NONE, {
    developmentName: 'Viva Lago Country',
    fetchImpl: () => {
      called = true;
    },
  });
  assert.equal(r.status, 'not-configured');
  assert.equal(called, false);
  assert.match(r.text, /A-01/);
});

test('endpoint: sent only on a 2xx response', async () => {
  const contact = { ...NONE, inquiryEndpoint: 'https://example.com/inquiry' };
  let body;
  const ok = await submitInquiry({ name: 'Ana', lotId: 'B-02' }, contact, {
    developmentName: 'X',
    fetchImpl: async (url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 201 };
    },
  });
  assert.equal(ok.status, 'sent');
  assert.equal(body.lotId, 'B-02');
  const fail = await submitInquiry({ name: 'Ana' }, contact, { developmentName: 'X', fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.deepEqual(fail, { status: 'error', channel: 'endpoint', error: 'HTTP 500' });
  const thrown = await submitInquiry({ name: 'Ana' }, contact, {
    developmentName: 'X',
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(thrown.status, 'error');
});

test('WhatsApp is a hand-off, not a confirmed send', async () => {
  const r = await submitInquiry({ name: 'Ana', lotId: 'C-01' }, { ...NONE, whatsapp: '595981000000' }, { developmentName: 'X' });
  assert.equal(r.status, 'handoff');
  assert.equal(r.channel, 'whatsapp');
  assert.match(r.url, /^https:\/\/wa\.me\/595981000000\?text=.*C-01/);
});

test('property rows never invent values', () => {
  const rows = lotDetailRows({ commercial: { areaM2: null, priceUSD: null, availability: null, financing: null } });
  assert.ok(rows.every((r) => r.pending));
  assert.equal(rows.find((r) => r.key === 'area').value, PENDING);
  // Prices are never shown on the site; availability only when documented.
  const lot = { commercial: { areaM2: 384, priceUSD: 99999, availability: null, financing: 'x' }, survey: { commonAreaM2: 235.32, totalAreaM2: 619.32, sharePct: 3.0966 }, frontage: 12, depth: 32 };
  const shown = lotDetailRows(lot);
  assert.ok(!shown.some((r) => /99/.test(r.value)), 'no price figure');
  assert.equal(shown.find((r) => r.key === 'price').value, ASK);
  assert.equal(shown.find((r) => r.key === 'availability').value, ASK);
  assert.equal(lotDetailRows({ ...lot, commercial: { ...lot.commercial, availability: 'sold' } }).find((r) => r.key === 'availability').value, 'Vendido');
  assert.equal(formatArea(812.4), `${(812).toLocaleString('es-PY')} m²`);
  assert.equal(formatPrice(-1), PENDING);
  assert.equal(lotLabel({ block: 'A', number: 7 }), 'Manzana A · Lote 7');
});

test('contact preference and topic travel with the inquiry and shape validation', () => {
  const text = composeInquiryMessage({ developmentName: 'Viva Lago Country', lotId: 'B-05', name: 'Ana', preferred: 'whatsapp', topic: 'visit' });
  assert.match(text, /lote B-05/);
  assert.match(text, /Motivo: coordinar una visita al predio\./);
  assert.match(text, /contacten por whatsapp\./);
  // Unknown values are ignored rather than echoed.
  assert.doesNotMatch(composeInquiryMessage({ developmentName: 'X', name: 'Ana', preferred: 'fax', topic: 'x' }), /Motivo|contacten/);
  assert.equal(validateInquiry({ name: 'Ana', email: 'ana@example.com', preferred: 'whatsapp' }).valid, false);
  assert.match(validateInquiry({ name: 'Ana', email: 'ana@example.com', preferred: 'call' }).errors.contact, /teléfono/);
  assert.equal(validateInquiry({ name: 'Ana', phone: '0981 123 456', preferred: 'email' }).valid, false);
  assert.equal(validateInquiry({ name: 'Ana', phone: '0981 123 456', preferred: 'whatsapp' }).valid, true);
});

