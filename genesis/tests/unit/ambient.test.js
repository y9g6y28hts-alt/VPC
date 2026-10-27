// Life in the scene keeps to plausible places: people and carts on the
// surveyed streets and the nautical access, crafts on open water clear of the
// shore, nothing drifting or turning into NaN as time passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Ambient } from '../../js/experience/world/ambient.js';
import { TerrainModel, WATER_LEVEL } from '../../js/experience/world/terrain.js';
import { ROADS, NAUTICAL_ACCESS, RIVER_EDGE, COMMON_AREAS } from '../../js/data/viva-lago.js';
import { pointInPolygon, distanceToPolyline } from '../../js/core/lot-layout.js';

const terrain = new TerrainModel();
const ring = (poly) => [...poly, poly[0]];
const nearArea = (p, poly, m) => pointInPolygon(p, poly) || distanceToPolyline(p, ring(poly)) <= m;

function run(settings, seconds = 120) {
  const amb = new Ambient({ terrain, settings });
  const seen = [];
  for (let t = 0; t < seconds; t += 0.25) {
    amb.update(0.25);
    for (const a of amb.agents) {
      const o = a.who?.[0] || a.mesh;
      seen.push({ kind: a.kind, x: o.position.x, y: o.position.y, z: o.position.z });
    }
  }
  return { amb, seen };
}

test('every kind of activity is present on capable devices, fewer on the low tier', () => {
  const kinds = (s) => new Set(new Ambient({ terrain, settings: s }).agents.map((a) => a.kind));
  assert.deepEqual([...kinds({ tier: 'high' })].sort(), ['boat', 'cart', 'fisher', 'jet', 'utv', 'walker']);
  const low = new Ambient({ terrain, settings: { tier: 'low' } });
  const high = new Ambient({ terrain, settings: { tier: 'high' } });
  assert.ok(low.agents.length < high.agents.length);
});

const CLUB = COMMON_AREAS.find((c) => c.id === 'club').polygon;

test('walkers and carts stay on the road parcel, the nautical access or the club grounds', () => {
  const { seen } = run({ tier: 'high' });
  for (const s of seen.filter((s) => s.kind === 'walker' || s.kind === 'cart')) {
    // Lanes sit inside the parcel; allow the width of a verge at the edges.
    // The access narrows to a line along the club's edge on its way to the water.
    assert.ok(nearArea(s, ROADS, 1.5) || nearArea(s, NAUTICAL_ACCESS, 1.5) || nearArea(s, CLUB, 1.5), `${s.kind} off the streets at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);
  }
});

test('jet skis and boats stay on open water, at least 20 m off the surveyed shore', () => {
  const { seen } = run({ tier: 'high' });
  const lake = terrain.lake;
  for (const s of seen.filter((s) => s.kind === 'jet' || s.kind === 'boat')) {
    assert.ok(pointInPolygon(s, lake), `${s.kind} out of the water at ${s.x.toFixed(1)}, ${s.z.toFixed(1)}`);
    assert.ok(distanceToPolyline(s, RIVER_EDGE) >= 20, `${s.kind} too close to the shore`);
    assert.ok(Math.abs(s.y - WATER_LEVEL) < 0.4, 'floats at the water line');
  }
});

test('positions stay finite over a long run', () => {
  const { seen } = run({ tier: 'high' }, 600);
  assert.ok(seen.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)));
});

test('with reduced motion nothing moves after the first pose', () => {
  const amb = new Ambient({ terrain, settings: { tier: 'high' }, reducedMotion: true });
  const before = amb.agents.map((a) => (a.who?.[0] || a.mesh).position.clone());
  for (let i = 0; i < 20; i++) amb.update(0.5);
  amb.agents.forEach((a, i) => assert.ok((a.who?.[0] || a.mesh).position.equals(before[i])));
  assert.equal(amb.animating, false);
});
