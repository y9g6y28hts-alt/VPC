// Display helpers for property data. Missing values are never filled in: they
// render as an explicit "pending verification" label.

export const PENDING = 'Pendiente de verificación';

export function formatArea(m2) {
  if (typeof m2 !== 'number' || !Number.isFinite(m2) || m2 <= 0) return PENDING;
  return `${Math.round(m2).toLocaleString('es-PY')} m²`;
}

export function formatPrice(usd) {
  if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return PENDING;
  return `USD ${Math.round(usd).toLocaleString('es-PY')}`;
}

const AVAILABILITY = { available: 'Disponible', reserved: 'Reservado', sold: 'Vendido' };

export function formatAvailability(value) {
  return AVAILABILITY[value] || PENDING;
}

export function formatText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : PENDING;
}

export const ASK = 'Consultar con un asesor';

function formatDecimalArea(m2) {
  if (typeof m2 !== 'number' || !Number.isFinite(m2) || m2 <= 0) return PENDING;
  return `${m2.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

/**
 * Rows for the lot panel, in display order. Surfaces come from the plan's
 * surface table; prices and financing are not published on the site, and
 * availability is shown only where a Génesis document states it.
 */
export function lotDetailRows(lot) {
  const c = lot?.commercial || {};
  const s = lot?.survey || {};
  const rows = [{ key: 'area', label: 'Superficie del lote', value: formatDecimalArea(c.areaM2), pending: formatDecimalArea(c.areaM2) === PENDING }];
  if (s.commonAreaM2) rows.push({ key: 'common', label: 'Área común (proporcional)', value: formatDecimalArea(s.commonAreaM2), pending: false });
  if (s.totalAreaM2) rows.push({ key: 'total', label: 'Superficie total', value: `${formatDecimalArea(s.totalAreaM2)} · ${s.sharePct.toLocaleString('es-PY', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} % de copropiedad`, pending: false });
  if (lot?.frontage && lot?.depth) rows.push({ key: 'size', label: 'Frente × fondo (aprox.)', value: `${lot.frontage.toFixed(1).replace('.', ',')} × ${lot.depth.toFixed(1).replace('.', ',')} m`, pending: false });
  rows.push({ key: 'availability', label: 'Disponibilidad', value: c.availability ? formatAvailability(c.availability) : ASK, pending: !c.availability });
  rows.push({ key: 'price', label: 'Precio y financiación', value: ASK, pending: true });
  return rows;
}

/** Human label for a lot id such as "A-07" -> "Manzana A · Lote 7". */
export function lotLabel(lot) {
  if (!lot) return '';
  return `Manzana ${lot.block} · Lote ${lot.number}`;
}
