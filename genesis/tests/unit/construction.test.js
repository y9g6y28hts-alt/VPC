import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildResidence } from '../../js/experience/house/residence.js';
import { ConstructionAnimator } from '../../js/experience/house/construction.js';
import { createMaterials } from '../../js/experience/materials.js';
import { CONSTRUCTION_STAGES } from '../../js/core/timeline.js';
import { lotShots, sunnySide } from '../../js/experience/camera-director.js';
import { findLot, LOTS } from '../../js/data/viva-lago.js';
import { sunDirection } from '../../js/experience/world/environment.js';

// Texture-less asset library: materials fall back to flat colours.
const assets = { textures: {}, tiled: () => null };
const lib = createMaterials(assets);
const residence = buildResidence(lib, null, { lawnDetail: true });
const byId = (id) => residence.components.find((c) => c.id === id);
const stage = (id) => CONSTRUCTION_STAGES.find((s) => s.id === id);

test('every component has a valid place on the construction clock', () => {
  assert.ok(residence.components.length > 40, `${residence.components.length} components`);
  for (const c of residence.components) {
    const [a, b] = c.build.window;
    assert.ok(a >= 0 && b <= 1 && a < b, `${c.id} build window ${a}..${b}`);
    if (c.remove) {
      const [ra, rb] = c.remove.window;
      assert.ok(ra >= b && ra < rb && rb <= 1, `${c.id} is removed after it is built`);
    }
    const s = stage(c.stage);
    assert.ok(s, `${c.id} belongs to a known stage (${c.stage})`);
    assert.ok(a >= s.start - 0.06 && a <= s.end + 0.06, `${c.id} starts within its stage (${a} vs ${s.start}..${s.end})`);
  }
});

test('trades follow a buildable order', () => {
  const start = (id) => byId(id).build.window[0];
  const end = (id) => byId(id).build.window[1];
  const order = ['ground-beams', 'column-bases', 'ground-slab', 'gf-columns', 'ff-beams', 'ff-slab', 'ff-columns', 'roof-slab', 'gf-brick', 'ff-brick', 'ff-render', 'copings', 'garage-door', 'driveway', 'lawn'];
  for (let i = 1; i < order.length; i++) assert.ok(start(order[i]) >= start(order[i - 1]), `${order[i - 1]} before ${order[i]}`);
  assert.ok(start('ff-slab') >= end('ff-shoring') - 1e-9, 'slab is poured on its formwork');
  assert.ok(byId('ff-shoring').remove.window[0] >= byId('ff-slab').cure.window[0], 'props are struck after curing starts');
  assert.ok(start('gf-columns') >= end('column-bases'), 'steel columns stand on their base plates');
  assert.ok(start('ff-slab') >= end('ff-beams'), 'the slab is poured on erected steel beams');
  assert.ok(byId('scaffold').remove.window[0] >= end('ff-render'), 'scaffold stays until the render is done');
  assert.ok(start('pool-water') >= end('pool-finish'), 'pool is tiled before it is filled');
});

test('nothing is built at t=0; at t=1 the house is complete and site equipment is gone', () => {
  const group = new THREE.Group();
  group.add(residence.group);
  const animator = new ConstructionAnimator(residence, lib);
  const visible = (c) => (c.holder ? c.holder.visible : c.meshes.every((m) => m.visible));
  animator.apply(0);
  for (const c of residence.components) if (!c.effect) assert.equal(visible(c), false, `${c.id} hidden at t=0`);
  animator.apply(1);
  const temporary = new Set(['setout', 'sand', 'bricks-delivered', 'ff-shoring', 'roof-shoring', 'scaffold']);
  for (const c of residence.components) {
    if (c.effect) continue;
    assert.equal(visible(c), !temporary.has(c.id), `${c.id} ${temporary.has(c.id) ? 'removed' : 'present'} at t=1`);
  }
  // Finished components use the shared materials again (no clipping left behind).
  for (const c of residence.components) {
    for (const m of c.meshes) if (m.visible) assert.equal(m.material, m.userData.baseMaterial, `${c.id} back on its shared material`);
  }
  assert.ok(lib.glass.emissiveIntensity > 0, 'interior light is on at completion');
  animator.apply(0.45);
  const wall = byId('gf-brick');
  assert.notEqual(wall.meshes[0].material, wall.meshes[0].userData.baseMaterial, 'masonry is mid-way and clipped');
  assert.ok(wall.plane.constant > 0, 'cut plane sits above the ground');
});

test('masonry rises in whole brick courses', () => {
  const animator = new ConstructionAnimator(residence, lib);
  const wall = byId('gf-brick');
  const heights = new Set();
  for (let t = wall.build.window[0]; t < wall.build.window[1]; t += 0.0013) {
    animator.apply(t);
    heights.add(+wall.plane.constant.toFixed(4));
  }
  for (const h of heights) {
    const courses = (h - wall.build.from) / wall.build.quantize;
    assert.ok(Math.abs(courses - Math.round(courses)) < 1e-3, `height ${h} is a whole number of courses`);
  }
});

test('the residence stays inside its lot (plus driveway and path across the verge)', () => {
  const box = new THREE.Box3().setFromObject(residence.group);
  // local space: x right, z = -d
  assert.ok(box.min.x >= -10 && box.max.x <= 10, `x ${box.min.x}..${box.max.x}`);
  assert.ok(-box.max.z >= -3.5 && -box.min.z <= 40, `d ${-box.max.z}..${-box.min.z}`);
  assert.ok(box.max.y < 9.5, 'two storeys plus parapet');
});

test('authored shots: eye-level reveal, cameras outside the house, sunny side preferred', () => {
  const sun = sunDirection();
  for (const id of ['A-02', 'B-05', 'C-03', 'D-03', 'E-12']) {
    const lot = findLot(id);
    const side = sunnySide(lot, sun);
    const shots = lotShots(lot, side, 16 / 9);
    assert.ok(shots.hero.position.y > 1.4 && shots.hero.position.y < 3.2, `${id} hero at eye level`);
    for (const [name, pose] of Object.entries(shots)) {
      if (name === 'orbitTarget') continue;
      // Convert back to lot space and make sure no camera sits inside the built volume.
      const dx = pose.position.x - lot.frame.origin.x;
      const dz = pose.position.z - lot.frame.origin.z;
      const x = dx * lot.frame.right.x + dz * lot.frame.right.z;
      const d = dx * lot.frame.inward.x + dz * lot.frame.inward.z;
      const k = lot.houseScale;
      const inside = x > -8 * k.x && x < 8 * k.x && d > 5 * k.z && d < 24.5 * k.z && pose.position.y < 8;
      assert.ok(!inside, `${id} ${name} camera is outside the house`);
    }
    const portrait = lotShots(lot, side, 9 / 16);
    assert.ok(portrait.hero.position.distanceTo(portrait.hero.target) > shots.hero.position.distanceTo(shots.hero.target), 'portrait pulls back');
  }
  assert.ok(LOTS.length > 0);
});
