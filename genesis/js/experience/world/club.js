// The Club Náutico & Deportivo and the access portal, built from Génesis'
// illustrative images: a timber deck with an infinity pool along the club's
// waterfront edge, a sand beach on the bank below it with thatched and white
// umbrellas and loungers, a row of quinchos with grills, a playground, queen
// palms, and the entrance portal with its stone pillar and Viva Lago sign.
// Placed on the surveyed club parcel and entrance pad; the design itself is
// illustrative (labelled in the UI).
//
// Static furniture is merged per material, so the whole club costs a dozen
// draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COMMON_AREAS, ENTRANCE_PAD } from '../../data/viva-lago.js';
import { applyBoxUV } from '../house/geometry.js';
import { makePalmGeometry } from './vegetation.js';
import { WATER_LEVEL } from './terrain.js';

const CLUB = COMMON_AREAS.find((c) => c.id === 'club')?.polygon;

// Club frame: origin at the inland end of the waterfront edge, `a` along the
// edge towards the river corner, `b` inland (away from the water).
const O = { x: 132.3, z: 22.6 };
const U = { x: 0.6716, z: 0.7408 };
const Vv = { x: -0.7408, z: 0.6716 };
export const clubPoint = (a, b) => ({ x: O.x + U.x * a + Vv.x * b, z: O.z + U.z * a + Vv.z * b });
const YAW = Math.atan2(U.x, U.z); // local +z (a) → world

/** Collects primitives per material and merges them at the end. */
class Batch {
  constructor() {
    this.parts = new Map();
  }

  add(geometry, material, { x = 0, y = 0, z = 0, yaw = 0, pitch = 0, roll = 0, scale = 1, uv = true } = {}) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (uv) applyBoxUV(g);
    const m = new THREE.Matrix4().compose(V3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ')), V3(scale, scale, scale));
    g.applyMatrix4(m);
    const clean = new THREE.BufferGeometry();
    clean.setAttribute('position', g.attributes.position);
    clean.setAttribute('normal', g.attributes.normal);
    clean.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(clean);
    return clean;
  }

  build(group, { shadow = true } = {}) {
    for (const [material, list] of this.parts) {
      const mesh = new THREE.Mesh(mergeGeometries(list), material);
      mesh.castShadow = shadow && !material.transparent;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
  }
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ------------------------------------------------------------------ pieces
/** A thatched (paja) umbrella: shaggy cone with a ragged fringe on a pole. */
function thatch(batch, mats, x, y, z, seed) {
  const cone = new THREE.ConeGeometry(1.55, 0.95, 28, 4, true);
  const p = cone.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const r = Math.hypot(p.getX(i), p.getZ(i));
    const k = 1 + 0.05 * Math.sin(a * 13 + seed) + 0.04 * Math.sin(a * 29 + seed * 2);
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
    if (r > 1.4) p.setY(i, p.getY(i) - 0.12 * (0.5 + 0.5 * Math.sin(a * 41 + seed))); // ragged hem
  }
  cone.computeVertexNormals();
  batch.add(cone, mats.thatch, { x, y: y + 2.6, z, uv: false });
  const fringe = new THREE.CylinderGeometry(1.5, 1.62, 0.32, 40, 1, true);
  const fp = fringe.attributes.position;
  for (let i = 0; i < fp.count; i++) if (fp.getY(i) < 0) fp.setY(i, fp.getY(i) - 0.1 * Math.abs(Math.sin(i * 1.7 + seed)));
  fringe.computeVertexNormals();
  batch.add(fringe, mats.thatch, { x, y: y + 2.05, z, uv: false });
  batch.add(new THREE.ConeGeometry(0.16, 0.45, 8), mats.thatch, { x, y: y + 3.25, z, uv: false });
  batch.add(new THREE.CylinderGeometry(0.07, 0.08, 2.7, 10), mats.pole, { x, y: y + 1.35, z });
  batch.add(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), mats.pole, { x, y: y + 1.05, z });
}

/** A square white parasol on a timber pole. */
function parasol(batch, mats, x, y, z, yaw) {
  const canopy = new THREE.ConeGeometry(1.85, 0.5, 4, 1, true);
  batch.add(canopy, mats.canvas, { x, y: y + 2.55, z, yaw: yaw + Math.PI / 4, uv: false });
  batch.add(new THREE.CylinderGeometry(0.035, 0.04, 2.7, 8), mats.pole, { x, y: y + 1.35, z });
  batch.add(boxG(0.4, 0.12, 0.4), mats.steel, { x, y: y + 0.06, z, yaw });
}

/** A timber sun lounger with a white cushion and raised back, facing +z (local). */
function lounger(batch, mats, x, y, z, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const at = (dx, dz) => ({ x: x + dx * c + dz * s, z: z - dx * s + dz * c });
  const f = at(0, 0);
  batch.add(boxG(0.72, 0.08, 1.95), mats.teak, { x: f.x, y: y + 0.3, z: f.z, yaw });
  for (const [dx, dz] of [[-0.3, -0.85], [0.3, -0.85], [-0.3, 0.85], [0.3, 0.85]]) {
    const l = at(dx, dz);
    batch.add(boxG(0.06, 0.28, 0.06), mats.teak, { x: l.x, y: y + 0.14, z: l.z, yaw });
  }
  const cush = at(0, 0.25);
  batch.add(boxG(0.64, 0.07, 1.25), mats.cushion, { x: cush.x, y: y + 0.38, z: cush.z, yaw });
  const back = at(0, -0.62);
  batch.add(boxG(0.64, 0.07, 0.72), mats.cushion, { x: back.x, y: y + 0.6, z: back.z, yaw, pitch: -0.75 });
}

/** A quincho: steel posts, slatted timber roof, grill chimney, stone back wall, table. */
function quincho(batch, mats, x, y, z, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const at = (dx, dz) => ({ x: x + dx * c + dz * s, z: z - dx * s + dz * c });
  const W = 5.6;
  const D = 4.4;
  const H = 2.9;
  const floor = at(0, 0);
  batch.add(boxG(W + 1.2, 0.12, D + 1.0), mats.flagstone, { x: floor.x, y: y + 0.06, z: floor.z, yaw });
  for (const [dx, dz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]]) {
    const p = at(dx, dz);
    batch.add(boxG(0.14, H, 0.14), mats.steel, { x: p.x, y: y + H / 2, z: p.z, yaw });
  }
  // Roof: perimeter beams, then timber slats across.
  for (const dz of [-D / 2, D / 2]) {
    const p = at(0, dz);
    batch.add(boxG(W + 0.9, 0.22, 0.14), mats.steel, { x: p.x, y: y + H + 0.1, z: p.z, yaw });
  }
  for (let k = -3; k <= 3; k++) {
    const p = at((k * W) / 7, 0);
    batch.add(boxG(0.1, 0.16, D + 0.9), mats.steel, { x: p.x, y: y + H + 0.22, z: p.z, yaw });
  }
  const roof = at(0, 0);
  batch.add(boxG(W + 0.9, 0.05, D + 0.9), mats.teak, { x: roof.x, y: y + H + 0.33, z: roof.z, yaw });
  // Grill chimney and counter at the back.
  const g = at(W / 2 - 0.9, -D / 2 + 0.4);
  batch.add(boxG(1.3, 2.4, 0.8), mats.render, { x: g.x, y: y + 1.2, z: g.z, yaw });
  const mouth = at(W / 2 - 0.9, -D / 2 + 0.81);
  batch.add(boxG(0.9, 0.55, 0.02), mats.steel, { x: mouth.x, y: y + 1.35, z: mouth.z, yaw });
  const counter = at(-0.6, -D / 2 + 0.35);
  batch.add(boxG(2.6, 0.92, 0.65), mats.render, { x: counter.x, y: y + 0.46, z: counter.z, yaw });
  // Low stone wall behind.
  const wall = at(0, -D / 2 - 0.45);
  batch.add(boxG(W + 1.2, 1.1, 0.35), mats.stone, { x: wall.x, y: y + 0.55, z: wall.z, yaw });
  // Table and four stools.
  const t = at(-0.6, 0.6);
  batch.add(boxG(1.8, 0.05, 0.9), mats.teak, { x: t.x, y: y + 0.76, z: t.z, yaw });
  batch.add(boxG(0.1, 0.74, 0.1), mats.steel, { x: t.x, y: y + 0.37, z: t.z, yaw });
  for (const [dx, dz] of [[-0.55, -0.75], [0.55, -0.75], [-0.55, 0.75], [0.55, 0.75]]) {
    const p = at(-0.6 + dx, 0.6 + dz);
    batch.add(boxG(0.42, 0.04, 0.42), mats.steel, { x: p.x, y: y + 0.46, z: p.z, yaw });
    batch.add(boxG(0.04, 0.46, 0.04), mats.steel, { x: p.x, y: y + 0.23, z: p.z, yaw });
  }
}

/** Playground: A-frame swing, tower with roof, slide, monkey bars. */
function playground(batch, mats, x, y, z, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  const at = (dx, dz) => ({ x: x + dx * c + dz * s, z: z - dx * s + dz * c });
  // Swing beam on two A-frames.
  for (const dx of [-3.6, 0.4]) {
    for (const sz of [-1, 1]) {
      const p = at(dx, sz * 0.75);
      batch.add(boxG(0.12, 2.75, 0.12), mats.timber, { x: p.x, y: y + 1.3, z: p.z, yaw, pitch: -sz * 0.28 });
    }
  }
  const beam = at(-1.6, 0);
  batch.add(boxG(4.4, 0.16, 0.14), mats.timber, { x: beam.x, y: y + 2.6, z: beam.z, yaw });
  for (const dx of [-2.6, -0.8]) {
    for (const sz of [-1, 1]) {
      const p = at(dx + sz * 0.22, 0);
      batch.add(new THREE.CylinderGeometry(0.01, 0.01, 2.0, 4), mats.steel, { x: p.x, y: y + 1.55, z: p.z });
    }
    const seat = at(dx, 0);
    batch.add(boxG(0.5, 0.05, 0.22), mats.green, { x: seat.x, y: y + 0.55, z: seat.z, yaw });
  }
  // Tower.
  const tw = at(2.0, 0);
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) {
    const p = at(2.0 + dx, dz);
    batch.add(boxG(0.12, 3.0, 0.12), mats.timber, { x: p.x, y: y + 1.5, z: p.z, yaw });
  }
  batch.add(boxG(1.4, 0.08, 1.4), mats.timber, { x: tw.x, y: y + 1.5, z: tw.z, yaw });
  batch.add(boxG(1.4, 0.6, 0.06), mats.timber, { x: at(2.0, -0.68).x, y: y + 1.85, z: at(2.0, -0.68).z, yaw });
  const roof = new THREE.ConeGeometry(1.15, 0.8, 4, 1);
  batch.add(roof, mats.green, { x: tw.x, y: y + 3.4, z: tw.z, yaw: yaw + Math.PI / 4, uv: false });
  // Slide down towards +x (local).
  const sl = at(3.6, 0);
  batch.add(boxG(0.55, 0.06, 2.6), mats.yellow, { x: sl.x, y: y + 0.82, z: sl.z, yaw: yaw + Math.PI / 2, pitch: 0.6 });
  for (const sz of [-1, 1]) {
    const r = at(3.6, sz * 0.28);
    batch.add(boxG(0.05, 0.2, 2.6), mats.green, { x: r.x, y: y + 0.92, z: r.z, yaw: yaw + Math.PI / 2, pitch: 0.6 });
  }
}

// ------------------------------------------------------------------ club
export class Club {
  /**
   * @param {{ terrain: import('./terrain.js').TerrainModel, materials: object, assets: object, palmMaterials?: object }} o
   */
  constructor({ terrain, materials, assets, palmMaterials, onChange = () => {} }) {
    this.onChange = onChange;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.group.name = 'club';
    const m = materials;
    this.own = [];
    const own = (mat) => (this.own.push(mat), mat);
    this.mats = {
      deck: m.deck,
      stone: m.stone,
      sand: m.sand,
      render: m.plasterWarm || m.plaster,
      flagstone: m.pavers,
      timber: m.timber,
      teak: m.deck,
      steel: m.steelStructural || m.metalDark,
      poolTile: m.poolTile,
      water: m.water,
      pole: own(new THREE.MeshStandardMaterial({ color: '#6b4b30', roughness: 0.8 })),
      thatch: own(new THREE.MeshStandardMaterial({ color: '#b38a55', roughness: 1.0, side: THREE.DoubleSide })),
      canvas: own(new THREE.MeshStandardMaterial({ color: '#f1ece2', roughness: 0.85, side: THREE.DoubleSide })),
      cushion: own(new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.9 })),
      green: own(new THREE.MeshStandardMaterial({ color: '#2f8a4a', roughness: 0.5 })),
      yellow: own(new THREE.MeshStandardMaterial({ color: '#e7c23a', roughness: 0.45 })),
      glass: own(new THREE.MeshPhysicalMaterial({ color: '#1d2a30', roughness: 0.05, metalness: 0, envMapIntensity: 2 })),
    };
    this.palmMaterials = palmMaterials;
    this.assets = assets;
    if (!CLUB) return;
    this._waterfront();
    this._quinchos();
    this._playground();
    this._palms();
    this._portal();
  }

  ground(x, z) {
    return this.terrain.sample(x, z).h;
  }

  /** Highest ground within a metre (the terrain mesh is coarser than the sample). */
  groundMax(x, z) {
    let h = -Infinity;
    for (const [dx, dz] of [[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) h = Math.max(h, this.ground(x + dx, z + dz));
    return h;
  }

  _waterfront() {
    const b = new Batch();
    const M = this.mats;
    const A0 = 2;
    const A1 = 31;
    const B0 = 1;
    const B1 = 11;
    const c = clubPoint((A0 + A1) / 2, (B0 + B1) / 2);
    const y0 = Math.max(this.ground(c.x, c.z), 0.05);
    const top = y0 + 0.4;
    const len = A1 - A0;
    const wid = B1 - B0;
    // Pool (infinity edge on the water side) cut out of the deck.
    const P = { a0: 8, a1: 25, b0: 2.6, b1: 7.6, depth: 1.35 };
    const deckRect = (a0, a1, b0, b1) => {
      const p = clubPoint((a0 + a1) / 2, (b0 + b1) / 2);
      b.add(boxG(b1 - b0, 0.42, a1 - a0), M.deck, { x: p.x, y: top - 0.21, z: p.z, yaw: YAW });
    };
    deckRect(A0, P.a0, B0, B1);
    deckRect(P.a1, A1, B0, B1);
    deckRect(P.a0, P.a1, B0, P.b0);
    deckRect(P.a0, P.a1, P.b1, B1);
    // Pool basin: tiled floor and walls, water a hair below the deck.
    const pc = clubPoint((P.a0 + P.a1) / 2, (P.b0 + P.b1) / 2);
    const pl = P.a1 - P.a0;
    const pw = P.b1 - P.b0;
    b.add(boxG(pw, 0.1, pl), M.poolTile, { x: pc.x, y: top - P.depth, z: pc.z, yaw: YAW });
    for (const [da, db, w, l] of [[0, -pw / 2, 0.08, pl], [0, pw / 2, 0.08, pl], [-pl / 2, 0, pw, 0.08], [pl / 2, 0, pw, 0.08]]) {
      const p = clubPoint((P.a0 + P.a1) / 2 + da, (P.b0 + P.b1) / 2 + db);
      b.add(boxG(w, P.depth, l), M.poolTile, { x: p.x, y: top - P.depth / 2, z: p.z, yaw: YAW });
    }
    const water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pl).rotateX(-Math.PI / 2), M.water);
    water.position.set(pc.x, top - 0.04, pc.z);
    water.rotation.y = YAW;
    water.name = 'club-pool';
    this.group.add(water);
    // Stone plinth on the water side, stepping down to the beach.
    const wall = clubPoint((A0 + A1) / 2, B0 - 0.2);
    b.add(boxG(0.45, 1.6, len + 0.5), M.stone, { x: wall.x, y: top - 0.85, z: wall.z, yaw: YAW });
    const wallEnd = clubPoint(A1 + 0.2, (B0 + B1) / 2);
    b.add(boxG(wid + 0.5, 1.6, 0.45), M.stone, { x: wallEnd.x, y: top - 0.85, z: wallEnd.z, yaw: YAW });
    // Loungers along the pool, facing the water; parasols between them.
    for (let a = P.a0 + 0.8; a <= P.a1 - 0.6; a += 2.1) {
      const p = clubPoint(a, P.b1 + 1.5);
      lounger(b, M, p.x, top, p.z, YAW + Math.PI / 2 + Math.PI);
    }
    for (const a of [P.a0 + 2.9, P.a0 + 9.2, P.a0 + 15.5]) {
      const p = clubPoint(a, P.b1 + 2.4);
      parasol(b, M, p.x, top, p.z, YAW);
    }
    for (const [a, bb] of [[4, 5], [4.2, 8], [28, 5], [28.2, 8]]) {
      const p = clubPoint(a, bb);
      lounger(b, M, p.x, top, p.z, YAW + Math.PI / 2 + Math.PI);
    }
    for (const a of [4.5, 28.5]) {
      const p = clubPoint(a, 6.5);
      parasol(b, M, p.x, top, p.z, YAW);
    }
    // Beach: sand from the plinth down to the water line along the bank.
    this._beach(b, A0 - 6, A1 + 10);
    b.build(this.group);
  }

  _beach(b, a0, a1) {
    const M = this.mats;
    const rows = [];
    for (let a = a0; a <= a1; a += 1) {
      // March from the plinth towards the water until the bank drops below it.
      let bw = -0.5;
      while (bw > -40 && this.ground(clubPoint(a, bw).x, clubPoint(a, bw).z) > WATER_LEVEL + 0.02) bw -= 0.5;
      // A generous beach: at least 9 m of sand, into the shallows.
      rows.push({ a, edge: Math.min(bw - 2.5, -9) });
    }
    const pos = [];
    const nor = [];
    const uv = [];
    const vert = (a, bb) => {
      const p = clubPoint(a, bb);
      // Above the terrain's coarse triangles, so no grass shows through.
      const y = Math.max(this.groundMax(p.x, p.z), WATER_LEVEL - 0.25) + 0.12;
      pos.push(p.x, y, p.z);
      nor.push(0, 1, 0);
      uv.push(p.x / 2, p.z / 2);
    };
    const steps = 8;
    for (let i = 0; i < rows.length - 1; i++) {
      const r0 = rows[i];
      const r1 = rows[i + 1];
      for (let k = 0; k < steps; k++) {
        const t0 = k / steps;
        const t1 = (k + 1) / steps;
        const b00 = -0.3 + (r0.edge + 0.3) * t0;
        const b01 = -0.3 + (r0.edge + 0.3) * t1;
        const b10 = -0.3 + (r1.edge + 0.3) * t0;
        const b11 = -0.3 + (r1.edge + 0.3) * t1;
        vert(r0.a, b00);
        vert(r1.a, b10);
        vert(r0.a, b01);
        vert(r0.a, b01);
        vert(r1.a, b10);
        vert(r1.a, b11);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // Facing up whichever way the strip winds.
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const sand = new THREE.Mesh(g, M.sand);
    sand.receiveShadow = true;
    sand.name = 'club-beach';
    this.group.add(sand);
    // Thatched umbrellas and loungers on the sand.
    rows.forEach((r, i) => {
      if (i % 6 !== 3) return;
      const p = clubPoint(r.a, r.edge * 0.45);
      const y = Math.max(this.groundMax(p.x, p.z), WATER_LEVEL) + 0.1;
      thatch(b, M, p.x, y, p.z, i);
      const l = clubPoint(r.a + 1.4, r.edge * 0.45 + 0.4);
      lounger(b, M, l.x, Math.max(this.groundMax(l.x, l.z), WATER_LEVEL) + 0.1, l.z, YAW + Math.PI / 2 + Math.PI);
    });
  }

  _quinchos() {
    const b = new Batch();
    // A row along the south side of the parcel, open to the north.
    const south = [{ x: 80.2, z: 49.0 }, { x: 160.6, z: 57.6 }];
    const dir = { x: south[1].x - south[0].x, z: south[1].z - south[0].z };
    const L = Math.hypot(dir.x, dir.z);
    const t = { x: dir.x / L, z: dir.z / L };
    const n = { x: t.z, z: -t.x }; // north (into the parcel)
    const yaw = Math.atan2(n.x, n.z);
    for (let k = 0; k < 4; k++) {
      const s = 14 + k * 9.5;
      const x = south[0].x + t.x * s + n.x * 5.2;
      const z = south[0].z + t.z * s + n.z * 5.2;
      quincho(b, this.mats, x, this.ground(x, z), z, yaw);
    }
    b.build(this.group);
  }

  _playground() {
    const b = new Batch();
    const x = 91;
    const z = 27;
    playground(b, this.mats, x, this.ground(x, z), z, 0.15);
    b.build(this.group);
  }

  _palms() {
    if (!this.palmMaterials) return;
    const spots = [[1, 13], [10, 12.6], [20, 12.8], [33, 9], [34, 3], [-1, 6], [12, -6], [26, -7]].map(([a, bb]) => clubPoint(a, bb));
    spots.push({ x: 86, z: 22 }, { x: 98, z: 21 }, { x: 140, z: 55.5 });
    const palm = makePalmGeometry(11, 8.5);
    this.palmGeometry = palm;
    const trunk = new THREE.InstancedMesh(palm.trunk, this.palmMaterials.trunkMat, spots.length);
    const leaves = new THREE.InstancedMesh(palm.leaves, this.palmMaterials.frondMat, spots.length);
    spots.forEach((p, i) => {
      const s = 0.85 + ((i * 37) % 10) / 30;
      const mtx = new THREE.Matrix4().compose(V3(p.x, this.ground(p.x, p.z), p.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, i * 2.3, 0)), V3(s, s, s));
      trunk.setMatrixAt(i, mtx);
      leaves.setMatrixAt(i, mtx);
    });
    trunk.castShadow = leaves.castShadow = true;
    this.group.add(trunk, leaves);
  }

  // The access portal on the entrance pad: steel canopy over the road, a
  // stone-clad pillar with the Viva Lago sign, a guardhouse and slatted gates.
  _portal() {
    if (!ENTRANCE_PAD.length) return;
    const b = new Batch();
    const M = this.mats;
    const cx = ENTRANCE_PAD.reduce((s, p) => s + p.x, 0) / ENTRANCE_PAD.length;
    const cz = ENTRANCE_PAD.reduce((s, p) => s + p.z, 0) / ENTRANCE_PAD.length;
    const y = this.ground(cx, cz);
    // The pad's long side runs across the road; the portal spans it.
    const [p0, p1] = [ENTRANCE_PAD[0], ENTRANCE_PAD[3]];
    const across = { x: p1.x - p0.x, z: p1.z - p0.z };
    const al = Math.hypot(across.x, across.z);
    const ax = { x: across.x / al, z: across.z / al };
    const yaw = Math.atan2(ax.x, ax.z) - Math.PI / 2;
    const at = (s) => ({ x: cx + ax.x * s, z: cz + ax.z * s });
    const span = 22;
    // Guardhouse on the pad.
    // Guardhouse: rendered volume with a glazed band all round, a low planter in front.
    b.add(boxG(3.2, 1.1, 3.0), M.render, { x: cx, y: y + 0.55, z: cz, yaw });
    b.add(boxG(3.1, 0.95, 2.9), M.glass, { x: cx, y: y + 1.575, z: cz, yaw });
    b.add(boxG(3.2, 1.0, 3.0), M.render, { x: cx, y: y + 2.55, z: cz, yaw });
    b.add(boxG(3.3, 0.08, 3.1), M.steel, { x: cx, y: y + 3.08, z: cz, yaw });
    // Canopy beam and its two supports.
    const mid = at(0);
    b.add(boxG(span, 0.55, 2.2), M.steel, { x: mid.x, y: y + 5.6, z: mid.z, yaw });
    const left = at(-span / 2 + 1.1);
    b.add(boxG(2.4, 6.2, 1.4), M.stone, { x: left.x, y: y + 3.1, z: left.z, yaw });
    const right = at(span / 2 - 0.4);
    b.add(boxG(0.8, 5.9, 1.6), M.steel, { x: right.x, y: y + 2.95, z: right.z, yaw });
    // Slatted gates either side of the guardhouse.
    for (const s of [-5.5, 5.8]) {
      const g = at(s);
      for (let k = -9; k <= 9; k++) {
        const q = at(s + k * 0.2);
        b.add(boxG(0.08, 2.4, 0.06), M.timber, { x: q.x, y: y + 1.25, z: q.z + 0.0, yaw });
      }
      b.add(boxG(4.0, 0.08, 0.08), M.steel, { x: g.x, y: y + 2.45, z: g.z, yaw });
    }
    b.build(this.group);
    // The sign: the Viva Lago logo (brand file) on both faces of the stone pillar.
    if (typeof document === 'undefined') return; // no image loading outside a browser (tests)
    const url = new URL('../../../assets/brand/viva-lago-logo.webp', import.meta.url).href;
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        if (this.disposed) return tex.dispose();
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const sign = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, metalness: 0.2, depthWrite: false });
        this.own.push(sign);
        this.signTexture = tex;
        for (const side of [-1, 1]) {
          const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 0.83), sign);
          plane.position.set(left.x, y + 3.7, left.z);
          plane.rotation.y = yaw + (side < 0 ? Math.PI : 0);
          plane.translateZ(0.71);
          plane.name = 'portal-sign';
          this.group.add(plane);
        }
        this.onChange();
      },
      undefined,
      () => {},
    );
  }

  dispose() {
    this.disposed = true;
    this.signTexture?.dispose();
    this.group.traverse((o) => o.geometry && o.geometry !== this.palmGeometry?.trunk && o.geometry !== this.palmGeometry?.leaves && o.geometry.dispose());
    this.palmGeometry?.trunk.dispose();
    this.palmGeometry?.leaves.dispose();
    for (const m of this.own) m.dispose();
  }
}
