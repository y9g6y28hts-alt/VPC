import test from 'node:test';
import assert from 'node:assert/strict';
import { filmFor } from '../../js/ui/cinema.js';
import { findLot, LOTS } from '../../js/data/viva-lago.js';

const manifest = {
  films: [
    { id: 'B-05', lot: 'B-05', lots: ['B-05'] },
    { id: 'E-07', lot: 'E-07', lots: ['E-07'] },
  ],
};

test('a lot with its own film gets it with the matched framing', () => {
  assert.deepEqual(filmFor(manifest, findLot('B-05'), findLot), { film: manifest.films[0], exact: true });
  assert.equal(filmFor(manifest, findLot('E-07'), findLot).exact, true);
});

test('other lots get the reference film of the most similar orientation', () => {
  // North row faces south like B-05; south row faces north like E-07.
  for (const id of ['B-04', 'B-06', 'B-08']) assert.equal(filmFor(manifest, findLot(id), findLot).film.lot, 'B-05', id);
  for (const id of ['E-04', 'E-09', 'E-11']) assert.equal(filmFor(manifest, findLot(id), findLot).film.lot, 'E-07', id);
  for (const lot of LOTS) {
    const m = filmFor(manifest, lot, findLot);
    assert.ok(m, lot.id);
    if (lot.id !== 'B-05' && lot.id !== 'E-07') assert.equal(m.exact, false, lot.id);
  }
});

test('no manifest, no film', () => {
  assert.equal(filmFor(null, findLot('B-05'), findLot), null);
  assert.equal(filmFor({ films: [] }, findLot('B-05'), findLot), null);
});
