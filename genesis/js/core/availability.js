// Lot availability from Génesis' own system.
//
// The page reads one small JSON document (SITE.availabilityUrl, or the
// data/disponibilidad.json shipped with the site) and applies it to the lots:
//   {
//     "desarrollo": "viva-lago-country",
//     "actualizado": "2026-11-22T18:30:00-03:00",
//     "fuente": "Sistema de gestión de Génesis",
//     "lotes": { "C-02": "vendido", "B-05": "reservado", "A-01": "disponible" }
//   }
// Only lot ids and states travel; anything else (buyers, prices) is ignored.
// Unknown lots and states are skipped, and when the document cannot be read
// the lots keep the states documented in js/data/viva-lago.js.

const STATES = Object.freeze({
  vendido: 'sold',
  sold: 'sold',
  reservado: 'reserved',
  reserved: 'reserved',
  disponible: 'available',
  available: 'available',
});

export const AVAILABILITY_EVENT = 'genesis:availability';

/** The last document applied ({ updatedAt, source }), for views mounted later. */
export let lastAvailability = null;

/** Validates a document; returns { states: Map(id → state), source, updatedAt } or null. */
export function parseAvailability(doc, knownIds) {
  if (!doc || typeof doc !== 'object' || !doc.lotes || typeof doc.lotes !== 'object' || Array.isArray(doc.lotes)) return null;
  const ids = new Set(knownIds);
  const states = new Map();
  for (const [rawId, rawState] of Object.entries(doc.lotes)) {
    const id = String(rawId).trim().toUpperCase();
    const state = STATES[String(rawState).trim().toLowerCase()];
    if (ids.has(id) && state) states.set(id, state);
  }
  const updated = typeof doc.actualizado === 'string' ? new Date(doc.actualizado) : null;
  return {
    states,
    source: typeof doc.fuente === 'string' && doc.fuente.trim() ? doc.fuente.trim().slice(0, 80) : 'Sistema de Génesis',
    updatedAt: updated && !Number.isNaN(updated.getTime()) ? updated : null,
  };
}

/** Writes the states into the lots; returns the ids that changed. */
export function applyAvailability(lots, parsed) {
  const changed = [];
  if (!parsed) return changed;
  const when = parsed.updatedAt ? ` (${parsed.updatedAt.toLocaleDateString('es-PY', { day: 'numeric', month: 'long', year: 'numeric' })})` : '';
  for (const lot of lots) {
    const state = parsed.states.get(lot.id);
    if (!state) continue;
    if (lot.commercial.availability !== state) changed.push(lot.id);
    lot.commercial.availability = state;
    lot.commercial.availabilitySource = `${parsed.source}${when}`;
  }
  return changed;
}

/**
 * Fetches and applies the document. Never throws: on any failure the page
 * keeps its documented states. Dispatches AVAILABILITY_EVENT on window.
 */
export async function loadAvailability(url, lots, { timeoutMs = 5000 } = {}) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 200_000) return null;
    const parsed = parseAvailability(JSON.parse(text), lots.map((l) => l.id));
    if (!parsed) return null;
    const changed = applyAvailability(lots, parsed);
    lastAvailability = { updatedAt: parsed.updatedAt, source: parsed.source };
    window.dispatchEvent(new CustomEvent(AVAILABILITY_EVENT, { detail: { changed, updatedAt: parsed.updatedAt, source: parsed.source } }));
    return parsed;
  } catch {
    return null;
  }
}

/** Counts per state, for summaries ("3 vendidos · 2 reservados"). */
export function availabilitySummary(lots) {
  const count = { sold: 0, reserved: 0, available: 0, unknown: 0 };
  for (const l of lots) count[l.commercial.availability || 'unknown'] += 1;
  return count;
}
