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
  const src = ['js/ui/inquiry-form.js', 'js/explorer.js', 'js/main.js', 'js/ui/shell.js', 'js/site.js', 'js/ui/team.js'].map((f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')).join('\n');
  for (const call of src.match(/track\([^)]*\)/g) || []) assert.doesNotMatch(call, /name\.value|phone|email|message/, call);
});

test('every page links the privacy policy and it exists', () => {
  for (const page of ['index.html', 'barrios.html', 'terrenos.html', 'viva-lago.html']) {
    const html = readFileSync(new URL(`../../${page}`, import.meta.url), 'utf8');
    assert.match(html, /href="privacidad\.html"/, page);
  }
  assert.match(readFileSync(new URL('../../privacidad.html', import.meta.url), 'utf8'), /Política de privacidad/);
});

test('the site is Génesis first: home → barrios privados → Viva Lago Country', () => {
  const read = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
  const home = read('index.html');
  assert.match(home, /<title>Génesis/);
  assert.match(home, /href="barrios\.html"[^>]*>[\s\S]*?Conocer barrios privados/);
  assert.match(read('barrios.html'), /href="viva-lago\.html"/);
  assert.match(home, /href="viva-lago\.html#lotes"[^>]*>[\s\S]*?Conocer nuestros lotes disponibles/);
  assert.match(home, /href="terrenos\.html"[^>]*>[\s\S]*?Conocer terrenos y futuras inversiones/);
  assert.match(home, /data-team/);
  assert.match(read('viva-lago.html'), /class="nav__back" href="barrios\.html"/);
  for (const f of ['index.html', 'barrios.html', 'terrenos.html']) assert.doesNotMatch(read(f), /USD|Gs\.? ?\d|\$ ?\d/, `${f} has no prices`);
});
