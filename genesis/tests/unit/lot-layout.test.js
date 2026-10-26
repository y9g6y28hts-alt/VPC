import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPath,
  layoutLots,
  polygonArea,
  pointInPolygon,
  convexIntersectionArea,
  distanceToPolyline,
  lotToWorld,
} from '../../js/core/lot-layout.js';
import { LOTS, ROADS, SITE, COMMON_AREAS, CONCEPT_FOOTPRINT, lakePolygon, DEVELOPMENT, findLot } from '../../js/data/viva-lago.js';
import { SURVEYED_LOTS } from '../../js/data/masterplan.js';

test('path is arc-length parametrised', () => {
  const p = createPath([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
  assert.ok(Math.abs(p.length - 100) < 1e-6);
  const mid = p.pointAt(50);
  assert.ok(Math.abs(mid.x - 50) < 0.2 && Math.abs(mid.z) < 1e-9);
  const n = p.normalAt(10, 1);
  assert.ok(Math.abs(n.x) < 1e-9 && Math.abs(n.z - 1) < 1e-9);
});

test('geometry helpers', () => {
  const sq = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }, { x: 0, z: 10 }];
  assert.equal(polygonArea(sq), 100);
  assert.ok(pointInPolygon({ x: 5, z: 5 }, sq));
  assert.ok(!pointInPolygon({ x: 15, z: 5 }, sq));
  const shifted = sq.map((p) => ({ x: p.x + 5, z: p.z }));
  assert.ok(Math.abs(convexIntersectionArea(sq, shifted) - 50) < 1e-9);
  const touching = sq.map((p) => ({ x: p.x + 10, z: p.z }));
  assert.ok(convexIntersectionArea(sq, touching) < 1e-9);
  assert.equal(distanceToPolyline({ x: 5, z: 3 }, [{ x: 0, z: 0 }, { x: 10, z: 0 }]), 3);
});

test('straight-road lots are 20 x 40 rectangles with a consistent frame', () => {
  const road = createPath([{ x: 0, z: 0 }, { x: 200, z: 0 }]);
  const lots = layoutLots(road, { side: 1, from: 0, to: 200, width: 20, depth: 40, setback: 5, block: 'T' });
  assert.equal(lots.length, 10);
  for (const lot of lots) {
    assert.ok(Math.abs(lot.sceneAreaM2 - 800) < 1);
    assert.ok(Math.abs(lot.frontage - 20) < 0.01);
    // A point 10 m into the lot is inside it; a point behind the frontage is not.
    assert.ok(pointInPolygon(lotToWorld(lot.frame, 0, 10), lot.polygon));
    assert.ok(!pointInPolygon(lotToWorld(lot.frame, 0, -1), lot.polygon));
    // polygon[0] is front-left seen from the street, polygon[1] front-right.
    const toRight = (p) => (p.x - lot.frame.origin.x) * lot.frame.right.x + (p.z - lot.frame.origin.z) * lot.frame.right.z;
    assert.ok(toRight(lot.polygon[0]) < 0 && toRight(lot.polygon[1]) > 0);
  }
  assert.deepEqual(lots.slice(0, 2).map((l) => l.id), ['T-01', 'T-02']);
});

test('frame rotation points an object front (+Z) at the street', () => {
  const road = createPath([{ x: 0, z: 0 }, { x: 100, z: 0 }]);
  const [lot] = layoutLots(road, { side: 1, from: 0, to: 20, width: 20, depth: 40, setback: 5, block: 'T' });
  // local +Z after rotation about Y by r is (sin r, cos r): must equal -inward.
  const r = lot.frame.rotationY;
  assert.ok(Math.abs(Math.sin(r) + lot.frame.inward.x) < 1e-9);
  assert.ok(Math.abs(Math.cos(r) + lot.frame.inward.z) < 1e-9);
  // local +X after rotation is (cos r, -sin r): must equal `right`.
  assert.ok(Math.abs(Math.cos(r) - lot.frame.right.x) < 1e-9);
  assert.ok(Math.abs(-Math.sin(r) - lot.frame.right.z) < 1e-9);
});

/** Points spread over a polygon's interior (for overlap tests on non-convex lots). */
function interiorSamples(poly, step = 1.5) {
  const xs = poly.map((p) => p.x);
  const zs = poly.map((p) => p.z);
  const out = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let z = Math.min(...zs) + step / 2; z < Math.max(...zs); z += step) {
      const p = { x, z };
      if (pointInPolygon(p, poly) && distanceToPolyline(p, [...poly, poly[0]]) > 0.3) out.push(p);
    }
  }
  return out;
}

// Cuadro de superficie of the plan (área propia, m²).
const PLAN_TOTALS = { A: 1106.98, B: 4236.24, C: 1688.96, D: 829.6, E: 4538.99 };

test('surveyed lots: the 32 lots of the plan, with its numbering and surfaces', () => {
  assert.equal(LOTS.length, 32);
  assert.equal(new Set(LOTS.map((l) => l.id)).size, LOTS.length);
  const counts = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((b) => [b, LOTS.filter((l) => l.block === b).length]));
  assert.deepEqual(counts, { A: 3, B: 11, C: 4, D: 2, E: 12 });
  for (const [block, total] of Object.entries(PLAN_TOTALS)) {
    const sum = LOTS.filter((l) => l.block === block).reduce((s, l) => s + l.commercial.areaM2, 0);
    assert.ok(Math.abs(sum - total) < 0.02, `manzana ${block}: ${sum.toFixed(2)} vs ${total}`);
  }
  const own = LOTS.reduce((s, l) => s + l.commercial.areaM2, 0);
  assert.ok(Math.abs(own - 12400.77) < 0.05, `área propia ${own}`);
  // The drawn polygons agree with the tabulated surfaces.
  for (const lot of LOTS) {
    const drawn = polygonArea(lot.polygon);
    assert.ok(Math.abs(drawn - lot.commercial.areaM2) / lot.commercial.areaM2 < 0.01, `${lot.id}: drawn ${drawn.toFixed(1)} vs ${lot.commercial.areaM2}`);
  }
  // Title boundary: 2 hectares.
  assert.ok(Math.abs(polygonArea(SITE) - 20000) < 60, `site ${polygonArea(SITE).toFixed(0)} m²`);
  assert.equal(SURVEYED_LOTS.length, 32);
});

test('surveyed lots: inside the site, no overlaps, off the roads and out of the lake', () => {
  const lake = lakePolygon();
  const samples = new Map(LOTS.map((l) => [l.id, interiorSamples(l.polygon)]));
  for (const lot of LOTS) {
    const pts = samples.get(lot.id);
    assert.ok(pts.length > 50, `${lot.id} sampled`);
    for (const p of pts) {
      assert.ok(pointInPolygon(p, SITE), `${lot.id} inside the title boundary`);
      assert.ok(!pointInPolygon(p, ROADS), `${lot.id} off the roads`);
      assert.ok(!pointInPolygon(p, lake), `${lot.id} out of the lake`);
    }
    for (const other of [...LOTS.filter((l) => l !== lot && Math.hypot(l.centroid.x - lot.centroid.x, l.centroid.z - lot.centroid.z) < 80), ...COMMON_AREAS]) {
      const hit = pts.find((p) => pointInPolygon(p, other.polygon));
      assert.ok(!hit, `${lot.id} overlaps ${other.id}`);
    }
  }
});

test('every lot faces a street, and the fitted residence stays inside it', () => {
  const roadRing = [...ROADS, ROADS[0]];
  for (const lot of LOTS) {
    // The frame starts at the street (moved in on curved fronts such as A-03).
    const front = lotToWorld(lot.frame, 0, 0);
    assert.ok(distanceToPolyline(front, roadRing) < 7.5, `${lot.id} front is on a street (${distanceToPolyline(front, roadRing).toFixed(2)} m)`);
    const k = lot.houseScale;
    assert.ok(k.x >= 0.35 && k.x <= 1 && k.z >= 0.35 && k.z <= 1, `${lot.id} scale ${k.x},${k.z}`);
    const { x0, x1, d0, d1 } = CONCEPT_FOOTPRINT;
    for (const [x, d] of [[x0, d0], [x1, d0], [x1, d1], [x0, d1], [0, d0], [0, d1]]) {
      const p = lotToWorld(lot.frame, x * k.x, d * k.z);
      assert.ok(pointInPolygon(p, lot.polygon), `${lot.id} contains footprint point ${x},${d}`);
    }
  }
});

test('data honesty: surveyed layout, no prices, availability only where documented', () => {
  assert.equal(DEVELOPMENT.dataStatus, 'surveyed');
  assert.equal(DEVELOPMENT.facts.lotCount, 32);
  assert.equal(DEVELOPMENT.facts.financing, null);
  for (const lot of LOTS) {
    assert.equal(lot.commercial.priceUSD, null);
    assert.equal(lot.commercial.financing, null);
    if (lot.commercial.availability) assert.ok(lot.commercial.availabilitySource, `${lot.id} availability has a source`);
  }
  assert.deepEqual(LOTS.filter((l) => l.commercial.availability).map((l) => [l.id, l.commercial.availability]), [['C-02', 'sold']]);
  assert.equal(findLot('B-05').id, 'B-05');
  assert.equal(findLot('nope'), null);
});
