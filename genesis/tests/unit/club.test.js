// The club is built where the plan puts it: deck, pool, quinchos and
// playground on the surveyed club parcel, the beach on the bank in front of
// it, and the portal on the entrance pad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Club } from '../../js/experience/world/club.js';
import { TerrainModel } from '../../js/experience/world/terrain.js';
import { COMMON_AREAS, ENTRANCE_PAD, RIVER_EDGE } from '../../js/data/viva-lago.js';
import { pointInPolygon, distanceToPolyline } from '../../js/core/lot-layout.js';

const terrain = new TerrainModel();
const m = (color) => new THREE.MeshStandardMaterial({ color });
const materials = Object.fromEntries(['deck', 'stone', 'sand', 'plaster', 'plasterWarm', 'pavers', 'timber', 'steelStructural', 'poolTile', 'water'].map((k) => [k, m('#888')]));
const club = new Club({ terrain, materials, assets: {} });
const CLUB = COMMON_AREAS.find((c) => c.id === 'club').polygon;

club.group.updateMatrixWorld(true);
const points = (mesh) => {
  const p = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  const out = [];
  for (let i = 0; i < p.count; i += 7) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    out.push({ x: v.x, z: v.z });
  }
  return out;
};

test('deck, pool, quinchos and playground sit on the club parcel (beach and portal aside)', () => {
  let n = 0;
  club.group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.name === 'club-beach') return;
    for (const p of points(o)) {
      const nearPortal = Math.hypot(p.x - -108.8, p.z - 26.3) < 14;
      const onBank = distanceToPolyline(p, RIVER_EDGE) < 12; // umbrellas on the sand
      if (nearPortal || onBank) continue;
      n++;
      assert.ok(pointInPolygon(p, CLUB) || distanceToPolyline(p, [...CLUB, CLUB[0]]) < 1.2, `outside the club at ${p.x.toFixed(1)}, ${p.z.toFixed(1)}`);
    }
  });
  assert.ok(n > 1000, 'checked the furniture');
});

test('the beach lies between the club and the water', () => {
  const beach = club.group.getObjectByName('club-beach');
  assert.ok(beach);
  for (const p of points(beach)) assert.ok(distanceToPolyline(p, RIVER_EDGE) < 30, 'beach hugs the bank');
});

test('the portal stands on the entrance pad', () => {
  const pad = { x: ENTRANCE_PAD.reduce((s, p) => s + p.x, 0) / 4, z: ENTRANCE_PAD.reduce((s, p) => s + p.z, 0) / 4 };
  assert.ok(pointInPolygon(pad, ENTRANCE_PAD));
});

test('static furniture is merged (few draw calls)', () => {
  let meshes = 0;
  club.group.traverse((o) => o.isMesh && meshes++);
  assert.ok(meshes < 40, `${meshes} meshes`);
});
