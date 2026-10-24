// Viva Lago Country — development data used by the experience.
//
// IMPORTANT: no official masterplan, parcel survey, inventory, prices or
// financing terms were available when this was built. Everything spatial below
// is an ILLUSTRATIVE layout for demonstration, and every commercial field is
// null. Replace `dataStatus`, the road/lake geometry and `LOT_RECORDS` with the
// official data before presenting any of it as fact.
import { createPath, layoutLots } from '../core/lot-layout.js';

export const DEVELOPMENT = Object.freeze({
  name: 'Viva Lago Country',
  marketedBy: 'Génesis Negocios Inmobiliarios',
  /** 'conceptual' until the official masterplan and inventory are integrated. */
  dataStatus: 'conceptual',
  facts: Object.freeze({
    location: null,
    totalAreaHa: null,
    lotCount: null,
    amenities: null,
    financing: null,
  }),
});

/** Conceptual residence shown on any selected lot (not an approved design). */
export const CONCEPT_RESIDENCE = Object.freeze({
  name: 'Residencia conceptual',
  storeys: 2,
  footprint: { width: 15, depthFrom: 6, depthTo: 29 }, // metres in lot-local coordinates
  status: 'Visualización ilustrativa. No incluida en el precio del lote ni aprobada para construcción.',
});

// --- Illustrative masterplan geometry (metres, world X/Z) ---------------------

export const ROAD = Object.freeze({
  laneWidth: 7, // carriageway of the lakeside avenue
  verge: 3, // curb + sidewalk/grass strip before the lot line
  boulevardHalfWidth: 10, // two 7 m carriageways and a 6 m planted median
});

const LOT = { width: 20, depth: 40 };

export const lakeRoad = createPath([
  { x: -232, z: 46 },
  { x: -120, z: -6 },
  { x: 0, z: -24 },
  { x: 120, z: -6 },
  { x: 232, z: 46 },
]);

export const boulevard = createPath([
  { x: 0, z: 300 },
  { x: 0, z: 120 },
  { x: 0, z: -20 },
]);

const apex = lakeRoad.length / 2;
const lakeSetback = ROAD.laneWidth / 2 + ROAD.verge;
const boulevardSetback = ROAD.boulevardHalfWidth + ROAD.verge;

/** Lots generated from the illustrative road layout. */
export const LOTS = [
  // Lakefront (north side of the avenue). A green is left open at the junction.
  ...layoutLots(lakeRoad, { side: -1, from: 18, to: lakeRoad.length - 18, ...LOT, setback: lakeSetback, block: 'A', skip: [[apex - 30, apex + 30]] }),
  // Inland (south side), clear of the boulevard.
  ...layoutLots(lakeRoad, { side: 1, from: 18, to: lakeRoad.length - 18, ...LOT, setback: lakeSetback, block: 'B', skip: [[apex - 42, apex + 42]] }),
  // Along the entrance boulevard.
  ...layoutLots(boulevard, { side: 1, from: 60, to: 250, ...LOT, setback: boulevardSetback, block: 'C' }),
  ...layoutLots(boulevard, { side: -1, from: 60, to: 250, ...LOT, setback: boulevardSetback, block: 'D' }),
].map((lot) => ({
  ...lot,
  // Commercial data: unknown until the official inventory is integrated.
  commercial: { areaM2: null, priceUSD: null, availability: null, financing: null },
}));

export function findLot(id) {
  return LOTS.find((l) => l.id === id) || null;
}

/** Shoreline of the illustrative lake: beyond the lakefront lots, with natural variation. */
export function lakeShore() {
  const pts = [];
  const offset = lakeSetback + LOT.depth;
  const steps = 64;
  for (let i = 0; i <= steps; i++) {
    const s = (i / steps) * lakeRoad.length;
    const p = lakeRoad.pointAt(s);
    const n = lakeRoad.normalAt(s, -1);
    const wobble = 9 + 6 * Math.sin(i * 0.9) + 4 * Math.sin(i * 2.3 + 1.1);
    pts.push({ x: p.x + n.x * (offset + wobble), z: p.z + n.z * (offset + wobble) });
  }
  return pts;
}

/** Closed lake polygon: the shoreline plus the far side of the water body. */
export function lakePolygon() {
  const shore = lakeShore();
  const first = shore[0];
  const last = shore[shore.length - 1];
  return [
    ...shore,
    { x: last.x + 120, z: last.z - 40 },
    { x: last.x + 160, z: -260 },
    { x: 220, z: -420 },
    { x: -40, z: -470 },
    { x: -260, z: -400 },
    { x: first.x - 150, z: -250 },
    { x: first.x - 110, z: first.z - 40 },
  ];
}
