/**
 * Formato de presentación (es-PY). La lógica de importes vive en
 * src/domain/money.ts; aquí sólo se decide cómo se muestran.
 */
import { type CurrencyCode, decimalsOf, isCurrency } from "@/domain/money";
import type { IsoDate } from "@/domain/dates";

const LOCALE = "es-PY";
const numberCache = new Map<string, Intl.NumberFormat>();

function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(LOCALE, opts);
    numberCache.set(key, f);
  }
  return f;
}

const SYMBOL: Record<CurrencyCode, string> = { PYG: "Gs.", USD: "US$" };

/** "Gs. 1.500.000" / "US$ 45.000,50" */
export function formatMoney(value: number | string | null | undefined, currency: string, opts: { sign?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const cur: CurrencyCode = isCurrency(currency) ? currency : "PYG";
  const d = decimalsOf(cur);
  const body = nf(`m${d}`, { minimumFractionDigits: d, maximumFractionDigits: d }).format(Math.abs(n));
  const sign = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${sign}${SYMBOL[cur]} ${body}`;
}

/** Importe abreviado para indicadores: "Gs. 1.520 M", "US$ 1,2 M". */
export function formatMoneyCompact(value: number | string | null | undefined, currency: string): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const cur: CurrencyCode = isCurrency(currency) ? currency : "PYG";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    const millions = abs / 1_000_000;
    const digits = millions >= 100 ? 0 : 1;
    return `${sign}${SYMBOL[cur]} ${nf(`c${digits}`, { maximumFractionDigits: digits }).format(millions)} M`;
  }
  return formatMoney(n, cur);
}

export function formatNumber(value: number | string | null | undefined, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return nf(`n${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function formatPercent(value: number | string | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${formatNumber(n, digits)} %`;
}

export function formatKm(value: number | string | null | undefined): string {
  return value === null || value === undefined ? "—" : `${formatNumber(value)} km`;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MONTHS_LONG = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "22/10/2026" */
export function formatDate(value: IsoDate | Date | string | null | undefined): string {
  if (!value) return "—";
  const iso = typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** "22 oct. 2026" */
export function formatDateShort(value: IsoDate | string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]}. ${y}`;
}

/** "octubre 2026" */
export function formatMonth(value: string): string {
  const [y, m] = value.split("-");
  return `${MONTHS_LONG[Number(m) - 1]} ${y}`;
}

export function formatMonthShort(value: string): string {
  const [y, m] = value.split("-");
  return `${MONTHS[Number(m) - 1]} ${y!.slice(2)}`;
}

const dtf = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Asuncion",
});

/** Fecha y hora en Asunción: "22/10/2026, 14:35" */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return dtf.format(typeof value === "string" ? new Date(value) : value);
}

export function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

/** "Range Rover" + "Range Rover Sport" → "Range Rover Sport"; "Ford" + "Ranger" → "Ford Ranger". */
export function vehicleName(brand: string, model: string): string {
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

/** Valor inicial de un campo de importe editable: "139.000,00" / "175.000.000". */
export function formatInputAmount(value: number | string | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  const d = currency === "USD" ? 2 : 0;
  return new Intl.NumberFormat("es-PY", { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: true }).format(n);
}
