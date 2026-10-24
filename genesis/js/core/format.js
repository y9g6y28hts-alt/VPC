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

/** Rows for the lot panel, in display order. */
export function lotDetailRows(lot) {
  const c = lot?.commercial || {};
  return [
    { key: 'area', label: 'Superficie', value: formatArea(c.areaM2), pending: formatArea(c.areaM2) === PENDING },
    { key: 'price', label: 'Precio', value: formatPrice(c.priceUSD), pending: formatPrice(c.priceUSD) === PENDING },
    { key: 'availability', label: 'Disponibilidad', value: formatAvailability(c.availability), pending: formatAvailability(c.availability) === PENDING },
    { key: 'financing', label: 'Financiación', value: formatText(c.financing), pending: formatText(c.financing) === PENDING },
  ];
}

/** Human label for a lot id such as "A-07" -> "Manzana A · Lote 7". */
export function lotLabel(lot) {
  if (!lot) return '';
  return `Manzana ${lot.block} · Lote ${lot.number}`;
}
