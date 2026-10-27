// Company details on the home page: only what Génesis supplied is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { COMPANY, TEAM } from '../../js/config/company.js';
import { initials } from '../../js/ui/team.js';
import { composeInquiryMessage, INQUIRY_TOPICS } from '../../js/core/inquiry.js';

test('team members have a name, unique ids and, when set, a photo that exists', () => {
  assert.ok(TEAM.length > 0);
  assert.equal(new Set(TEAM.map((m) => m.id)).size, TEAM.length);
  for (const m of TEAM) {
    assert.ok(m.name && m.name.trim().split(/\s+/).length >= 2, `${m.id} has a full name`);
    if (m.photo) assert.ok(existsSync(new URL(`../../${m.photo}`, import.meta.url)), `${m.photo} exists`);
  }
});

test('the name is spelt as Génesis gave it', () => {
  assert.ok(TEAM.some((m) => m.name === 'Jinsu Annahas'));
});

test('monograms take the first letter of the first two names', () => {
  assert.equal(initials('Jinsu Annahas'), 'JA');
  assert.equal(initials('  maría  josé  pérez '), 'MJ');
});

test('office fields stay empty until supplied (no invented address)', () => {
  assert.equal(COMPANY.office.city, 'Ciudad del Este');
  assert.equal(COMPANY.office.address, null);
  assert.equal(COMPANY.office.mapsUrl, null);
});

test('a land inquiry is about Génesis, not a Viva Lago lot', () => {
  assert.ok(INQUIRY_TOPICS.land);
  const text = composeInquiryMessage({ developmentName: 'Viva Lago Country', name: 'Ana', topic: 'land' });
  assert.match(text, /terrenos y las futuras inversiones de Génesis/);
  assert.doesNotMatch(text, /Me interesa Viva Lago/);
});
