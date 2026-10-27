// Conceptual two-storey residence, built from the components a real site would
// produce, each with its own place in the construction sequence:
//
//   ground beams and pads → contrapiso slab → steel columns and beams →
//   formwork + slab → upper steel columns → roof slab → brick infill (ladrillo común) → render, stone
//   and timber skins → copings and soffits → windows and doors → landscaping.
//
// Massing (lot design coordinates, see geometry.js):
//   • stone-clad garden wall that becomes the west façade (x -7.5…-7.2, d 3.5…24)
//   • ground-floor living wing (x -7.2…2.5, d 8…20), glazed to the garden
//   • garage/service block (x 2.5…7.5, d 6…13.5), stone-clad to the street
//   • rendered upper volume (x -4.5…7.5, d 6…16) cantilevering over the entry
//   • covered gallery, timber deck and pool facing the back of the lot
//
// It is an illustrative concept, not an approved or costed design.
import * as THREE from 'three';
import { applyBoxUV, box, cylinderY, rod, wall, skin, windowUnit, merge } from './geometry.js';
import { mulberry32 } from '../../core/noise.js';

export const LEVEL = Object.freeze({
  ground: 0,
  floor: 0.3, // finished ground floor (raised plinth)
  slabBottom: 3.3,
  slabTop: 3.6, // first-floor level
  roofBottom: 6.5,
  roofTop: 6.8,
  parapet: 7.3,
});

const COURSE = 0.0714; // brick course height (ladrillo común + joint)

/** Openings, frames and finishes for every wall of the concept. */
function wallSchedule() {
  const L = LEVEL;
  const gf = (spec) => ({ y0: L.floor, y1: L.slabBottom, thickness: 0.2, ...spec });
  const ff = (spec) => ({ y0: L.slabTop, y1: L.parapet, thickness: 0.2, ...spec });
  return [
    // ---- Ground floor
    {
      id: 'gf-front-living',
      finish: 'timber',
      spec: gf({ plane: 'd', face: 8.0, inward: 1, from: -7.2, to: 2.5, openings: [
        { a0: -6.7, a1: -4.8, y0: L.floor, y1: 3.0, win: { mullions: 0, glow: 0.8 } },
        { a0: -1.0, a1: 1.6, y0: L.floor, y1: 3.0, win: { door: true, doorSplit: 0.45, glow: 1.0 } },
      ] }),
    },
    {
      id: 'gf-rear-living',
      finish: 'plaster',
      spec: gf({ plane: 'd', face: 20.0, inward: -1, from: -7.2, to: 2.5, openings: [
        { a0: -6.7, a1: 2.0, y0: L.floor, y1: 3.05, win: { mullions: 3, glow: 1.25 } },
      ] }),
    },
    {
      id: 'gf-side-living',
      finish: 'plaster',
      spec: gf({ plane: 'x', face: 2.5, inward: -1, from: 13.5, to: 20.0, openings: [
        { a0: 14.4, a1: 19.5, y0: L.floor, y1: 3.05, win: { mullions: 1, glow: 1.15 } },
      ] }),
    },
    {
      id: 'gf-front-garage',
      finish: 'stone',
      spec: gf({ plane: 'd', face: 6.0, inward: 1, from: 2.5, to: 7.5, openings: [{ a0: 3.0, a1: 7.0, y0: L.floor, y1: 2.75, garage: true }] }),
    },
    { id: 'gf-porch-return', finish: 'stone', spec: gf({ plane: 'x', face: 2.5, inward: 1, from: 6.0, to: 8.0 }) },
    {
      id: 'gf-garage-side',
      finish: 'plaster',
      // High clerestory strip to the garage and service rooms.
      spec: gf({ plane: 'x', face: 7.5, inward: -1, from: 6.0, to: 13.5, openings: [{ a0: 7.4, a1: 12.6, y0: 2.25, y1: 2.95, win: { mullions: 2, glow: 0.45 } }] }),
    },
    {
      id: 'gf-garage-rear',
      finish: 'plaster',
      spec: gf({ plane: 'd', face: 13.5, inward: -1, from: 2.5, to: 7.5, openings: [{ a0: 4.2, a1: 6.6, y0: 1.2, y1: 2.9, win: { mullions: 1, glow: 0.7 } }] }),
    },
    // ---- Upper floor
    {
      id: 'ff-front',
      finish: 'plaster',
      spec: ff({ plane: 'd', face: 6.0, inward: 1, from: -4.5, to: 7.5, openings: [
        { a0: -3.9, a1: 3.7, y0: L.slabTop, y1: 6.35, win: { mullions: 4, glow: 0.9 } },
        { a0: 4.3, a1: 6.9, y0: L.slabTop, y1: 6.35, win: { mullions: 1, glow: 0.6 } },
      ] }),
    },
    {
      id: 'ff-rear',
      finish: 'plaster',
      spec: ff({ plane: 'd', face: 16.0, inward: -1, from: -4.5, to: 7.5, openings: [
        { a0: -3.9, a1: -0.3, y0: L.slabTop, y1: 6.3, win: { mullions: 1, glow: 1.0 } },
        { a0: 0.6, a1: 4.6, y0: L.slabTop, y1: 6.3, win: { mullions: 1, glow: 0.85 } },
        { a0: 5.4, a1: 6.8, y0: 4.6, y1: 6.0, win: { glow: 0.5 } },
      ] }),
    },
    {
      id: 'ff-left',
      finish: 'plaster',
      spec: ff({ plane: 'x', face: -4.5, inward: 1, from: 6.0, to: 16.0, openings: [{ a0: 9.6, a1: 13.8, y0: L.slabTop, y1: 6.3, win: { mullions: 1, glow: 0.9 } }] }),
    },
    {
      id: 'ff-right',
      finish: 'plaster',
      // A rhythm of full-height slots rather than punched holes.
      spec: ff({ plane: 'x', face: 7.5, inward: -1, from: 6.0, to: 16.0, openings: [
        { a0: 8.2, a1: 9.0, y0: 3.75, y1: 6.35, win: { glow: 0.55 } },
        { a0: 10.0, a1: 10.8, y0: 3.75, y1: 6.35, win: { glow: 0.7 } },
        { a0: 13.4, a1: 14.2, y0: 3.75, y1: 6.35, win: { glow: 0.5 } },
      ] }),
    },
  ];
}

// Garden wall in natural stone: low in front, full height along the living wing and gallery.
const STONE_WALL = [
  { x0: -7.5, x1: -7.2, d0: 3.5, d1: 7.95, y0: 0, y1: 1.3 },
  { x0: -7.5, x1: -7.2, d0: 7.95, d1: 24.0, y0: 0, y1: LEVEL.slabBottom },
];

const GF_COLUMNS = [
  [-7.35, 8.1], [-7.35, 14.0], [-7.35, 19.9], [-7.35, 23.35], [-4.4, 8.1], [-4.4, 15.9],
  [2.4, 6.1], [2.4, 8.1], [2.4, 13.9], [2.4, 19.9], [7.4, 6.1], [7.4, 13.4],
];
const FF_COLUMNS = [[-4.4, 6.1], [4.0, 6.1], [7.4, 6.1], [-4.4, 15.9], [0.15, 15.9], [5.0, 15.9], [7.4, 15.9], [7.4, 12.1], [-4.4, 8.9]];
const GALLERY_POSTS = [[-3.2, 23.35], [0.85, 23.35]];

// First-floor slab as a partition of rectangles [x0, x1, d0, d1].
const FF_SLAB = [
  [-7.5, 2.5, 8.0, 20.0], // over the living wing
  [-4.5, 2.5, 6.0, 8.0], // entry cantilever
  [2.5, 7.5, 6.0, 13.5], // over the garage
  [2.5, 7.5, 13.5, 16.0], // side cantilever
  [-7.5, 1.0, 20.0, 23.5], // gallery canopy
];
const ROOF_SLAB = [[-4.3, 7.3, 6.2, 15.8]];
const TERRACES = [
  [-7.5, -4.5, 8.0, 20.0],
  [-4.5, 2.5, 16.0, 20.0],
];
const BEAMS = [
  // [x0, x1, d0, d1] at 2.85..3.30, flush with the 20 cm masonry they carry
  [-7.5, 2.5, 8.0, 8.2], [-7.5, 2.5, 19.8, 20.0], [2.5, 7.5, 6.0, 6.2], [2.5, 7.5, 13.3, 13.5],
  [-7.5, -7.2, 8.0, 23.5], [2.3, 2.5, 6.0, 20.0], [7.3, 7.5, 6.0, 13.5],
  [-4.5, -4.3, 8.0, 16.0], [-4.5, 2.5, 15.8, 16.0],
];

/** An I-section along the longer side of [x0, x1] × [d0, d1], from y0 to y1. */
function iBeam(x0, x1, d0, d1, y0, y1) {
  const t = 0.018; // flange
  const w = 0.011; // web
  if (x1 - x0 >= d1 - d0) {
    const dc = (d0 + d1) / 2;
    return [box(x0, x1, y0, y0 + t, d0, d1), box(x0, x1, y1 - t, y1, d0, d1), box(x0, x1, y0 + t, y1 - t, dc - w / 2, dc + w / 2)].map(applyBoxUV);
  }
  const xc = (x0 + x1) / 2;
  return [box(x0, x1, y0, y0 + t, d0, d1), box(x0, x1, y1 - t, y1, d0, d1), box(xc - w / 2, xc + w / 2, y0 + t, y1 - t, d0, d1)].map(applyBoxUV);
}
const GROUND_BEAMS = [
  // strip ground beams under the masonry lines [x0, x1, d0, d1], flush with the walls above
  [-7.5, -7.2, 3.5, 24.0], [-7.2, 2.5, 8.0, 8.2], [-7.2, 2.5, 19.8, 20.0], [2.3, 2.5, 6.0, 20.0],
  [2.5, 7.5, 6.0, 6.2], [7.3, 7.5, 6.0, 13.5], [2.5, 7.5, 13.3, 13.5], [-4.5, -4.3, 8.0, 16.0],
];
const GROUND_SLAB = [
  [-7.2, 2.5, 8.0, 20.0],
  [2.5, 7.5, 6.0, 13.5],
];
const POOL = { x0: -6.0, x1: 4.0, d0: 25.3, d1: 29.0, depth: 1.45, wall: 0.25 };

/** Ornamental grass clump: thin arching blades with a straw-to-green gradient. */
function grassClumpGeometry(seed) {
  const rnd = mulberry32(seed);
  const pos = [];
  const col = [];
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.25 + rnd() * 0.45;
    const h = 0.55 + rnd() * 0.35;
    const w = 0.018 + rnd() * 0.01;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const sx = -dz * w;
    const sz = dx * w;
    const mid = [dx * lean * h * 0.35, h * 0.6, dz * lean * h * 0.35];
    const tip = [dx * lean * h, h * 0.95 - lean * 0.2, dz * lean * h];
    pos.push(-sx, 0, -sz, sx, 0, sz, mid[0] + sx * 0.7, mid[1], mid[2] + sz * 0.7);
    pos.push(-sx, 0, -sz, mid[0] + sx * 0.7, mid[1], mid[2] + sz * 0.7, mid[0] - sx * 0.7, mid[1], mid[2] - sz * 0.7);
    pos.push(mid[0] - sx * 0.7, mid[1], mid[2] - sz * 0.7, mid[0] + sx * 0.7, mid[1], mid[2] + sz * 0.7, tip[0], tip[1], tip[2]);
    const base = [0.26, 0.31, 0.15];
    const top = [0.72, 0.64, 0.38];
    const m = [0.45, 0.47, 0.24];
    for (const c of [base, base, m, base, m, m, m, m, top]) col.push(...c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.4, 0.9, n.getZ(i) * 0.4);
  return g;
}

/** Lawn tuft: a handful of short blades, green at the root and sun-bleached at the tip. */
function lawnTuftGeometry(seed) {
  const rnd = mulberry32(seed);
  const pos = [];
  const col = [];
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.06;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    const hgt = 0.07 + rnd() * 0.1;
    const lean = 0.03 + rnd() * 0.07;
    const la = rnd() * Math.PI * 2;
    const w = 0.011 + rnd() * 0.006;
    const sx = Math.cos(a + 1.57) * w;
    const sz = Math.sin(a + 1.57) * w;
    pos.push(bx - sx, 0, bz - sz, bx + sx, 0, bz + sz, bx + Math.cos(la) * lean, hgt, bz + Math.sin(la) * lean);
    const g = 0.85 + rnd() * 0.3;
    col.push(0.12 * g, 0.2 * g, 0.06 * g, 0.12 * g, 0.2 * g, 0.06 * g, 0.27 * g, 0.38 * g, 0.12 * g);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const n = new Float32Array(pos.length);
  for (let i = 0; i < n.length; i += 3) n.set([0.15, 0.95, 0.15], i);
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  return g;
}

/** Sand pile with an irregular surface. */
function sandPileGeometry() {
  const g = new THREE.ConeGeometry(1.7, 1.0, 28, 6);
  const p = g.attributes.position;
  const rnd = mulberry32(5);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const k = 1 + (rnd() - 0.5) * 0.12 * (1 - Math.abs(y));
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
    // soften the apex
    if (y > 0.35) p.setY(i, 0.35 + (y - 0.35) * 0.55);
  }
  g.translate(0, 0.5 * 0.82, 0);
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the residence. Returns { group, components, pool, footprint }.
 * Each component: { id, stage, parts: [{ mesh, material }], build, remove?, cure?, effect? }
 */
export function buildResidence(lib, plantKit, { lawnDetail = true } = {}) {
  const L = LEVEL;
  const group = new THREE.Group();
  group.name = 'residence';
  const components = [];
  const add = (id, stage, parts, anim) => {
    const meshes = parts.map(({ geometry, material, cast = true, receive = true, renderOrder }) => {
      const mesh = new THREE.Mesh(geometry, lib[material] || material);
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
      if (renderOrder != null) mesh.renderOrder = renderOrder;
      mesh.userData.baseMaterial = mesh.material;
      group.add(mesh);
      return mesh;
    });
    const c = { id, stage, meshes, ...anim };
    components.push(c);
    return c;
  };

  const walls = wallSchedule();

  // ------------------------------------------------------------ site setup
  {
    // Batter boards and string lines marking the footprint (replanteo).
    const parts = [];
    const lines = [];
    const corners = [[-8.6, 4.6], [8.6, 4.6], [8.6, 25.2], [-8.6, 25.2]];
    for (const [x, d] of corners) {
      const sx = Math.sign(x);
      const sd = d < 10 ? -1 : 1;
      parts.push(box(x - 0.04, x + 0.04, 0, 0.75, d - 0.04, d + 0.04));
      parts.push(box(x - sx * 1.2 - 0.04, x - sx * 1.2 + 0.04, 0, 0.75, d - 0.04, d + 0.04));
      parts.push(box(x, x + 0.01, 0, 0.75, d - sd * 1.2 - 0.04, d - sd * 1.2 + 0.04));
      parts.push(box(Math.min(x, x - sx * 1.2), Math.max(x, x - sx * 1.2), 0.55, 0.65, d - 0.012, d + 0.012));
    }
    const y = 0.6;
    const ring = [[-7.5, 6.0], [7.5, 6.0], [7.5, 24.0], [-7.5, 24.0]];
    for (let i = 0; i < 4; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % 4];
      lines.push(rod([a[0], y, a[1]], [b[0], y, b[1]], 0.006, 3));
      // extend lines to the batter boards
    }
    lines.push(rod([-8.6, y, 6.0], [8.6, y, 6.0], 0.005, 3), rod([-8.6, y, 24.0], [8.6, y, 24.0], 0.005, 3));
    lines.push(rod([-7.5, y, 4.6], [-7.5, y, 25.2], 0.005, 3), rod([7.5, y, 4.6], [7.5, y, 25.2], 0.005, 3));
    add('setout', 'site', [
      { geometry: merge(parts.map((g) => applyBoxUV(g))), material: 'stake' },
      { geometry: merge(lines), material: 'stringLine', cast: false },
    ], { build: { type: 'pop', window: [0.025, 0.07] }, remove: { type: 'hide', window: [0.235, 0.24] } });
  }

  // Construction materials on site.
  {
    const sand = sandPileGeometry();
    sand.translate(-4.2, 0, -2.6);
    add('sand', 'site', [{ geometry: applyBoxUV(sand), material: 'sand' }], {
      build: { type: 'grow', window: [0.05, 0.1], anchor: [-4.2, 0, 2.6] },
      remove: { type: 'shrink', window: [0.81, 0.85], anchor: [-4.2, 0, 2.6] },
    });
    const pallets = [];
    const bricks = [];
    for (const [x, d] of [[4.0, 2.0], [5.5, 2.0], [4.75, 3.35]]) {
      pallets.push(box(x - 0.55, x + 0.55, 0, 0.12, d - 0.5, d + 0.5));
      bricks.push(box(x - 0.5, x + 0.5, 0.12, 1.0, d - 0.45, d + 0.45));
    }
    add('bricks-delivered', 'masonry', [
      { geometry: merge(pallets.map((g) => applyBoxUV(g))), material: 'timberDark' },
      { geometry: merge(bricks.map((g) => applyBoxUV(g))), material: 'brick' },
    ], {
      build: { type: 'pop', window: [0.36, 0.39], anchor: [4.75, 0, 2.6] },
      remove: { type: 'shrink', window: [0.55, 0.6], anchor: [4.75, 0, 2.6] },
    });
  }

  // ------------------------------------------------------------ foundations
  add('ground-beams', 'foundation', [
    {
      geometry: merge([
        ...GROUND_BEAMS.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, -0.1, L.floor, d0, d1))),
        ...GF_COLUMNS.map(([x, d]) => applyBoxUV(box(x - 0.45, x + 0.45, -0.1, 0.12, d - 0.45, d + 0.45))),
      ]),
      material: 'concrete',
    },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: -0.1, to: L.floor, window: [0.1, 0.15] }, cure: { window: [0.15, 0.22] } });

  // Base plates and anchor bolts cast into the pads, ready for the steel columns.
  add('column-bases', 'foundation', [
    { geometry: merge(GF_COLUMNS.map(([x, d]) => applyBoxUV(box(x - 0.17, x + 0.17, L.floor, L.floor + 0.025, d - 0.17, d + 0.17)))), material: 'steelStructural' },
    {
      geometry: merge(GF_COLUMNS.flatMap(([x, d]) => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sd]) => cylinderY(x + sx * 0.13, d + sd * 0.13, L.floor, L.floor + 0.09, 0.012, 6)))),
      material: 'steelGalv',
      cast: false,
    },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 5.9, to: 23.6, window: [0.14, 0.17] } });

  add('ground-slab', 'foundation', [
    { geometry: merge(GROUND_SLAB.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, 0.0, L.floor - 0.005, d0, d1)))), material: 'concrete' },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 5.9, to: 20.2, window: [0.155, 0.21] }, cure: { window: [0.21, 0.3] } });

  // Pool shell (excavated and cast with the foundations).
  {
    const P = POOL;
    const top = 0.2;
    const shell = merge([
      box(P.x0 - P.wall, P.x1 + P.wall, -P.depth - 0.25, -P.depth, P.d0 - P.wall, P.d1 + P.wall),
      box(P.x0 - P.wall, P.x0, -P.depth, top, P.d0 - P.wall, P.d1 + P.wall),
      box(P.x1, P.x1 + P.wall, -P.depth, top, P.d0 - P.wall, P.d1 + P.wall),
      box(P.x0, P.x1, -P.depth, top, P.d0 - P.wall, P.d0),
      box(P.x0, P.x1, -P.depth, top, P.d1, P.d1 + P.wall),
    ].map((g) => applyBoxUV(g)));
    add('pool-shell', 'foundation', [{ geometry: shell, material: 'concrete' }], {
      build: { type: 'clip', axis: 'y', keep: 'below', from: -P.depth - 0.25, to: top, window: [0.17, 0.225] },
      cure: { window: [0.225, 0.3] },
    });
  }

  // ------------------------------------------------------------ structure
  add('gf-columns', 'structure', [
    { geometry: merge(GF_COLUMNS.map(([x, d]) => applyBoxUV(box(x - 0.1, x + 0.1, L.floor, L.slabBottom, d - 0.1, d + 0.1)))), material: 'steelStructural' },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: L.floor, to: L.slabBottom, window: [0.222, 0.262] } });

  // Steel beams (I-sections) erected on the columns before the slab is poured.
  add('ff-beams', 'structure', [
    { geometry: merge(BEAMS.flatMap(([x0, x1, d0, d1]) => iBeam(x0, x1, d0, d1, 2.85, L.slabBottom))), material: 'steelStructural' },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 5.9, to: 23.6, window: [0.262, 0.292] } });

  add('gallery-posts', 'structure', [
    { geometry: merge(GALLERY_POSTS.map(([x, d]) => applyBoxUV(box(x - 0.06, x + 0.06, L.floor, L.slabBottom, d - 0.06, d + 0.06)))), material: 'steelPainted' },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: L.floor, to: L.slabBottom, window: [0.25, 0.27] } });

  // Shoring: plywood deck on steel props, stripped once the slab has cured.
  const shoring = (rects, yBottom, yDeck, id, build, remove) => {
    const props = [];
    const decks = [];
    for (const [x0, x1, d0, d1] of rects) {
      decks.push(applyBoxUV(box(x0 + 0.02, x1 - 0.02, yDeck - 0.025, yDeck, d0 + 0.02, d1 - 0.02)));
      for (let x = x0 + 0.6; x < x1 - 0.3; x += 1.25) {
        for (let d = d0 + 0.6; d < d1 - 0.3; d += 1.25) props.push(cylinderY(x, d, yBottom, yDeck - 0.025, 0.024, 6));
      }
    }
    add(id, 'structure', [
      { geometry: merge(props), material: 'steelGalv' },
      { geometry: merge(decks), material: 'plywood' },
    ], { build: { type: 'clip', axis: 'y', keep: 'below', from: yBottom, to: yDeck + 0.01, window: build }, remove: { type: 'clip', axis: 'y', keep: 'below', from: yDeck + 0.01, to: yBottom, window: remove } });
  };
  shoring(FF_SLAB, L.floor, L.slabBottom, 'ff-shoring', [0.262, 0.295], [0.46, 0.5]);

  add('ff-slab', 'structure', [
    {
      geometry: merge([
        ...FF_SLAB.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, L.slabBottom, L.slabTop, d0, d1))),
      ]),
      material: 'concrete',
    },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 5.9, to: 23.6, window: [0.295, 0.34] }, cure: { window: [0.34, 0.42] } });

  add('ff-columns', 'structure', [
    { geometry: merge(FF_COLUMNS.map(([x, d]) => applyBoxUV(box(x - 0.1, x + 0.1, L.slabTop, L.roofBottom, d - 0.1, d + 0.1)))), material: 'steelStructural' },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: L.slabTop, to: L.roofBottom, window: [0.34, 0.372] } });

  shoring(ROOF_SLAB, L.slabTop, L.roofBottom, 'roof-shoring', [0.372, 0.4], [0.53, 0.56]);

  add('roof-slab', 'structure', [
    { geometry: merge(ROOF_SLAB.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, L.roofBottom, L.roofTop, d0, d1)))), material: 'concrete' },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 6.1, to: 15.9, window: [0.4, 0.435] }, cure: { window: [0.435, 0.5] } });

  // Tube-and-coupler scaffolding along the street façade and the east side.
  {
    const tubes = [];
    const planks = [];
    const lifts = [2.0, 4.0, 6.0, 7.6];
    const run = (a0, a1, b0, b1, along) => {
      // along 'x': standards at d = b0, b1; along 'd': standards at x = b0, b1
      for (let a = a0; a <= a1 + 1e-6; a += 2.0) {
        for (const b of [b0, b1]) {
          const [x, d] = along === 'x' ? [a, b] : [b, a];
          tubes.push(cylinderY(x, d, 0, 8.4, 0.024, 6));
        }
      }
      for (const y of [...lifts, 1.0, 3.0, 5.0, 7.0].sort()) {
        for (const b of [b0, b1]) {
          const p0 = along === 'x' ? [a0, y, b] : [b, y, a0];
          const p1 = along === 'x' ? [a1, y, b] : [b, y, a1];
          tubes.push(rod(p0, p1, 0.022, 6));
        }
      }
      for (const y of lifts) {
        // transoms and boards
        for (let a = a0; a <= a1 + 1e-6; a += 2.0) {
          const p0 = along === 'x' ? [a, y, b0] : [b0, y, a];
          const p1 = along === 'x' ? [a, y, b1] : [b1, y, a];
          tubes.push(rod(p0, p1, 0.022, 6));
        }
        if (along === 'x') planks.push(applyBoxUV(box(a0, a1, y + 0.03, y + 0.07, Math.min(b0, b1) + 0.05, Math.max(b0, b1) - 0.05)));
        else planks.push(applyBoxUV(box(Math.min(b0, b1) + 0.05, Math.max(b0, b1) - 0.05, y + 0.03, y + 0.07, a0, a1)));
      }
      // Diagonal bracing on the outer face
      for (let a = a0; a < a1 - 1e-6; a += 4.0) {
        const b = along === 'x' ? Math.min(b0, b1) : Math.max(b0, b1);
        const p0 = along === 'x' ? [a, 0.1, b] : [b, 0.1, a];
        const p1 = along === 'x' ? [Math.min(a + 4, a1), 7.6, b] : [b, 7.6, Math.min(a + 4, a1)];
        tubes.push(rod(p0, p1, 0.02, 5));
      }
    };
    run(-4.6, 7.4, 4.75, 5.7, 'x');
    run(6.0, 16.0, 7.85, 8.8, 'd');
    add('scaffold', 'structure', [
      { geometry: merge(tubes), material: 'steelGalv' },
      { geometry: merge(planks), material: 'timberDark' },
    ], {
      build: { type: 'clip', axis: 'y', keep: 'below', from: 0, to: 8.45, window: [0.235, 0.44] },
      remove: { type: 'clip', axis: 'y', keep: 'below', from: 8.45, to: 0, window: [0.8, 0.86] },
    });
  }

  // ------------------------------------------------------------ masonry
  const gfWalls = walls.filter((w) => w.id.startsWith('gf'));
  const ffWalls = walls.filter((w) => w.id.startsWith('ff'));
  add('gf-brick', 'masonry', [
    {
      geometry: merge([
        ...gfWalls.map((w) => applyBoxUV(wall(w.spec))),
        ...STONE_WALL.map((s) => applyBoxUV(box(s.x0, s.x1, s.y0, s.y1, s.d0, s.d1))),
      ]),
      material: 'brick',
    },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: 0, to: L.slabBottom, window: [0.42, 0.5], quantize: COURSE } });

  add('ff-brick', 'masonry', [
    { geometry: merge(ffWalls.map((w) => applyBoxUV(wall(w.spec)))), material: 'brick' },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: L.slabTop, to: L.parapet, window: [0.48, 0.565], quantize: COURSE } });

  // ------------------------------------------------------------ envelope
  const slabSkin = merge(FF_SLAB.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0 - 0.02, x1 + 0.02, L.slabBottom - 0.01, L.slabTop + 0.01, d0 - 0.02, d1 + 0.02))));
  add('slab-fascia', 'envelope', [{ geometry: slabSkin, material: 'plasterWarm' }], {
    build: { type: 'clip', axis: 'x', keep: 'below', from: -7.6, to: 7.6, window: [0.565, 0.6] },
  });

  add('ff-render', 'envelope', [
    { geometry: merge(ffWalls.map((w) => applyBoxUV(skin(w.spec, { y0: L.slabTop + 0.01 })))), material: 'plaster' },
  ], { build: { type: 'clip', axis: 'y', keep: 'above', from: L.parapet + 0.01, to: L.slabTop, window: [0.57, 0.64] } });

  const gfFinish = (finish) =>
    merge(
      gfWalls
        .filter((w) => w.finish === finish)
        .map((w) => applyBoxUV(skin(w.spec, { out: finish === 'stone' ? 0.04 : 0.02, y0: 0.02, y1: L.slabBottom - 0.01 }))),
    );
  add('gf-render', 'envelope', [{ geometry: gfFinish('plaster'), material: 'plaster' }], {
    build: { type: 'clip', axis: 'y', keep: 'above', from: L.slabBottom, to: L.floor, window: [0.6, 0.655] },
  });
  add('stone-cladding', 'envelope', [
    {
      geometry: merge([
        gfFinish('stone'),
        // The low garden wall gets a stone cap; the tall one meets the slab.
        ...STONE_WALL.map((s) => applyBoxUV(box(s.x0 - 0.04, s.x1 + 0.04, s.y0, s.y1 < 2 ? s.y1 + 0.04 : s.y1 - 0.005, s.d0 - 0.04, s.d1 + 0.04))),
      ]),
      material: 'stone',
    },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: 0, to: L.slabBottom, window: [0.6, 0.68], quantize: 0.12 } });
  add('timber-cladding', 'envelope', [{ geometry: gfFinish('timber'), material: 'cladding' }], {
    build: { type: 'clip', axis: 'x', keep: 'below', from: -7.3, to: 2.6, window: [0.63, 0.67] },
  });

  // Roof: gravel ballast; terraces: large-format pavers.
  const gravelBeds = [
    [...ROOF_SLAB[0], L.roofTop], // main roof
    [-7.5, 1.0, 20.0, 23.5, L.slabTop + 0.01], // gallery canopy
  ];
  add('roofing', 'envelope', [
    { geometry: merge(gravelBeds.map(([x0, x1, d0, d1, y]) => applyBoxUV(box(x0, x1, y, y + 0.05, d0, d1)))), material: 'gravel', cast: false },
    { geometry: merge(TERRACES.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, L.slabTop + 0.01, L.slabTop + 0.05, d0, d1)))), material: 'pavers', cast: false },
  ], { build: { type: 'clip', axis: 'd', keep: 'below', from: 6.0, to: 23.6, window: [0.64, 0.68] } });

  // Timber soffits under the cantilevers and gallery, with recessed downlights.
  add('soffits', 'envelope', [
    {
      geometry: merge([
        [-4.48, 2.48, 6.02, 7.98],
        [-7.2, 0.98, 20.02, 23.48],
        [2.52, 7.48, 13.52, 15.98],
      ].map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, L.slabBottom - 0.03, L.slabBottom - 0.009, d0, d1), { topAlongD: true }))),
      material: 'cladding',
    },
  ], { build: { type: 'clip', axis: 'x', keep: 'below', from: -7.3, to: 7.6, window: [0.66, 0.695] } });

  // Metal copings on the parapets.
  {
    const t = 0.2 + 0.04;
    const cop = [
      [-4.5 - 0.045, 7.5 + 0.045, 6.0 - 0.045, 6.0 + t - 0.02],
      [-4.5 - 0.045, 7.5 + 0.045, 16.0 - t + 0.02, 16.0 + 0.045],
      [-4.5 - 0.045, -4.5 + t - 0.02, 6.0, 16.0],
      [7.5 - t + 0.02, 7.5 + 0.045, 6.0, 16.0],
    ];
    add('copings', 'envelope', [
      { geometry: merge(cop.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, L.parapet, L.parapet + 0.045, d0, d1)))), material: 'metalDark' },
    ], { build: { type: 'clip', axis: 'x', keep: 'below', from: -4.6, to: 7.6, window: [0.675, 0.7] } });
  }

  // Vertical timber screen over the stair window.
  {
    const slats = [];
    const d0 = 6.0 - 0.02 - 0.16;
    for (let x = 4.15; x <= 7.05; x += 0.11) slats.push(applyBoxUV(box(x, x + 0.045, 3.72, 6.62, d0 - 0.09, d0)));
    slats.push(applyBoxUV(box(4.1, 7.12, 3.68, 3.72, d0 - 0.06, 6.0 - 0.02)));
    slats.push(applyBoxUV(box(4.1, 7.12, 6.62, 6.66, d0 - 0.06, 6.0 - 0.02)));
    add('timber-screen', 'envelope', [{ geometry: merge(slats), material: 'timber' }], {
      build: { type: 'clip', axis: 'x', keep: 'below', from: 4.05, to: 7.2, window: [0.685, 0.71] },
    });
  }

  // ------------------------------------------------------------ openings
  const openingUnits = [];
  for (const w of walls) {
    for (const o of w.spec.openings || []) {
      if (o.garage) continue;
      const finishOut = w.finish === 'stone' ? 0.04 : 0.02;
      const opening = { a0: o.a0 + 0.02, a1: o.a1 - 0.02, y0: o.y0 + (o.y0 <= w.spec.y0 + 1e-4 ? 0 : 0.02), y1: o.y1 - 0.02 };
      const isDoor = o.win?.door;
      if (isDoor) {
        // Pivot door in dark timber + glazed sidelight.
        const split = opening.a0 + (opening.a1 - opening.a0) * o.win.doorSplit;
        const door = windowUnit({ ...w.spec, face: w.spec.face - w.spec.inward * finishOut }, { ...opening, a1: split }, { inset: 0.12, glow: 0, sill: false });
        const side = windowUnit({ ...w.spec, face: w.spec.face - w.spec.inward * finishOut }, { ...opening, a0: split }, { inset: 0.12, glow: o.win.glow, sill: false });
        openingUnits.push({ wall: w, door, side, a: (opening.a0 + opening.a1) / 2 });
      } else {
        const unit = windowUnit({ ...w.spec, face: w.spec.face - w.spec.inward * finishOut }, opening, { inset: 0.1, mullions: o.win?.mullions || 0, glow: o.win?.glow ?? 1 });
        openingUnits.push({ wall: w, unit, a: (opening.a0 + opening.a1) / 2 });
      }
    }
  }
  // Install ground floor first, then upper floor, in reading order.
  openingUnits.sort((a, b) => (a.wall.id.startsWith('gf') === b.wall.id.startsWith('gf') ? a.a - b.a : a.wall.id.startsWith('gf') ? -1 : 1));
  openingUnits.forEach((u, i) => {
    const t0 = 0.7 + (i / openingUnits.length) * 0.085;
    // Units are set in from inside the building (local space: design d maps to -z).
    const dir = u.wall.spec.inward;
    const offset = u.wall.spec.plane === 'd' ? [0, 0, -dir * 0.4] : [dir * 0.4, 0, 0];
    if (u.door) {
      add(`door-${i}`, 'openings', [
        { geometry: u.door.frame, material: 'metalDark' },
        { geometry: applyBoxUV(u.door.glass), material: 'timberDark' },
        { geometry: u.side.frame, material: 'metalDark' },
        { geometry: u.side.glass, material: 'glass' },
      ], { build: { type: 'slide', window: [t0, t0 + 0.02], offset } });
    } else {
      add(`window-${i}`, 'openings', [
        { geometry: u.unit.frame, material: 'metalDark' },
        { geometry: u.unit.glass, material: 'glass' },
      ], { build: { type: 'slide', window: [t0, t0 + 0.018], offset } });
    }
  });

  // Garage door: vertical timber slats, lowered into place.
  {
    const slats = [];
    const face = 6.0 - 0.04;
    for (let x = 3.02; x < 6.98; x += 0.085) slats.push(applyBoxUV(box(x, x + 0.075, L.floor, 2.73, face + 0.08, face + 0.12)));
    add('garage-door', 'openings', [{ geometry: merge(slats), material: 'timberDark' }], {
      build: { type: 'clip', axis: 'y', keep: 'above', from: 2.74, to: L.floor, window: [0.775, 0.8] },
    });
  }

  // Frameless glass balustrades on the terraces.
  {
    const y0 = L.slabTop + 0.05;
    const y1 = y0 + 1.05;
    const runs = [
      [-7.5 + 0.06, -7.5 + 0.072, 8.05, 19.95],
      [-7.45, 2.45, 19.95 - 0.072, 19.95 - 0.06],
      [-7.45, -4.55, 8.06, 8.072],
      [2.5 - 0.072, 2.5 - 0.06, 16.05, 19.95],
    ];
    const glass = merge(runs.map(([x0, x1, d0, d1]) => applyBoxUV(box(x0, x1, y0, y1, d0, d1))));
    const rails = merge(runs.flatMap(([x0, x1, d0, d1]) => {
      const cx = (x0 + x1) / 2;
      const cd = (d0 + d1) / 2;
      const alongX = x1 - x0 > d1 - d0;
      return [
        applyBoxUV(alongX ? box(x0, x1, y1, y1 + 0.04, cd - 0.025, cd + 0.025) : box(cx - 0.025, cx + 0.025, y1, y1 + 0.04, d0, d1)),
        applyBoxUV(alongX ? box(x0, x1, y0 - 0.05, y0 + 0.06, cd - 0.035, cd + 0.035) : box(cx - 0.035, cx + 0.035, y0 - 0.05, y0 + 0.06, d0, d1)),
      ];
    }));
    add('balustrades', 'openings', [
      { geometry: rails, material: 'metalDark' },
      { geometry: glass, material: 'glassRail', cast: false, renderOrder: 5 },
    ], { build: { type: 'clip', axis: 'y', keep: 'below', from: y0 - 0.06, to: y1 + 0.05, window: [0.79, 0.82] } });
  }

  // ------------------------------------------------------------ landscape
  add('porch-plinth', 'landscape', [
    { geometry: merge([applyBoxUV(box(-4.5, 2.5, 0, L.floor - 0.005, 5.5, 8.0))]), material: 'pavers' },
  ], { build: { type: 'clip', axis: 'y', keep: 'below', from: 0, to: L.floor, window: [0.83, 0.85] } });

  add('driveway', 'landscape', [
    { geometry: merge([applyBoxUV(box(2.9, 7.1, 0, 0.07, -3.2, 6.0), { topAlongD: true })]), material: 'pavers', cast: false },
  ], { build: { type: 'clip', axis: 'd', keep: 'above', from: 6.0, to: -3.2, window: [0.83, 0.865] } });

  {
    const slabs = [];
    for (let d = -2.9; d < 5.0; d += 1.12) slabs.push([-0.15, 1.05, d, d + 0.52]);
    slabs.forEach(([x0, x1, d0, d1], i) => {
      const t0 = 0.845 + i * 0.004;
      add(`step-${i}`, 'landscape', [{ geometry: applyBoxUV(box(x0, x1, 0, 0.06, d0, d1)), material: 'concreteLight', cast: false }], {
        build: { type: 'pop', window: [t0, t0 + 0.008], anchor: [(x0 + x1) / 2, 0, (d0 + d1) / 2] },
      });
    });
  }

  add('deck', 'landscape', [
    { geometry: merge([applyBoxUV(box(-7.2, 4.6, 0.12, L.floor - 0.005, 20.0, 24.95), { topAlongD: false })]), material: 'deck' },
  ], { build: { type: 'clip', axis: 'x', keep: 'below', from: -7.3, to: 4.7, window: [0.835, 0.875] } });

  {
    const P = POOL;
    const c0 = 0.2;
    const c1 = L.floor;
    const coping = merge([
      box(P.x0 - 0.5, P.x1 + 0.5, c0, c1, P.d0 - 0.35, P.d0),
      box(P.x0 - 0.5, P.x1 + 0.5, c0, c1, P.d1, P.d1 + 0.5),
      box(P.x0 - 0.5, P.x0, c0, c1, P.d0, P.d1),
      box(P.x1, P.x1 + 0.5, c0, c1, P.d0, P.d1),
    ].map((g) => applyBoxUV(g)));
    add('pool-coping', 'landscape', [{ geometry: coping, material: 'concreteLight' }], {
      build: { type: 'clip', axis: 'x', keep: 'below', from: P.x0 - 0.6, to: P.x1 + 0.6, window: [0.84, 0.86] },
    });
    const finish = merge([
      box(P.x0, P.x1, -P.depth, -P.depth + 0.01, P.d0, P.d1),
      box(P.x0, P.x0 + 0.01, -P.depth, c0, P.d0, P.d1),
      box(P.x1 - 0.01, P.x1, -P.depth, c0, P.d0, P.d1),
      box(P.x0, P.x1, -P.depth, c0, P.d0, P.d0 + 0.01),
      box(P.x0, P.x1, -P.depth, c0, P.d1 - 0.01, P.d1),
    ].map((g) => applyBoxUV(g)));
    add('pool-finish', 'landscape', [{ geometry: finish, material: 'poolTile', cast: false }], {
      build: { type: 'clip', axis: 'y', keep: 'below', from: -P.depth, to: c0, window: [0.845, 0.865] },
    });
    const water = new THREE.PlaneGeometry(P.x1 - P.x0 - 0.02, P.d1 - P.d0 - 0.02);
    water.rotateX(-Math.PI / 2);
    water.translate((P.x0 + P.x1) / 2, 0, -(P.d0 + P.d1) / 2);
    const wuv = water.attributes.uv;
    const wp = water.attributes.position;
    for (let k = 0; k < wuv.count; k++) wuv.setXY(k, wp.getX(k), wp.getZ(k));
    add('pool-water', 'landscape', [{ geometry: water, material: 'water', cast: false, receive: true, renderOrder: 4 }], {
      build: { type: 'fill', window: [0.866, 0.91], from: -P.depth + 0.05, to: 0.12 },
    });
  }

  // Planting
  if (plantKit) {
    const plants = [];
    const palmMat = plantKit.palmMaterials;
    const palms = [
      [5.6, 26.8, 7.2, 3],
      [6.7, 29.2, 8.6, 9],
      [-8.7, 31.0, 9.2, 17],
    ];
    for (const [x, d, h, seed] of palms) {
      const geo = plantKit.makePalm(seed, h);
      plants.push({ parts: [{ geometry: geo.trunk, material: palmMat.trunkMat }, { geometry: geo.leaves, material: palmMat.frondMat }], x, d, rot: seed });
    }
    const species = plantKit.species;
    const tree = (kind, x, d, scale, rot) => {
      const sp = species[kind] || plantKit.ensure?.(kind);
      if (!sp) return;
      const v = sp.variants[(Math.round(x * 3) & 1) % sp.variants.length];
      plants.push({ parts: [{ geometry: v.branches, material: sp.bark }, { geometry: v.leaves, material: sp.leaf }], x, d, scale, rot });
    };
    tree('canopyMedium', 5.2, 36.0, 0.8, 1.2);
    tree('canopyMedium', -8.3, 2.0, 0.62, 2.4);
    for (const [x, d, k] of [[-7.6, 38.5, 'shrub'], [-4.5, 38.8, 'shrubB'], [-1.2, 38.4, 'shrub'], [2.4, 38.9, 'shrubB'], [-8.4, 14.5, 'shrubB'], [-8.5, 18.0, 'shrub'], [8.6, 21.0, 'shrub'], [8.5, 25.0, 'shrubB']]) {
      tree(k, x, d, 0.9, x * 2.1);
    }
    plants.forEach((p, i) => {
      const t0 = 0.87 + (i / plants.length) * 0.05;
      // The residence group is scaled horizontally to fit each lot; a
      // counter-scaled anchor keeps every plant's own proportions.
      const anchor = new THREE.Group();
      anchor.position.set(p.x, 0, -p.d);
      anchor.userData.keepProportions = true;
      group.add(anchor);
      const holder = new THREE.Group();
      holder.rotation.y = p.rot || 0;
      holder.userData.finalScale = p.scale || 1;
      for (const part of p.parts) {
        const m = new THREE.Mesh(part.geometry, part.material);
        m.castShadow = true;
        m.receiveShadow = true;
        holder.add(m);
      }
      anchor.add(holder);
      components.push({ id: `plant-${i}`, stage: 'landscape', meshes: [], holder, shared: true, build: { type: 'grow', window: [t0, t0 + 0.03] } });
    });

    // Ornamental grasses along the stone wall, the driveway and the deck.
    const clump = grassClumpGeometry(3);
    const clumpMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    const spots = [];
    const rnd = mulberry32(77);
    for (let d = 3.9; d < 7.7; d += 0.42) spots.push([-6.75 + rnd() * 0.25, d]);
    for (let d = 0.4; d < 5.6; d += 0.5) spots.push([2.55 + rnd() * 0.15, d]);
    for (let x = -6.9; x < 4.4; x += 0.55) spots.push([x, 30.05 + rnd() * 0.2]);
    const inst = new THREE.InstancedMesh(clump, clumpMat, spots.length);
    const mtx = new THREE.Matrix4();
    spots.forEach(([x, d], i) => {
      mtx.compose(new THREE.Vector3(x, 0, -d), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28), new THREE.Vector3(1, 0.85 + rnd() * 0.4, 1).multiplyScalar(0.9 + rnd() * 0.3));
      inst.setMatrixAt(i, mtx);
    });
    inst.castShadow = true;
    inst.receiveShadow = true;
    group.add(inst);
    components.push({ id: 'grasses', stage: 'landscape', meshes: [], holder: inst, build: { type: 'grow', window: [0.885, 0.935] }, owned: [clump, clumpMat] });
  }

  // A real lawn in the landscaped garden: instanced tufts, kept off the house,
  // terraces, paving and planting beds.
  if (lawnDetail) {
    const blocked = [
      [-7.65, 7.65, 5.35, 24.1],
      [-7.35, 4.75, 19.85, 30.35],
      [2.75, 7.25, -0.1, 6.1],
      [-7.7, -7.0, 3.3, 8.0],
      [-7.1, -6.4, 3.6, 7.9],
      [2.45, 2.85, 0.2, 5.8],
      [-7.1, 4.6, 29.8, 30.6],
    ];
    const rnd = mulberry32(91);
    const spots = [];
    const step = 0.13;
    for (let x = -9.75; x <= 9.75; x += step) {
      for (let d = 0.25; d <= 39.75; d += step) {
        const px = x + (rnd() - 0.5) * step;
        const pd = d + (rnd() - 0.5) * step;
        if (blocked.some(([x0, x1, d0, d1]) => px > x0 && px < x1 && pd > d0 && pd < d1)) continue;
        // Stepping slabs keep their joints of grass.
        if (px > -0.2 && px < 1.1 && pd > -3 && pd < 5.4 && ((pd + 2.9) % 1.12) < 0.56) continue;
        spots.push([px, pd]);
      }
    }
    const tuft = lawnTuftGeometry(12);
    const tuftMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 });
    const lawn = new THREE.InstancedMesh(tuft, tuftMat, spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    spots.forEach(([x, d], i) => {
      const s = 0.8 + rnd() * 0.5;
      m.compose(new THREE.Vector3(x, 0, -d), q.setFromAxisAngle(up, rnd() * 6.28), new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s));
      lawn.setMatrixAt(i, m);
      const k = rnd();
      lawn.setColorAt(i, c.setRGB(0.9 + k * 0.25, 0.92 + k * 0.18, 0.8 + k * 0.1));
    });
    lawn.receiveShadow = true;
    lawn.castShadow = false;
    lawn.computeBoundingSphere();
    group.add(lawn);
    components.push({ id: 'lawn', stage: 'landscape', meshes: [], holder: lawn, build: { type: 'growY', window: [0.845, 0.93] }, owned: [tuft, tuftMat] });
  }

  // ------------------------------------------------------------ completion
  {
    const lights = [];
    for (const [x, d] of [[-3.2, 7.0], [-0.6, 7.0], [1.8, 7.0], [-5.6, 21.7], [-2.2, 21.7], [5.0, 14.75]]) {
      const disc = new THREE.CircleGeometry(0.055, 16);
      disc.rotateX(Math.PI / 2);
      disc.translate(x, L.slabBottom - 0.032, -d);
      lights.push(disc);
    }
    add('downlights', 'complete', [{ geometry: merge(lights), material: 'downlight', cast: false, receive: false }], {
      build: { type: 'fade', window: [0.95, 1.0], to: 1 },
    });
  }
  components.push({ id: 'interior-light', stage: 'complete', meshes: [], effect: 'glow', build: { type: 'effect', window: [0.925, 1.0] } });

  return {
    group,
    components,
    pool: POOL,
    // Lot-local rectangle where the terrain is cut away for the pool basin.
    terrainHole: { x0: POOL.x0 - 0.12, x1: POOL.x1 + 0.12, d0: POOL.d0 - 0.12, d1: POOL.d1 + 0.12 },
    /** Fits the concept's plan to a lot (x across the frontage, z in depth); heights are kept. */
    fitToLot(scale) {
      group.scale.set(scale.x, 1, scale.z);
      for (const child of group.children) {
        if (child.userData.keepProportions) child.scale.set(1 / scale.x, 1, 1 / scale.z);
      }
      group.updateMatrixWorld(true);
    },
    dispose() {
      const seen = new Set();
      group.traverse((o) => {
        if (o.isMesh && !seen.has(o.geometry) && !o.userData.sharedGeometry) {
          seen.add(o.geometry);
        }
      });
      for (const c of components) {
        if (c.shared) continue;
        for (const m of c.meshes) m.geometry.dispose();
        if (c.owned) for (const o of c.owned) o.dispose();
      }
    },
  };
}

/** Interior-light shader for the shared glass material: warm, ceiling-weighted glow per pane. */
export function installGlassGlow(glass) {
  glass.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nattribute vec2 paneUv;\nvarying float vGlow;\nvarying vec2 vPaneUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvPaneUv = paneUv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlow;\nvarying vec2 vPaneUv;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        // Lit ceiling towards the top of the pane, furniture shadow low down,
        // light pooling towards the middle of the room.
        float ceiling = mix(0.3, 1.0, smoothstep(0.35, 1.0, vPaneUv.y));
        float furniture = mix(0.55, 1.0, smoothstep(0.12, 0.4, vPaneUv.y));
        float pool = 0.65 + 0.35 * (1.0 - abs(vPaneUv.x - 0.5) * 2.0);
        totalEmissiveRadiance *= vGlow * ceiling * furniture * pool;`,
      );
  };
  glass.customProgramCacheKey = () => 'glass-glow';
}
