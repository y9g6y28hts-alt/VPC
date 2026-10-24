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
import { LOTS, ROAD, lakeRoad, boulevard, lakePolygon, CONCEPT_RESIDENCE, DEVELOPMENT, findLot } from '../../js/data/viva-lago.js';

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

test('development lots: unique ids, no overlaps, clear of roads and lake', () => {
  assert.ok(LOTS.length >= 30, `has a meaningful number of lots (${LOTS.length})`);
  assert.equal(new Set(LOTS.map((l) => l.id)).size, LOTS.length);
  for (let i = 0; i < LOTS.length; i++) {
    for (let j = i + 1; j < LOTS.length; j++) {
      const overlap = convexIntersectionArea(LOTS[i].polygon, LOTS[j].polygon);
      assert.ok(overlap < 0.5, `${LOTS[i].id} overlaps ${LOTS[j].id} by ${overlap.toFixed(2)} m²`);
    }
  }
  const lake = lakePolygon();
  for (const lot of LOTS) {
    for (const p of lot.polygon) {
      assert.ok(distanceToPolyline(p, lakeRoad.points) >= ROAD.laneWidth / 2 + 1, `${lot.id} clear of the avenue`);
      assert.ok(distanceToPolyline(p, boulevard.points) >= ROAD.boulevardHalfWidth + 1, `${lot.id} clear of the boulevard`);
      assert.ok(!pointInPolygon(p, lake), `${lot.id} corner is not in the lake`);
    }
  }
});

test('the conceptual residence fits inside every lot', () => {
  const { width, depthFrom, depthTo } = CONCEPT_RESIDENCE.footprint;
  for (const lot of LOTS) {
    for (const [x, d] of [[-width / 2, depthFrom], [width / 2, depthFrom], [width / 2, depthTo], [-width / 2, depthTo]]) {
      assert.ok(pointInPolygon(lotToWorld(lot.frame, x, d), lot.polygon), `${lot.id} contains footprint corner ${x},${d}`);
    }
  }
});

test('data honesty: development is conceptual and no commercial value is invented', () => {
  assert.equal(DEVELOPMENT.dataStatus, 'conceptual');
  for (const v of Object.values(DEVELOPMENT.facts)) assert.equal(v, null);
  for (const lot of LOTS) {
    assert.deepEqual(lot.commercial, { areaM2: null, priceUSD: null, availability: null, financing: null });
  }
  assert.equal(findLot('A-01').id, 'A-01');
  assert.equal(findLot('nope'), null);
});
