// Fechas de negocio como 'YYYY-MM-DD' (sin zona horaria). Las reglas replican
// exactamente la aritmética de PostgreSQL usada por la validación del servidor:
// date + interval 'n months' recorta al último día del mes cuando corresponde.

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: string, label = "fecha"): void {
  if (!ISO.test(value)) throw new Error(`${label} inválida: ${value}`);
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`${label} inválida: ${value}`);
  }
}

function toUtc(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtc(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function addMonths(value: string, months: number): string {
  const [y, m, d] = value.split("-").map(Number);
  const total = (m - 1) + months;
  const year = y + Math.floor(total / 12);
  const monthIndex = ((total % 12) + 12) % 12;
  const day = Math.min(d, daysInMonth(year, monthIndex));
  return fromUtc(new Date(Date.UTC(year, monthIndex, day)));
}

export function addDays(value: string, days: number): string {
  const dt = toUtc(value);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

export function todayIso(timeZone = "America/Asuncion"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
