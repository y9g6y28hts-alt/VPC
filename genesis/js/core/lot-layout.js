// 2D planning geometry for the masterplan: road centrelines as arc-length
// parametrised splines and lots laid out along them. Coordinates are metres in
// the ground plane, {x, z}, matching world X/Z of the 3D scene (Y is up).

/** Uniform Catmull-Rom path through `points`, resampled by arc length. */
export function createPath(points, { samples = 800 } = {}) {
  if (points.length < 2) throw new Error('A path needs at least two points');
  const pts = [points[0], ...points, points[points.length - 1]];
  const dense = [];
  const segs = points.length - 1;
  for (let i = 0; i < segs; i++) {
    const [p0, p1, p2, p3] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const n = Math.ceil(samples / segs);
    for (let j = 0; j < n; j++) {
      const t = j / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  dense.push({ ...points[points.length - 1] });

  const lengths = [0];
  for (let i = 1; i < dense.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].z - dense[i - 1].z));
  }
  const length = lengths[lengths.length - 1];

  function locate(s) {
    const d = Math.min(Math.max(s, 0), length);
    let lo = 0;
    let hi = lengths.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (lengths[mid] <= d) lo = mid;
      else hi = mid;
    }
    const span = lengths[hi] - lengths[lo] || 1;
    return { i: lo, f: (d - lengths[lo]) / span };
  }

  function pointAt(s) {
    const { i, f } = locate(s);
    const a = dense[i];
    const b = dense[Math.min(i + 1, dense.length - 1)];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
  }

  function tangentAt(s) {
    const e = Math.min(1, length / 1000);
    const a = pointAt(s - e);
    const b = pointAt(s + e);
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: (b.x - a.x) / l, z: (b.z - a.z) / l };
  }

  /** Unit normal; side +1 and -1 select the two sides of the road. */
  function normalAt(s, side = 1) {
    const t = tangentAt(s);
    return { x: -t.z * side, z: t.x * side };
  }

  return { length, pointAt, tangentAt, normalAt, points: dense };
}

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly) {
  const c = poly.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
  return { x: c.x / poly.length, z: c.z / poly.length };
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Intersection area of two convex polygons (Sutherland–Hodgman clipping). */
export function convexIntersectionArea(a, b) {
  const ccw = (poly) => (signedArea(poly) < 0 ? [...poly].reverse() : poly);
  let output = ccw(a);
  const clip = ccw(b);
  for (let i = 0; i < clip.length && output.length; i++) {
    const c0 = clip[i];
    const c1 = clip[(i + 1) % clip.length];
    const inside = (p) => (c1.x - c0.x) * (p.z - c0.z) - (c1.z - c0.z) * (p.x - c0.x) >= 0;
    const intersect = (p, q) => {
      const a1 = c1.z - c0.z;
      const b1 = c0.x - c1.x;
      const d1 = a1 * c0.x + b1 * c0.z;
      const a2 = q.z - p.z;
      const b2 = p.x - q.x;
      const d2 = a2 * p.x + b2 * p.z;
      const det = a1 * b2 - a2 * b1;
      if (Math.abs(det) < 1e-12) return p;
      return { x: (b2 * d1 - b1 * d2) / det, z: (a1 * d2 - a2 * d1) / det };
    };
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j];
      const q = input[(j + 1) % input.length];
      if (inside(q)) {
        if (!inside(p)) output.push(intersect(p, q));
        output.push(q);
      } else if (inside(p)) {
        output.push(intersect(p, q));
      }
    }
  }
  return output.length >= 3 ? polygonArea(output) : 0;
}

/** Shortest distance from point p to a polyline. */
export function distanceToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2));
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)));
  }
  return best;
}

/**
 * Local frame of a lot. `origin` is the middle of the street frontage, `inward`
 * points from the street into the lot and `right` is to the right of a person
 * standing on the street looking into the lot. `rotationY` orients an object
 * whose +Z axis is its street-facing front.
 */
export function lotFrame(polygon) {
  const [f0, f1, b1, b0] = polygon;
  const origin = { x: (f0.x + f1.x) / 2, z: (f0.z + f1.z) / 2 };
  const back = { x: (b0.x + b1.x) / 2, z: (b0.z + b1.z) / 2 };
  const len = Math.hypot(back.x - origin.x, back.z - origin.z) || 1;
  const inward = { x: (back.x - origin.x) / len, z: (back.z - origin.z) / len };
  const right = { x: -inward.z, z: inward.x };
  return { origin, inward, right, depth: len, rotationY: Math.atan2(-inward.x, -inward.z) };
}

/** Converts lot-local design coordinates (x to the right, d into the lot) to world. */
export function lotToWorld(frame, x, d) {
  return {
    x: frame.origin.x + frame.right.x * x + frame.inward.x * d,
    z: frame.origin.z + frame.right.z * x + frame.inward.z * d,
  };
}

/**
 * Lays out lots along one side of a road path.
 * @param {ReturnType<typeof createPath>} path
 * @param {{ side: 1|-1, from: number, to: number, width: number, depth: number,
 *           setback: number, block: string, skip?: [number, number][] }} options
 */
export function layoutLots(path, { side, from, to, width, depth, setback, block, skip = [] }) {
  const lots = [];
  let number = 1;
  for (let s = from; s + width <= to + 1e-6; s += width) {
    const s1 = s + width;
    if (skip.some(([a, b]) => s1 > a && s < b)) continue;
    const corner = (station, offset) => {
      const p = path.pointAt(station);
      const n = path.normalAt(station, side);
      return { x: p.x + n.x * offset, z: p.z + n.z * offset };
    };
    // Order: front-start, front-end, back-end, back-start. Re-ordered below so
    // that polygon[0] is front-left as seen from the street.
    let polygon = [corner(s, setback), corner(s1, setback), corner(s1, setback + depth), corner(s, setback + depth)];
    const frame = lotFrame(polygon);
    const a = polygon[0];
    const rel = (a.x - frame.origin.x) * frame.right.x + (a.z - frame.origin.z) * frame.right.z;
    if (rel > 0) polygon = [polygon[1], polygon[0], polygon[3], polygon[2]];
    const finalFrame = lotFrame(polygon);
    const frontage = Math.hypot(polygon[1].x - polygon[0].x, polygon[1].z - polygon[0].z);
    lots.push({
      id: `${block}-${String(number).padStart(2, '0')}`,
      block,
      number,
      polygon,
      centroid: polygonCentroid(polygon),
      frame: finalFrame,
      frontage,
      depth: finalFrame.depth,
      // Area of the illustrative geometry only; never shown as the real surface.
      sceneAreaM2: polygonArea(polygon),
    });
    number += 1;
  }
  return lots;
}
