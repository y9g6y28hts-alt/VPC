// Lot states from Génesis' system: only valid ids and states are applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAvailability, applyAvailability, availabilitySummary } from '../../js/core/availability.js';

const ids = ['A-01', 'B-05', 'C-02'];
const lots = () => ids.map((id) => ({ id, commercial: { availability: null, availabilitySource: null } }));

test('Spanish and English states are accepted; unknown lots and states are skipped', () => {
  const p = parseAvailability({ fuente: 'Sistema', actualizado: '2026-11-22T18:30:00-03:00', lotes: { 'c-02': 'Vendido', 'B-05': 'reserved', 'A-01': 'disponible', 'Z-99': 'vendido', 'A-02': 'quizás' } }, ids);
  assert.deepEqual([...p.states], [['C-02', 'sold'], ['B-05', 'reserved'], ['A-01', 'available']]);
  assert.equal(p.source, 'Sistema');
  assert.equal(p.updatedAt.toISOString(), '2026-11-22T21:30:00.000Z');
});

test('malformed documents are rejected, not half-applied', () => {
  for (const bad of [null, 'x', {}, { lotes: [] }, { lotes: 'C-02' }]) assert.equal(parseAvailability(bad, ids), null);
  assert.equal(parseAvailability({ lotes: {}, actualizado: 'ayer' }, ids).updatedAt, null);
});

test('applying writes state and source, and reports what changed', () => {
  const L = lots();
  const p = parseAvailability({ fuente: 'Sistema de Génesis', lotes: { 'C-02': 'vendido' } }, ids);
  assert.deepEqual(applyAvailability(L, p), ['C-02']);
  assert.equal(L[2].commercial.availability, 'sold');
  assert.equal(L[2].commercial.availabilitySource, 'Sistema de Génesis');
  assert.deepEqual(applyAvailability(L, p), [], 'no change the second time');
  assert.deepEqual(availabilitySummary(L), { sold: 1, reserved: 0, available: 0, unknown: 2 });
});

test('the shipped data/disponibilidad.json is valid and only carries ids and states', () => {
  const doc = JSON.parse(readFileSync(new URL('../../data/disponibilidad.json', import.meta.url), 'utf8'));
  const p = parseAvailability(doc, ids);
  assert.ok(p);
  assert.equal(p.states.get('C-02'), 'sold');
  assert.deepEqual(Object.keys(doc).sort(), ['actualizado', 'desarrollo', 'fuente', 'lotes']);
});
