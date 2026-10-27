// Launch settings stay inert until Génesis supplies them: no analytics, no
// brochure, no WhatsApp link, no made-up contact data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE } from '../../js/config/site.js';
import { CONTACT } from '../../js/config/contact.js';
import { initAnalytics, track } from '../../js/core/track.js';

test('launch settings are empty until supplied', () => {
  assert.equal(SITE.siteUrl, null);
  assert.equal(SITE.analyticsId, null);
  assert.equal(SITE.brochureUrl, null);
  assert.equal(CONTACT.whatsapp, null);
});

test('analytics does nothing without a measurement id', () => {
  assert.equal(initAnalytics(), false);
  assert.doesNotThrow(() => track('select_lot', { lot: 'B-05' }));
});

test('tracked events never carry personal data', () => {
  const src = ['js/ui/inquiry-form.js', 'js/explorer.js', 'js/main.js'].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');
  for (const call of src.match(/track\([^)]*\)/g) || []) assert.doesNotMatch(call, /name\.value|phone|email|message/, call);
});

test('the page links the privacy policy and it exists', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /href="privacidad\.html"/);
  assert.match(readFileSync(new URL('../../privacidad.html', import.meta.url), 'utf8'), /Política de privacidad/);
});
