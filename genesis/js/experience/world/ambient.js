// Life in the scene: residents walking their dogs and jogging along the
// avenue and the nautical access, golf carts on the internal streets, UTVs on
// the red-earth streets outside, jet skis and boats on the Acaray with their
// wakes, and people fishing from the shore. Illustrative only (labelled as
// such in the UI): none of it states an amenity of the development.
//
// Everything is procedural and light: shared geometries, a handful of
// materials, simple keyframe-free cycles (walk, trot, bob, bank). Routes come
// from the surveyed road parcel (js/data/road-centerlines.js), the nautical
// access and the river edge.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD_CENTERLINES } from '../../data/road-centerlines.js';
import { NAUTICAL_ACCESS, OUTSIDE_STREETS, RIVER_EDGE } from '../../data/viva-lago.js';
import { pointInPolygon } from '../../core/lot-layout.js';
import { WATER_LEVEL } from './terrain.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ------------------------------------------------------------------ materials
function makeMaterials() {
  const m = (color, roughness = 0.7, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  return {
    skin: [m('#e0b393', 0.6), m('#c48e6a', 0.6), m('#8d5a3f', 0.6), m('#f0c8a8', 0.6)],
    hair: [m('#2b1d16', 0.8), m('#4a3020', 0.8), m('#151212', 0.8), m('#8a6a45', 0.8)],
    tops: ['#f2f2ee', '#1f3b5a', '#b8403a', '#2e6b57', '#e7c45a', '#6c4a8a', '#ef8a5a', '#3d3d42'].map((c) => m(c, 0.85)),
    bottoms: ['#23262d', '#3b4a63', '#d9d3c4', '#5a4b3a', '#1c1c1f'].map((c) => m(c, 0.85)),
    shoes: m('#f4f4f2', 0.6),
    dogs: ['#c99a5b', '#2a2622', '#e8dccb', '#8a5a33'].map((c) => m(c, 0.9)),
    cartBody: m('#f3f1ec', 0.35, 0, { envMapIntensity: 1.2 }),
    cartRoof: m('#e9e2d3', 0.6),
    seat: m('#6b4a33', 0.55),
    tire: m('#18181a', 0.9),
    hub: m('#b9bcc0', 0.35, 0.8),
    glass: new THREE.MeshPhysicalMaterial({ color: '#a8c4cc', roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }),
    utvBody: m('#3d4a2f', 0.55, 0.1),
    utvAccent: m('#1d1f22', 0.5, 0.4),
    frame: m('#202224', 0.45, 0.6),
    hullWhite: m('#f6f6f3', 0.25, 0, { envMapIntensity: 1.3 }),
    hullNavy: m('#1d2b45', 0.35),
    jetAccent: [m('#d6402f', 0.35), m('#1f6fb2', 0.35), m('#e2b13a', 0.35)],
    deck: m('#c9b99a', 0.7),
    rod: m('#2a2a2a', 0.4, 0.2),
    chair: m('#2f5d73', 0.7),
    // Additive foam: vertex colour fades it to nothing with age.
    baked: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04, envMapIntensity: 1.1 }),
    wake: new THREE.MeshBasicMaterial({ color: '#dfe8ea', transparent: true, opacity: 0.6, depthWrite: false, vertexColors: true, blending: THREE.AdditiveBlending }),
  };
}

const pick = (arr, k) => arr[((k % arr.length) + arr.length) % arr.length];

/**
 * Merges every mesh under `root` (except kept subtrees) into one
 * vertex-coloured mesh in root space: one draw call per rigid part instead of
 * one per primitive.
 */
function bakeInto(root, material, { keep = [], shadow = true } = {}) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const kept = new Set(keep);
  const isKept = (o) => {
    for (let p = o; p && p !== root; p = p.parent) if (kept.has(p)) return true;
    return false;
  };
  const parts = [];
  const drop = [];
  root.traverse((o) => {
    if (!o.isMesh || isKept(o)) return;
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!g.attributes.normal) g.computeVertexNormals();
    const n = g.attributes.position.count;
    const c = o.material.color || new THREE.Color(1, 1, 1);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', g.attributes.position);
    clean.setAttribute('normal', g.attributes.normal);
    clean.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(clean);
    drop.push(o);
  });
  if (!parts.length) return null;
  for (const o of drop) o.parent.remove(o);
  const mesh = new THREE.Mesh(mergeGeometries(parts), material);
  mesh.castShadow = shadow;
  root.add(mesh);
  return mesh;
}

// ------------------------------------------------------------------ people
const GEO = {
  limb: new THREE.CapsuleGeometry(0.062, 0.68, 4, 8).translate(0, -0.4, 0), // pivot at the hip
  arm: new THREE.CapsuleGeometry(0.045, 0.5, 4, 8).translate(0, -0.29, 0), // pivot at the shoulder
  torso: new THREE.CapsuleGeometry(0.155, 0.38, 4, 10),
  head: new THREE.SphereGeometry(0.105, 14, 10),
  hair: new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  shoe: new THREE.BoxGeometry(0.09, 0.06, 0.22).translate(0, -0.03, 0.04),
};

/** A stylised person (1.72 m) with hip and shoulder pivots for gait cycles. */
function person(mats, k) {
  const g = new THREE.Group();
  const top = pick(mats.tops, k * 3 + 1);
  const bottom = pick(mats.bottoms, k * 5 + 2);
  const skin = pick(mats.skin, k * 7);
  const mk = (geo, mat) => {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    return mesh;
  };
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  g.add(hips);
  const legs = [-1, 1].map((s) => {
    const leg = new THREE.Group();
    leg.position.set(0.09 * s, 0, 0);
    leg.add(mk(GEO.limb, bottom));
    const shoe = mk(GEO.shoe, mats.shoes);
    shoe.position.y = -0.86;
    leg.add(shoe);
    hips.add(leg);
    return leg;
  });
  const chest = new THREE.Group();
  hips.add(chest);
  const torso = mk(GEO.torso, top);
  torso.position.y = 0.36;
  chest.add(torso);
  const head = mk(GEO.head, skin);
  head.position.y = 0.75;
  chest.add(head);
  const hair = mk(GEO.hair, pick(mats.hair, k));
  hair.position.y = 0.765;
  chest.add(hair);
  const arms = [-1, 1].map((s) => {
    const arm = new THREE.Group();
    arm.position.set(0.21 * s, 0.56, 0);
    arm.rotation.z = 0.08 * s;
    arm.add(mk(GEO.arm, k % 3 ? top : skin));
    chest.add(arm);
    return arm;
  });
  g.userData = { hips, chest, legs, arms };
  return g;
}

/** A walking person: torso, two legs and two arms, each one mesh. */
function walkerPerson(mats, k) {
  const p = person(mats, k);
  const { chest, legs, arms } = p.userData;
  bakeInto(chest, mats.baked, { keep: arms });
  for (const l of legs) bakeInto(l, mats.baked, { shadow: false });
  for (const a of arms) bakeInto(a, mats.baked, { shadow: false });
  return p;
}

/** Walk / jog cycle: phase in radians, gait 0 (walk) … 1 (run). */
function gait(p, phase, run = 0) {
  const { hips, chest, legs, arms } = p.userData;
  const amp = 0.42 + 0.38 * run;
  legs[0].rotation.x = Math.sin(phase) * amp;
  legs[1].rotation.x = -Math.sin(phase) * amp;
  arms[0].rotation.x = -Math.sin(phase) * amp * (0.8 + 0.5 * run);
  arms[1].rotation.x = Math.sin(phase) * amp * (0.8 + 0.5 * run);
  // Elbows read as bent when running: the whole arm lifts forward a little.
  arms[0].rotation.x -= 0.35 * run;
  arms[1].rotation.x -= 0.35 * run;
  hips.position.y = 0.92 + Math.abs(Math.cos(phase)) * (0.025 + 0.05 * run);
  chest.rotation.x = 0.04 + 0.14 * run;
  chest.rotation.y = Math.sin(phase) * 0.06;
}

function seated(p) {
  const { hips, legs, arms } = p.userData;
  hips.position.y = 0.62;
  legs.forEach((l) => (l.rotation.x = -1.45));
  arms.forEach((a) => (a.rotation.x = -0.9));
}

// ------------------------------------------------------------------ dogs
const DOG = {
  body: new THREE.CapsuleGeometry(0.12, 0.42, 4, 10).rotateX(Math.PI / 2),
  head: new THREE.SphereGeometry(0.1, 12, 10),
  snout: new THREE.BoxGeometry(0.08, 0.07, 0.12),
  ear: new THREE.ConeGeometry(0.035, 0.08, 6),
  leg: new THREE.CapsuleGeometry(0.03, 0.24, 3, 6).translate(0, -0.15, 0),
  tail: new THREE.CapsuleGeometry(0.02, 0.22, 3, 6).translate(0, 0.12, 0),
};

function dog(mats, k, size = 1) {
  const g = new THREE.Group();
  const coat = pick(mats.dogs, k);
  const mk = (geo) => {
    const mesh = new THREE.Mesh(geo, coat);
    mesh.castShadow = true;
    return mesh;
  };
  const body = mk(DOG.body);
  body.position.y = 0.4;
  g.add(body);
  const head = mk(DOG.head);
  head.position.set(0, 0.55, 0.33);
  g.add(head);
  const snout = mk(DOG.snout);
  snout.position.set(0, 0.52, 0.44);
  g.add(snout);
  [-1, 1].forEach((s) => {
    const ear = mk(DOG.ear);
    ear.position.set(0.06 * s, 0.65, 0.31);
    g.add(ear);
  });
  const legs = [
    [-0.08, 0.2],
    [0.08, 0.2],
    [-0.08, -0.2],
    [0.08, -0.2],
  ].map(([x, z]) => {
    const leg = mk(DOG.leg);
    leg.position.set(x, 0.33, z);
    g.add(leg);
    return leg;
  });
  const tail = mk(DOG.tail);
  tail.position.set(0, 0.46, -0.28);
  tail.rotation.x = -0.8;
  g.add(tail);
  bakeInto(g, mats.baked, { keep: [...legs, tail] });
  g.scale.setScalar(size);
  g.userData = { legs, tail, head };
  return g;
}

function trot(d, phase) {
  const { legs, tail } = d.userData;
  legs[0].rotation.x = Math.sin(phase) * 0.6;
  legs[3].rotation.x = Math.sin(phase) * 0.6;
  legs[1].rotation.x = -Math.sin(phase) * 0.6;
  legs[2].rotation.x = -Math.sin(phase) * 0.6;
  tail.rotation.z = Math.sin(phase * 1.7) * 0.5;
}

// ------------------------------------------------------------------ vehicles
const wheelGeo = (r, w) => new THREE.CylinderGeometry(r, r, w, 18).rotateZ(Math.PI / 2);

function roundedBox(w, h, d, r) {
  const s = new THREE.Shape();
  const x = -d / 2;
  const y = 0;
  s.moveTo(x + r, y);
  s.lineTo(x + d - r, y);
  s.quadraticCurveTo(x + d, y, x + d, y + r);
  s.lineTo(x + d, y + h - r);
  s.quadraticCurveTo(x + d, y + h, x + d - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2); // length along +z
  return g;
}

function addWheels(g, mats, { r, w, x, z }) {
  const tire = wheelGeo(r, w);
  const hub = wheelGeo(r * 0.55, w + 0.01);
  const wheels = [];
  for (const sx of [-1, 1]) {
    for (const sz of z) {
      const wh = new THREE.Group();
      wh.position.set(x * sx, r, sz);
      wh.add(new THREE.Mesh(tire, mats.tire), new THREE.Mesh(hub, mats.hub));
      g.add(wh);
      bakeInto(wh, mats.baked);
      wheels.push(wh);
    }
  }
  return wheels;
}

function golfCart(mats, k) {
  const g = new THREE.Group();
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  mesh(roundedBox(1.14, 0.42, 2.3, 0.12), mats.cartBody, 0, 0.22, 0);
  mesh(roundedBox(1.1, 0.42, 0.62, 0.16), mats.cartBody, 0, 0.6, 0.78); // front cowl
  mesh(new THREE.BoxGeometry(1.0, 0.12, 0.55), mats.seat, 0, 0.72, -0.15);
  mesh(new THREE.BoxGeometry(1.0, 0.5, 0.1), mats.seat, 0, 1.0, -0.42);
  mesh(new THREE.BoxGeometry(1.2, 0.05, 1.9), mats.cartRoof, 0, 1.86, 0.05);
  for (const [x, z] of [[-0.52, 0.72], [0.52, 0.72], [-0.52, -0.5], [0.52, -0.5]]) mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.0, 8), mats.frame, x, 1.36, z);
  const ws = mesh(new THREE.PlaneGeometry(1.05, 0.62), mats.glass, 0, 1.38, 0.74);
  ws.rotation.x = -0.12;
  ws.castShadow = false;
  const wheels = addWheels(g, mats, { r: 0.23, w: 0.18, x: 0.5, z: [0.78, -0.72] });
  const driver = person(mats, k + 11);
  seated(driver);
  driver.position.set(-0.24, 0.12, -0.12);
  g.add(driver);
  if (k % 2) {
    const passenger = person(mats, k + 23);
    seated(passenger);
    passenger.position.set(0.24, 0.12, -0.12);
    g.add(passenger);
  }
  bakeInto(g, mats.baked, { keep: [...wheels, ws] });
  g.userData = { wheels, radius: 0.23 };
  return g;
}

function utv(mats, k) {
  const g = new THREE.Group();
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  mesh(roundedBox(1.4, 0.5, 2.9, 0.14), mats.utvBody, 0, 0.42, 0);
  const hood = mesh(roundedBox(1.36, 0.36, 0.9, 0.14), mats.utvBody, 0, 0.88, 0.92);
  hood.rotation.x = 0.12;
  mesh(new THREE.BoxGeometry(1.3, 0.35, 0.8), mats.utvAccent, 0, 1.0, -1.0); // bed
  mesh(new THREE.BoxGeometry(1.1, 0.14, 0.6), mats.seat, 0, 0.98, -0.05);
  // Roll cage.
  const tube = (a, b) => {
    const path = new THREE.LineCurve3(a, b);
    mesh(new THREE.TubeGeometry(path, 1, 0.03, 6), mats.frame, 0, 0, 0);
  };
  for (const s of [-1, 1]) {
    tube(V(0.62 * s, 0.9, 0.55), V(0.55 * s, 1.95, 0.2));
    tube(V(0.55 * s, 1.95, 0.2), V(0.55 * s, 1.95, -0.55));
    tube(V(0.55 * s, 1.95, -0.55), V(0.62 * s, 0.9, -0.62));
  }
  tube(V(-0.55, 1.95, 0.2), V(0.55, 1.95, 0.2));
  tube(V(-0.55, 1.95, -0.55), V(0.55, 1.95, -0.55));
  const wheels = addWheels(g, mats, { r: 0.36, w: 0.28, x: 0.72, z: [1.0, -0.95] });
  const driver = person(mats, k + 5);
  seated(driver);
  driver.position.set(-0.28, 0.42, -0.05);
  g.add(driver);
  bakeInto(g, mats.baked, { keep: wheels });
  g.userData = { wheels, radius: 0.36 };
  return g;
}

function hull(length, beam, height, bowRatio = 0.38) {
  // Top view: a pointed bow and a square transom, extruded upwards.
  const s = new THREE.Shape();
  const h = beam / 2;
  const L = length / 2;
  s.moveTo(-h, -L);
  s.lineTo(h, -L);
  s.lineTo(h, L - length * bowRatio);
  s.quadraticCurveTo(h, L - length * 0.06, 0, L);
  s.quadraticCurveTo(-h, L - length * 0.06, -h, L - length * bowRatio);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 10 });
  g.rotateX(-Math.PI / 2); // extrude up, bow towards -z… flip to +z below
  g.rotateY(Math.PI);
  return g;
}

function jetSki(mats, k) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(hull(3.1, 1.12, 0.42, 0.42), mats.hullWhite);
  body.castShadow = true;
  g.add(body);
  const accent = new THREE.Mesh(hull(2.4, 1.0, 0.18, 0.5), pick(mats.jetAccent, k));
  accent.position.set(0, 0.42, 0.25);
  g.add(accent);
  const seat = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 1.0, 4, 8).rotateX(Math.PI / 2), mats.hullNavy);
  seat.position.set(0, 0.62, -0.45);
  g.add(seat);
  const column = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.3), pick(mats.jetAccent, k));
  column.position.set(0, 0.74, 0.35);
  column.rotation.x = -0.4;
  g.add(column);
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.75, 8).rotateZ(Math.PI / 2), mats.frame);
  bar.position.set(0, 0.95, 0.28);
  g.add(bar);
  const rider = person(mats, k + 31);
  seated(rider);
  rider.userData.legs.forEach((l) => (l.rotation.x = -1.0));
  rider.userData.arms.forEach((a) => (a.rotation.x = -1.25));
  rider.userData.chest.rotation.x = 0.35;
  rider.position.set(0, 0.2, -0.35);
  g.add(rider);
  bakeInto(g, mats.baked);
  return g;
}

function boat(mats, k) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(hull(6.6, 2.35, 0.95, 0.4), mats.hullWhite);
  body.castShadow = true;
  g.add(body);
  const stripe = new THREE.Mesh(hull(6.66, 2.4, 0.14, 0.4), k % 2 ? mats.hullNavy : pick(mats.jetAccent, k));
  stripe.position.y = 0.55;
  g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 3.6), mats.deck);
  deck.position.set(0, 0.97, -0.6);
  g.add(deck);
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.85, 0.6), mats.hullWhite);
  console_.position.set(0, 1.35, 0.5);
  console_.castShadow = true;
  g.add(console_);
  const ws = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.45), mats.glass);
  ws.position.set(0, 1.95, 0.85);
  ws.rotation.x = -0.5;
  g.add(ws);
  const helm = person(mats, k + 41);
  seated(helm);
  helm.position.set(-0.25, 0.75, -0.1);
  g.add(helm);
  const guest = person(mats, k + 47);
  seated(guest);
  guest.position.set(0.5, 0.75, -1.6);
  guest.rotation.y = 0.6;
  g.add(guest);
  bakeInto(g, mats.baked, { keep: [ws] });
  return g;
}

// ------------------------------------------------------------------ wakes
/** A foam ribbon behind a craft: widens and fades with age. */
class Wake {
  constructor(material, { segments = 46, width = 1.2, spread = 0.9, life = 6 }) {
    this.n = segments;
    this.width = width;
    this.spread = spread;
    this.life = life;
    this.points = [];
    const pos = new Float32Array(segments * 2 * 3);
    const col = new Float32Array(segments * 2 * 3);
    const idx = [];
    for (let i = 0; i < segments - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'wake';
  }

  update(p, dir, now, speed) {
    const last = this.points[0];
    if (!last || now - last.t > 0.12) this.points.unshift({ x: p.x, z: p.z, dx: dir.x, dz: dir.z, t: now, s: speed });
    if (this.points.length > this.n) this.points.length = this.n;
    const pos = this.mesh.geometry.attributes.position;
    const col = this.mesh.geometry.attributes.color;
    for (let i = 0; i < this.n; i++) {
      const q = this.points[Math.min(i, this.points.length - 1)];
      const age = Math.min(1, (now - q.t) / this.life);
      const w = (this.width + this.spread * age * 6) * Math.min(1, q.s / 6);
      const nx = -q.dz;
      const nz = q.dx;
      const y = WATER_LEVEL + 0.03;
      pos.setXYZ(i * 2, q.x + nx * w, y, q.z + nz * w);
      pos.setXYZ(i * 2 + 1, q.x - nx * w, y, q.z - nz * w);
      const a = (1 - age) * (1 - age) * (i === 0 ? 0 : 1);
      col.setXYZ(i * 2, a, a, a);
      col.setXYZ(i * 2 + 1, a, a, a);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ routes
function chain(lines) {
  // Joins polylines end to end, orienting each to start where the last ended.
  const out = [...lines[0]];
  for (const l of lines.slice(1)) {
    const end = out[out.length - 1];
    const d0 = Math.hypot(l[0].x - end.x, l[0].z - end.z);
    const d1 = Math.hypot(l[l.length - 1].x - end.x, l[l.length - 1].z - end.z);
    const seg = d0 <= d1 ? l : [...l].reverse();
    out.push(...seg.slice(1));
  }
  return out;
}

function densify(points, step = 2) {
  // Extra points along straight runs so the spline hugs them and only rounds corners.
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 1; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  return out;
}

function trim(points, metres) {
  // Shortens a polyline at both ends (dead ends stop short of the boundary).
  const curve = new THREE.CatmullRomCurve3(densify(points).map((p) => V(p.x, 0, p.z)), false, 'centripetal');
  const L = curve.getLength();
  const n = Math.max(8, Math.round(L / 2));
  const res = [];
  for (let i = 0; i <= n; i++) {
    const u = (metres + ((L - 2 * metres) * i) / n) / L;
    const p = curve.getPointAt(Math.min(1, Math.max(0, u)));
    res.push({ x: p.x, z: p.z });
  }
  return res;
}

/** A route travelled back and forth, keeping to the right of travel. */
class Shuttle {
  constructor(points, { speed, lane = 0, pause = 1.5, offset = 0 }) {
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => V(p.x, 0, p.z)), false, 'centripetal');
    this.length = this.curve.getLength();
    this.speed = speed;
    this.lane = lane;
    this.pause = pause;
    this.s = offset * this.length;
    this.dir = 1;
    this.wait = 0;
    this.heading = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.moving = true;
  }

  step(dt) {
    if (this.wait > 0) {
      this.wait -= dt;
      this.moving = false;
    } else {
      this.moving = true;
      this.s += this.dir * this.speed * dt;
      if (this.s > this.length || this.s < 0) {
        this.s = Math.min(this.length, Math.max(0, this.s));
        this.dir *= -1;
        this.wait = this.pause;
      }
    }
    const u = this.s / this.length;
    const p = this.curve.getPointAt(u);
    const t = this.curve.getTangentAt(u).multiplyScalar(this.dir);
    this.heading.copy(t);
    // Right of travel (y up): forward × up = (−t.z, 0, t.x).
    this.pos.set(p.x - t.z * this.lane, 0, p.z + t.x * this.lane);
    return this.pos;
  }
}

/** A closed loop on the water, travelled at constant speed. */
class Loop {
  constructor(points, speed, offset = 0) {
    this.curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
    this.length = this.curve.getLength();
    this.speed = speed;
    this.s = offset * this.length;
    this.heading = new THREE.Vector3();
    this.prevHeading = new THREE.Vector3();
    this.turn = 0;
  }

  step(dt) {
    this.s = (this.s + this.speed * dt) % this.length;
    const u = this.s / this.length;
    const p = this.curve.getPointAt(u);
    this.prevHeading.copy(this.heading);
    this.heading.copy(this.curve.getTangentAt(u));
    if (dt > 0 && this.prevHeading.lengthSq() > 0) {
      const yaw = Math.atan2(this.heading.x, this.heading.z) - Math.atan2(this.prevHeading.x, this.prevHeading.z);
      const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      this.turn += (wrapped / dt - this.turn) * Math.min(1, dt * 3);
    }
    return p;
  }
}

function waterLoop(cx, cz, rx, rz, rot, wobble = 0.12, n = 14, seed = 1) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + wobble * Math.sin(a * 3 + seed) + wobble * 0.5 * Math.sin(a * 5 + seed * 2.1);
    const x = Math.cos(a) * rx * k;
    const z = Math.sin(a) * rz * k;
    pts.push(V(cx + x * Math.cos(rot) - z * Math.sin(rot), 0, cz + x * Math.sin(rot) + z * Math.cos(rot)));
  }
  return pts;
}

// ------------------------------------------------------------------ ambient
export class Ambient {
  /**
   * @param {{ terrain: import('./terrain.js').TerrainModel, settings: { tier: string }, reducedMotion?: boolean }} o
   */
  constructor({ terrain, settings, reducedMotion = false }) {
    this.terrain = terrain;
    this.reducedMotion = reducedMotion;
    this.group = new THREE.Group();
    this.group.name = 'ambient';
    this.mats = makeMaterials();
    this.agents = [];
    this.time = 0;
    const low = settings.tier === 'low';
    this._people(low);
    this._vehicles(low);
    this._water(low);
    this._fishing(low);
    // Place everything once (also the static pose with reduced motion).
    this.update(0.016);
  }

  /** True while agents move (the experience keeps drawing frames). */
  get animating() {
    return !this.reducedMotion && this.group.visible;
  }

  ground(x, z) {
    return this.terrain.sample(x, z).h;
  }

  // Avenue, curved streets and the nautical access: walkers, joggers, dogs.
  _people(low) {
    const C = ROAD_CENTERLINES;
    const avenue = trim(C[0], 3);
    // The curved streets end obliquely on the site boundary: turn well before it.
    const eastArc = trim(chain([C[1], C[2]]), 8);
    const westArc = trim(chain([C[4], C[3], C[5]]), 8);
    const n = NAUTICAL_ACCESS;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
    const access = trim([C[0][C[0].length - 1], mid(n[5], n[0]), mid(n[1], n[3]), { x: n[2].x - 4, z: n[2].z - 4 }], 1);
    const specs = [
      { route: avenue, lane: 3.9, speed: 1.25, dog: true, off: 0.1 },
      { route: avenue, lane: 3.9, speed: 1.15, off: 0.55 },
      { route: avenue, lane: 4.1, speed: 2.9, run: 1, off: 0.8 },
      { route: avenue, lane: 3.7, speed: 1.3, dog: true, off: 0.35, pair: true },
      { route: eastArc, lane: 2.4, speed: 1.2, dog: true, off: 0.3 },
      { route: westArc, lane: 2.4, speed: 2.7, run: 1, off: 0.6 },
      // The access narrows to a line along the club on its way to the water:
      // walkers keep to its middle.
      { route: access, lane: 0, speed: 1.2, dog: true, off: 0.2 },
      { route: access, lane: 0, speed: 2.8, run: 1, off: 0.7 },
      { route: access, lane: 0, speed: 1.1, off: 0.45 },
    ];
    specs.slice(0, low ? 5 : specs.length).forEach((sp, i) => {
      const walker = new Shuttle(sp.route, { speed: sp.speed, lane: sp.lane, pause: 2.5, offset: sp.off });
      const who = [walkerPerson(this.mats, i * 3 + 1)];
      if (sp.pair) who.push(walkerPerson(this.mats, i * 3 + 2));
      who.forEach((p) => this.group.add(p));
      const d = sp.dog ? dog(this.mats, i, 0.8 + 0.4 * ((i * 37) % 10) / 10) : null;
      let leash = null;
      if (d) {
        this.group.add(d);
        leash = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: '#2a2a2a' }));
        leash.frustumCulled = false;
        this.group.add(leash);
      }
      this.agents.push({
        kind: 'walker',
        walker,
        who,
        dog: d,
        leash,
        run: sp.run || 0,
        phase: i * 1.7,
        update: (a, dt) => {
          const p = a.walker.step(dt);
          const h = a.walker.heading;
          const yaw = Math.atan2(h.x, h.z);
          const stride = a.run ? 1.15 : 0.72;
          if (a.walker.moving) a.phase += (dt * a.walker.speed * Math.PI) / stride;
          a.who.forEach((pp, k) => {
            const side = k === 0 ? 0 : 0.6;
            const x = p.x - h.z * side;
            const z = p.z + h.x * side;
            pp.position.set(x, this.ground(x, z), z);
            pp.rotation.y = yaw;
            gait(pp, a.walker.moving ? a.phase + k * 0.4 : 0, a.run);
          });
          if (a.dog) {
            // The dog trots ahead, on the inner side, at the end of its leash.
            const x = p.x + h.x * 1.1 + h.z * 0.5;
            const z = p.z + h.z * 1.1 - h.x * 0.5;
            a.dog.position.set(x, this.ground(x, z), z);
            a.dog.rotation.y = yaw;
            trot(a.dog, a.walker.moving ? a.phase * 1.6 : 0);
            const hand = a.who[0].userData.arms[0];
            const handPos = new THREE.Vector3(0, -0.55, 0);
            a.who[0].updateMatrixWorld(true);
            hand.localToWorld(handPos);
            const collar = new THREE.Vector3(0, 0.5, 0.28);
            a.dog.updateMatrixWorld(true);
            a.dog.localToWorld(collar);
            a.leash.geometry.setFromPoints([handPos, collar]);
          }
        },
      });
    });
  }

  // Golf carts on the internal streets, UTVs on the red-earth streets outside.
  _vehicles(low) {
    const C = ROAD_CENTERLINES;
    const routes = [
      trim(chain([C[4], C[0], C[2]]), 5),
      trim(chain([C[5], C[3], C[0], C[1]]), 5),
    ];
    routes.slice(0, low ? 1 : 2).forEach((route, i) => {
      const cart = golfCart(this.mats, i);
      this.group.add(cart);
      this.agents.push({
        kind: 'cart',
        mover: new Shuttle(route, { speed: 4.2 + i * 0.6, lane: 1.6, pause: 4, offset: 0.25 + i * 0.4 }),
        mesh: cart,
        update: (a, dt) => this._drive(a, dt),
      });
    });
    if (low) return;
    OUTSIDE_STREETS.forEach((st, i) => {
      const [a, b] = st.points;
      // The stretch of street in view of the site.
      const from = i === 0 ? 0.42 : 0.3;
      const to = i === 0 ? 0.96 : 0.62;
      const lerp = (t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
      const route = Array.from({ length: 12 }, (_, k) => lerp(from + ((to - from) * k) / 11));
      const v = utv(this.mats, i);
      this.group.add(v);
      this.agents.push({ kind: 'utv', mover: new Shuttle(route, { speed: 7.5, lane: 1.8, pause: 3, offset: 0.2 + 0.5 * i }), mesh: v, update: (ag, dt) => this._drive(ag, dt) });
    });
  }

  _drive(a, dt) {
    const p = a.mover.step(dt);
    const h = a.mover.heading;
    const m = a.mesh;
    const y = this.ground(p.x, p.z);
    m.position.set(p.x, y, p.z);
    // Follow the slope: look at the ground a little ahead.
    const ahead = this.ground(p.x + h.x * 1.2, p.z + h.z * 1.2);
    const target = new THREE.Vector3(p.x + h.x, y + (ahead - y) / 1.2, p.z + h.z);
    m.lookAt(target);
    if (a.mover.moving) for (const w of m.userData.wheels) w.rotation.x += (a.mover.speed * dt) / m.userData.radius;
  }

  // Jet skis and boats in front of the club, on open water.
  _water(low) {
    const crafts = [
      // In front of the development, 25–150 m off the surveyed river edge.
      { kind: 'jet', loop: waterLoop(150, -60, 50, 30, 0.6, 0.18, 14, 1), speed: 13, off: 0 },
      { kind: 'jet', loop: waterLoop(210, 10, 45, 24, 0.7, 0.22, 14, 2.5), speed: 15, off: 0.4 },
      { kind: 'boat', loop: waterLoop(260, -120, 140, 60, 0.4, 0.08, 16, 4), speed: 9, off: 0.15 },
      { kind: 'boat', loop: waterLoop(430, -30, 150, 80, 0.3, 0.06, 16, 7), speed: 6, off: 0.6 },
    ];
    // Keep only loops that stay on open water, clear of the shore.
    const lake = this.terrain.lake;
    const clear = (v) => pointInPolygon({ x: v.x, z: v.z }, lake) && this.terrain.sample(v.x, v.z).h < WATER_LEVEL - 0.5;
    crafts.slice(0, low ? 2 : crafts.length).forEach((c, i) => {
      if (!c.loop.every(clear)) return;
      const mesh = c.kind === 'jet' ? jetSki(this.mats, i) : boat(this.mats, i);
      this.group.add(mesh);
      const wake = new Wake(this.mats.wake, c.kind === 'jet' ? { width: 0.55, spread: 0.5, life: 5 } : { width: 1.1, spread: 0.8, life: 8 });
      this.group.add(wake.mesh);
      this.agents.push({
        kind: c.kind,
        mover: new Loop(c.loop, c.speed, c.off),
        mesh,
        wake,
        seed: i * 2.3,
        update: (a, dt) => {
          const p = a.mover.step(dt);
          const h = a.mover.heading;
          const t = this.time + a.seed;
          const m = a.mesh;
          m.position.set(p.x, WATER_LEVEL - 0.12 + Math.sin(t * 1.9) * 0.04, p.z);
          m.rotation.set(0, 0, 0);
          m.rotation.y = Math.atan2(h.x, h.z);
          // Bow up under power, roll into the turns, a little chop.
          m.rotateX(-(a.kind === 'jet' ? 0.07 : 0.1) + Math.sin(t * 2.3) * 0.015);
          m.rotateZ(THREE.MathUtils.clamp(-a.mover.turn * (a.kind === 'jet' ? 2.2 : 0.9), -0.45, 0.45) + Math.sin(t * 1.7) * 0.02);
          a.wake.update(p, h, this.time, a.mover.speed);
        },
      });
    });
  }

  // People fishing from the bank at the end of the nautical access.
  _fishing(low) {
    const end = NAUTICAL_ACCESS[2];
    // River-edge points near the end of the access, and the shore normal.
    const edge = RIVER_EDGE.map((p, i) => ({ p, i })).sort((a, b) => Math.hypot(a.p.x - end.x, a.p.z - end.z) - Math.hypot(b.p.x - end.x, b.p.z - end.z))[0].i;
    const count = low ? 1 : 3;
    for (let k = 0; k < count; k++) {
      const a = RIVER_EDGE[Math.max(0, edge - 1 - k)];
      const b = RIVER_EDGE[Math.max(1, edge - k)];
      const tx = b.x - a.x;
      const tz = b.z - a.z;
      const l = Math.hypot(tx, tz) || 1;
      // Water lies east of the edge: pick the normal pointing to the water.
      let nx = tz / l;
      let nz = -tx / l;
      if (nx < 0) {
        nx = -nx;
        nz = -nz;
      }
      const x = (a.x + b.x) / 2 - nx * 2.2;
      const z = (a.z + b.z) / 2 - nz * 2.2;
      const p = person(this.mats, 60 + k);
      const y = this.ground(x, z);
      p.position.set(x, y, z);
      p.rotation.y = Math.atan2(nx, nz);
      const seatedFisher = k === 1;
      if (seatedFisher) {
        seated(p);
        const chair = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.45), this.mats.chair);
        chair.position.set(x, y + 0.45, z);
        chair.rotation.y = p.rotation.y;
        this.group.add(chair);
      }
      const { arms } = p.userData;
      arms[0].rotation.x = -1.1;
      arms[1].rotation.x = -0.9;
      // Rod: a slender bent tube from the hands out over the water.
      const rod = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V(0, 0, 0), V(0, 1.2, 1.4), V(0, 1.6, 3.0)), 12, 0.012, 5),
        this.mats.rod,
      );
      rod.position.set(0.12, seatedFisher ? 0.95 : 1.25, 0.45);
      p.add(rod);
      bakeInto(p, this.mats.baked, { keep: [rod] });
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(), V()]), new THREE.LineBasicMaterial({ color: '#d8d8d8', transparent: true, opacity: 0.6 }));
      line.frustumCulled = false;
      this.group.add(p, line);
      this.agents.push({
        kind: 'fisher',
        mesh: p,
        rod,
        line,
        seed: k * 1.3,
        update: (ag) => {
          const t = this.time + ag.seed;
          ag.rod.rotation.x = Math.sin(t * 0.9) * 0.04 - 0.05;
          const tip = V(0, 1.6, 3.0);
          ag.mesh.updateMatrixWorld(true);
          ag.rod.localToWorld(tip);
          const fx = tip.x + nx * 7;
          const fz = tip.z + nz * 7;
          ag.line.geometry.setFromPoints([tip, V(fx, WATER_LEVEL + Math.sin(t * 2) * 0.02, fz)]);
        },
      });
    }
  }

  update(dt) {
    if (this.reducedMotion && this.time > 0) return;
    this.time += dt;
    for (const a of this.agents) a.update(a, dt);
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry && !Object.values(GEO).includes(o.geometry) && !Object.values(DOG).includes(o.geometry)) o.geometry.dispose();
    });
    for (const v of Object.values(this.mats)) (Array.isArray(v) ? v : [v]).forEach((m) => m.dispose());
    this.group.traverse((o) => o.isLine && o.material.dispose());
  }
}
