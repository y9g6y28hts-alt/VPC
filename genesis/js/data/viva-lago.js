// Viva Lago Country — development data used by the experience.
//
// Layout: the georeferenced subdivision plan ("Proyecto de Loteamiento
// Georreferenciado", Finca 18.485, Ciudad del Este, scale 1/1.000). Geometry,
// lot numbering and surfaces come from js/data/masterplan.js, which is generated
// from the surveyor's PDF by tools/survey/ (see the README).
//
// Commercial data: prices and financing are intentionally not published here.
// Availability is only set where a Génesis document states it; every other lot
// reads "consultar".
import { polygonArea, polygonCentroid, lotFrame, lotToWorld, pointInPolygon } from '../core/lot-layout.js';
import { utmToLatLon } from '../core/geo.js';
import { MONUMENTS, ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, RIVER_EDGE, COMMON_PARCELS, SURVEYED_LOTS, UTM_ORIGIN } from './masterplan.js';

export const DEVELOPMENT = Object.freeze({
  name: 'Viva Lago Country',
  marketedBy: 'Génesis Negocios Inmobiliarios',
  /** 'surveyed': layout, numbering and surfaces from the georeferenced plan. */
  dataStatus: 'surveyed',
  planSource: 'Proyecto de Loteamiento Georreferenciado · Finca 18.485 · escala 1/1.000',
  utmOrigin: UTM_ORIGIN,
  facts: Object.freeze({
    location: 'Zona Quinta, Calle 9 Acaray (km 9) · Ciudad del Este, Alto Paraná',
    totalAreaHa: 2,
    lotCount: SURVEYED_LOTS.length,
    privateAreaM2: 12400.77,
    commonAreaM2: 7599.23,
    amenities: Object.freeze(['Club Náutico & Deportivo', 'Acceso náutico al río Acaray', 'Administración', 'Avenida principal y calles internas']),
    financing: null,
  }),
  // Location pin shared by Génesis.
  mapsUrl: 'https://maps.app.goo.gl/MoXFWMTVsvddWcvg7',
});

/**
 * Centre of the four surveyed monuments in WGS 84 (from the plan's UTM 21S
 * coordinates; the plan's handheld GPS survey states ±0.80 m).
 */
export const SITE_LOCATION = Object.freeze({
  ...utmToLatLon(UTM_ORIGIN.easting, UTM_ORIGIN.northing, { zone: 21, south: true }),
  accuracyM: 0.8,
});

/**
 * Sales material (Génesis brochure, March 2026) numbers the blocks 1–5; the
 * plan letters them A–E. Both are shown so either reference can be used.
 */
export const BROCHURE_BLOCK = Object.freeze({ C: 1, D: 2, B: 3, E: 4, A: 5 });

/** Statuses stated in Génesis documents. Everything else: ask an advisor. */
const KNOWN_AVAILABILITY = Object.freeze({ 'C-02': { value: 'sold', source: 'Folleto Génesis, marzo 2026' } });

/** Conceptual residence shown on any selected lot (not an approved design). */
export const CONCEPT_RESIDENCE = Object.freeze({
  name: 'Residencia conceptual',
  storeys: 2,
  // Design envelope of the concept, in lot-local metres (garden included).
  // It is fitted to each lot's frontage and depth (see houseScale).
  design: { width: 20, depth: 40 },
  status: 'Visualización ilustrativa, adaptada a las medidas de cada lote. No incluida en el precio del lote ni aprobada para construcción.',
});

const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

/** Horizontal fit of the concept to a lot (heights are never scaled). */
export function houseScale(frontage, depth) {
  const { width, depth: d } = CONCEPT_RESIDENCE.design;
  return { x: Math.min(1, Math.max(0.35, (frontage - 0.3) / width)), z: Math.min(1, Math.max(0.35, (depth - 0.3) / d)) };
}

/** Built footprint of the concept (house, terraces, pool) in design metres. */
export const CONCEPT_FOOTPRINT = Object.freeze({ x0: -7.65, x1: 7.65, d0: 3.3, d1: 30.6 });

function footprintInside(frame, scale, polygon) {
  const { x0, x1, d0, d1 } = CONCEPT_FOOTPRINT;
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const x = x0 + ((x1 - x0) * i) / 8;
    pts.push([x, d0], [x, d1]);
  }
  for (let i = 1; i < 16; i++) {
    const d = d0 + ((d1 - d0) * i) / 16;
    pts.push([x0, d], [x1, d]);
  }
  return pts.every(([x, d]) => pointInPolygon(lotToWorld(frame, x * scale.x, d * scale.z), polygon));
}

/**
 * Places the concept on a lot: the street frame may move inward (curved
 * fronts) or sideways (corner lots), and the plan is shrunk only as far as
 * needed for the whole footprint to sit inside the surveyed polygon.
 */
function fitConcept(quad, polygon) {
  const [f0, f1, b1, b0] = quad;
  const frontage = dist(f0, f1);
  const base = lotFrame(quad);
  let best = null;
  for (let shift = 0; shift <= 5.001; shift += 0.5) {
    for (const side of [0, -1.5, 1.5, -3, 3]) {
      const move = (p) => ({ x: p.x + base.inward.x * shift + base.right.x * side, z: p.z + base.inward.z * shift + base.right.z * side });
      const frame = lotFrame([move(f0), move(f1), move(b1), move(b0)]);
      const nominal = houseScale(frontage, frame.depth);
      for (let kz = 1; kz >= 0.6; kz -= 0.05) {
        for (let kx = 1; kx >= 0.7; kx -= 0.1) {
          const scale = { x: nominal.x * kx, z: nominal.z * kz };
          if (scale.x < 0.35 || scale.z < 0.35) continue;
          // Prefer the largest plan, then the least distorted, then the least moved.
          const score = scale.x * scale.z - Math.abs(Math.log(scale.x / scale.z)) * 0.02 - shift * 0.002 - Math.abs(side) * 0.003;
          if (best && score <= best.score) continue;
          if (footprintInside(frame, scale, polygon)) best = { frame, scale, score };
        }
      }
    }
  }
  if (!best) throw new Error('The concept does not fit the lot');
  return best;
}

export const LOTS = SURVEYED_LOTS.map((s) => {
  const fit = fitConcept(s.frameQuad, s.polygon);
  const frontage = dist(s.frameQuad[0], s.frameQuad[1]);
  const known = KNOWN_AVAILABILITY[s.id];
  return {
    id: s.id,
    block: s.block,
    number: s.number,
    brochureBlock: BROCHURE_BLOCK[s.block],
    polygon: s.polygon,
    corners: s.corners,
    centroid: polygonCentroid(s.polygon),
    // Street frame of the house placement (lot-local x across, d into the lot).
    frame: fit.frame,
    frontage,
    depth: fit.frame.depth,
    houseScale: fit.scale,
    sceneAreaM2: polygonArea(s.polygon),
    survey: { ownAreaM2: s.areaM2, commonAreaM2: s.commonAreaM2, totalAreaM2: s.totalAreaM2, sharePct: s.sharePct },
    commercial: {
      areaM2: s.areaM2,
      priceUSD: null,
      availability: known?.value ?? null,
      availabilitySource: known?.source ?? null,
      financing: null,
    },
  };
});

export function findLot(id) {
  return LOTS.find((l) => l.id === id) || null;
}

export const COMMON_AREAS = COMMON_PARCELS.map((c) => ({ ...c, centroid: polygonCentroid(c.polygon) }));

/**
 * The plan's common-area table (ÁREA COMÚN), m². The avenue and both streets
 * are one surveyed road parcel in the drawing, so they share a key plan.
 */
export const COMMON_AREA_TABLE = Object.freeze([
  { id: 'club', name: 'Club Náutico & Deportivo', parcel: 'Manzana D · Lote 01', areaM2: 2141.96, note: 'La parcela más grande del desarrollo, sobre la ribera, en el extremo este.' },
  { id: 'nautico', name: 'Acceso náutico', parcel: 'Entre las manzanas C y D', areaM2: 517.41, note: 'Paso común desde la Calle 2 hasta la orilla del río Acaray.' },
  { id: 'administracion', name: 'Administración', parcel: 'Manzana A · Lote 04', areaM2: 341.7, note: 'Junto al ingreso del barrio, en el extremo oeste.' },
  {
    id: 'calles',
    name: 'Avenida principal y calles 1 y 2',
    parcel: 'Red vial interna',
    areaM2: 4598.16,
    parts: [
      ['Avenida principal', 2358.4],
      ['Calle 1', 1160.5],
      ['Calle 2', 1079.26],
    ],
    note: 'Una avenida recta de este a oeste y dos calles en arco que dan frente a las manzanas.',
  },
]);

// --- Site geometry (local metres, +x east, +z south) --------------------------

/** Title boundary through the four monuments (1 SE, 2 NE, 3 NW, 4 SW). */
export const SITE = Object.freeze([MONUMENTS['1'], MONUMENTS['2'], MONUMENTS['3'], MONUMENTS['4']]);

export { ROADS, NAUTICAL_ACCESS, ENTRANCE_PAD, RIVER_EDGE, MONUMENTS };

export function insideSite(p) {
  return pointInPolygon(p, SITE);
}

const along = (a, b, t, off = 0) => {
  const l = dist(a, b);
  const ux = (b.x - a.x) / l;
  const uz = (b.z - a.z) / l;
  // `off` is to the left of a→b (outside the site for the edges used below).
  return { x: a.x + ux * t - uz * off, z: a.z + uz * t + ux * off };
};

/**
 * Public streets around the site, from the plan's surroundings: "Calle" along
 * the southern boundary and the street the main avenue opens onto in the west.
 * Their surface is not stated on the plan; they are shown as red-earth roads,
 * as on the plan's satellite image.
 */
export const OUTSIDE_STREETS = (() => {
  const [m1, , m3, m4] = SITE;
  const south = [along(m4, m1, -260, 6), along(m4, m1, dist(m4, m1) - 6, 6)];
  const west = [along(m4, m3, -420, -6), along(m4, m3, dist(m4, m3) + 140, -6)];
  return [
    { id: 'calle-sur', width: 8, points: south },
    { id: 'calle-oeste', width: 8, points: west },
  ];
})();

/** The lake: the river edge from the plan, then the open water of the Acaray reservoir to the east. */
export function lakePolygon() {
  const first = RIVER_EDGE[0];
  const last = RIVER_EDGE[RIVER_EDGE.length - 1];
  // Beyond the surveyed edge the shoreline is not part of the plan: a natural,
  // irregular outline is drawn so the water body does not read as a polygon.
  const far = [
    { x: last.x + 40, z: last.z + 120 },
    { x: last.x + 260, z: last.z + 420 },
    { x: 1500, z: 520 },
    { x: 1700, z: -500 },
    { x: 700, z: -1100 },
    { x: first.x + 60, z: first.z - 420 },
    { x: first.x - 10, z: first.z - 140 },
    first,
  ];
  const out = [...RIVER_EDGE];
  let prev = last;
  let k = 0;
  for (const p of far) {
    const l = dist(prev, p);
    const n = Math.max(1, Math.round(l / 30));
    const nx = -(p.z - prev.z) / l;
    const nz = (p.x - prev.x) / l;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      // Fade the wobble out where the outline rejoins the surveyed edge.
      const fade = Math.min(1, dist(prev, first) / 120, dist(p, first) / 120 + (1 - t));
      const w = (Math.sin(k * 0.73) * 9 + Math.sin(k * 1.91 + 1.3) * 5) * (p === first ? fade * (1 - t) : fade);
      if (!(p === first && i === n)) out.push({ x: prev.x + (p.x - prev.x) * t + nx * w, z: prev.z + (p.z - prev.z) * t + nz * w });
      k++;
    }
    prev = p;
  }
  return out;
}
