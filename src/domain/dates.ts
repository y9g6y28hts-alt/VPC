/**
 * Fechas calendario (sin hora) como cadenas ISO "YYYY-MM-DD".
 * Se evita `Date` local para que los vencimientos no cambien según la zona
 * horaria del navegador o del servidor.
 */

export type IsoDate = string;

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const DEFAULT_TIMEZONE = "America/Asuncion";

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(date: IsoDate): [number, number, number] {
  const m = ISO_RE.exec(date);
  if (!m) throw new Error(`Fecha inválida: ${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fmt(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Suma meses conservando el día de referencia (anchorDay). Si el mes destino
 * es más corto, se usa su último día: 31/01 → 28/02 → 31/03.
 */
export function addMonths(date: IsoDate, months: number, anchorDay?: number): IsoDate {
  const [y, m, d] = parts(date);
  const anchor = anchorDay ?? d;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fmt(ny, nm, Math.min(anchor, daysInMonth(ny, nm)));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Días calendario de `from` a `to` (positivo si `to` es posterior). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Fecha de hoy en la zona horaria de la organización. */
export function todayIn(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): IsoDate {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(now);
}

export function monthKey(date: IsoDate): string {
  return date.slice(0, 7);
}

export function startOfMonth(date: IsoDate): IsoDate {
  return `${date.slice(0, 7)}-01`;
}

export function endOfMonth(date: IsoDate): IsoDate {
  const [y, m] = parts(date);
  return fmt(y, m, daysInMonth(y, m));
}
