// Geometry helpers for the residence, expressed in lot design coordinates:
//   x  – metres to the right when facing the house from the street
//   y  – metres above natural ground
//   d  – metres into the lot from the street frontage
// Three.js local space is (x, y, -d), so a house group's +Z faces the street.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Non-indexed copy with UVs in metres projected along each face's dominant axis. */
export function applyBoxUV(geometry, { topAlongD = false } = {}) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    n.subVectors(c, b).cross(new THREE.Vector3().subVectors(a, b)).normalize();
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    for (let k = 0; k < 3; k++) {
      const v = [a, b, c][k];
      let u;
      let w;
      if (ay >= ax && ay >= az) {
        u = topAlongD ? v.z : v.x;
        w = topAlongD ? v.x : v.z;
      } else if (ax >= az) {
        u = v.z * Math.sign(n.x || 1);
        w = v.y;
      } else {
        u = -v.x * Math.sign(n.z || 1);
        w = v.y;
      }
      uv[(i + k) * 2] = u;
      uv[(i + k) * 2 + 1] = w;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Axis-aligned box from design-space extents. */
export function box(x0, x1, y0, y1, d0, d1) {
  const g = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(d1 - d0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, -(d0 + d1) / 2);
  return g;
}

/** Vertical cylinder (columns, props, scaffold standards). */
export function cylinderY(x, d, y0, y1, r, segments = 8) {
  const g = new THREE.CylinderGeometry(r, r, y1 - y0, segments, 1, false);
  g.translate(x, (y0 + y1) / 2, -d);
  return g;
}

/** Cylinder between two design-space points. */
export function rod(p0, p1, r, segments = 6) {
  const a = new THREE.Vector3(p0[0], p0[1], -p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], -p1[2]);
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, segments, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

function flipWinding(g) {
  const pos = g.attributes.position;
  const attrs = Object.values(g.attributes);
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of attrs) {
      const s = attr.itemSize;
      for (let k = 0; k < s; k++) {
        const t = attr.array[(i + 1) * s + k];
        attr.array[(i + 1) * s + k] = attr.array[(i + 2) * s + k];
        attr.array[(i + 2) * s + k] = t;
      }
    }
  }
}

/**
 * A wall slab with real openings.
 * @param {{ plane: 'd'|'x', face: number, inward: 1|-1, from: number, to: number,
 *           y0: number, y1: number, thickness: number,
 *           openings?: { a0: number, a1: number, y0: number, y1: number }[] }} spec
 *   plane 'd': the wall runs along x at d = face; plane 'x': it runs along d at x = face.
 *   `inward` is the direction (along d or x) from the exterior face into the building.
 */
export function wall(spec) {
  const { plane, face, inward, from, to, y0, y1, thickness, openings = [] } = spec;
  const eps = 1e-4;
  const bottom = openings.filter((o) => o.y0 <= y0 + eps).sort((a, b) => a.a0 - b.a0);
  const holes = openings.filter((o) => o.y0 > y0 + eps);

  const pts = [new THREE.Vector2(from, y0)];
  for (const o of bottom) {
    pts.push(new THREE.Vector2(o.a0, y0), new THREE.Vector2(o.a0, o.y1), new THREE.Vector2(o.a1, o.y1), new THREE.Vector2(o.a1, y0));
  }
  pts.push(new THREE.Vector2(to, y0), new THREE.Vector2(to, y1), new THREE.Vector2(from, y1));
  const shape = new THREE.Shape(pts);
  for (const o of holes) {
    const h = new THREE.Path([new THREE.Vector2(o.a0, o.y0), new THREE.Vector2(o.a1, o.y0), new THREE.Vector2(o.a1, o.y1), new THREE.Vector2(o.a0, o.y1)]);
    shape.holes.push(h);
  }
  let g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
  g = g.toNonIndexed();
  // Map (a, y, e) -> local three space.
  const m = new THREE.Matrix4();
  if (plane === 'd') {
    // x = a, y = y, z = -(face + inward * e)
    m.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -inward, -face, 0, 0, 0, 1);
  } else {
    // x = face + inward * e, y = y, z = -a
    m.set(0, 0, inward, face, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  }
  g.applyMatrix4(m);
  if (m.determinant() < 0) flipWinding(g);
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return g;
}

/** Same wall, grown outward by `out` on the exterior face (and inward by `inner`), openings shrunk by `reveal`. */
export function skin(spec, { out = 0.02, inner = 0.02, reveal = 0.02, y0, y1 } = {}) {
  return wall({
    ...spec,
    face: spec.face - spec.inward * out,
    thickness: spec.thickness + out + inner,
    y0: y0 ?? spec.y0,
    y1: y1 ?? spec.y1,
    openings: (spec.openings || []).map((o) => ({
      a0: o.a0 + reveal,
      a1: o.a1 - reveal,
      y0: o.y0 <= spec.y0 + 1e-4 ? (y0 ?? spec.y0) : o.y0 + reveal,
      y1: o.y1 - reveal,
    })),
  });
}

/**
 * Window or glazed door set into an opening: perimeter frame, mullions, and
 * glass panes (with per-pane UVs for the interior glow).
 * @returns {{ frame: THREE.BufferGeometry, glass: THREE.BufferGeometry }}
 */
export function windowUnit(spec, opening, { mullions = 0, transom = null, inset = 0.1, frame = 0.055, depth = 0.07, glow = 1, sill = true } = {}) {
  const { plane, face, inward } = spec;
  const a0 = opening.a0;
  const a1 = opening.a1;
  const y0 = opening.y0;
  const y1 = opening.y1;
  const e = inset; // distance from the exterior face to the frame's outer face
  const frameParts = [];
  const glassParts = [];
  const place = (ga0, ga1, gy0, gy1, e0, e1) => {
    // returns design-space box -> local
    if (plane === 'd') {
      const d0 = face + inward * e0;
      const d1 = face + inward * e1;
      return box(ga0, ga1, gy0, gy1, Math.min(d0, d1), Math.max(d0, d1));
    }
    const x0 = face + inward * e0;
    const x1 = face + inward * e1;
    return box(Math.min(x0, x1), Math.max(x0, x1), gy0, gy1, ga0, ga1);
  };
  // Perimeter
  frameParts.push(place(a0, a1, y0, y0 + frame, e, e + depth));
  frameParts.push(place(a0, a1, y1 - frame, y1, e, e + depth));
  frameParts.push(place(a0, a0 + frame, y0, y1, e, e + depth));
  frameParts.push(place(a1 - frame, a1, y0, y1, e, e + depth));
  // Mullions
  const cuts = [a0 + frame];
  for (let i = 1; i <= mullions; i++) {
    const m = a0 + ((a1 - a0) * i) / (mullions + 1);
    frameParts.push(place(m - frame * 0.6, m + frame * 0.6, y0, y1, e + 0.005, e + depth - 0.005));
    cuts.push(m - frame * 0.6, m + frame * 0.6);
  }
  cuts.push(a1 - frame);
  if (transom) frameParts.push(place(a0, a1, transom - frame * 0.5, transom + frame * 0.5, e + 0.005, e + depth - 0.005));
  // Sill (exterior drip) for raised windows
  if (sill && y0 > 0.5) frameParts.push(place(a0 - 0.03, a1 + 0.03, y0 - 0.035, y0 + 0.005, -0.035, e + 0.02));

  // Glass panes in the middle of the frame depth
  const gm = e + depth * 0.5;
  for (let i = 0; i < cuts.length; i += 2) {
    const ga0 = cuts[i];
    const ga1 = cuts[i + 1];
    const pane = place(ga0, ga1, y0 + frame, y1 - frame, gm - 0.006, gm + 0.006);
    // Pane UVs (0..1) and a glow factor for the interior-light shader.
    const nonIdx = pane.toNonIndexed();
    const p = nonIdx.attributes.position;
    const uv = new Float32Array(p.count * 2);
    const glowAttr = new Float32Array(p.count);
    for (let k = 0; k < p.count; k++) {
      const along = plane === 'd' ? p.getX(k) : -p.getZ(k);
      uv[k * 2] = (along - ga0) / Math.max(0.001, ga1 - ga0);
      uv[k * 2 + 1] = (p.getY(k) - (y0 + frame)) / Math.max(0.001, y1 - y0 - frame * 2);
      // Rooms differ: some brightly lit, some barely.
      const r = ((i * 7919 + Math.round(ga0 * 13) * 31) % 17) / 17;
      glowAttr[k] = glow * (r < 0.2 ? 0.15 : 0.55 + 0.6 * r);
    }
    nonIdx.deleteAttribute('uv');
    nonIdx.setAttribute('paneUv', new THREE.BufferAttribute(uv, 2));
    nonIdx.setAttribute('glow', new THREE.BufferAttribute(glowAttr, 1));
    glassParts.push(nonIdx);
    pane.dispose();
  }
  return { frame: merge(frameParts.map((g) => applyBoxUV(g))), glass: merge(glassParts) };
}

/** Merge geometries (normalising to non-indexed with matching attributes). */
export function merge(list) {
  const clean = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  if (!clean.length) return new THREE.BufferGeometry();
  const names = Object.keys(clean[0].attributes);
  for (const g of clean) {
    for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    for (const n of names) {
      if (!g.attributes[n]) {
        const size = clean[0].attributes[n].itemSize;
        g.setAttribute(n, new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * size), size));
      }
    }
  }
  const merged = mergeGeometries(clean, false);
  return merged;
}

/** Boxes -> one merged, box-UV-mapped geometry. */
export function boxes(list, options) {
  return merge(list.map((b) => applyBoxUV(box(...b), options)));
}
