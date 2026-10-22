import { CURRENCIES, CurrencyCode, isCurrency } from "@/domain/finance/money";

type NumLike = string | number | null | undefined;

const fmtCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) { f = new Intl.NumberFormat("es-PY", opts); fmtCache.set(key, f); }
  return f;
}

/** Importe con símbolo de su moneda. Nunca convierte entre monedas. */
export function money(value: NumLike, currency: string, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (value === null || value === undefined || value === "") return "—";
  const ccy = isCurrency(currency) ? currency : "USD";
  const dp = CURRENCIES[ccy].minorUnits;
  const n = typeof value === "number" ? value : Number(value);
  if (opts.compact && Math.abs(n) >= 100_000) {
    const f = nf(`c-${ccy}`, { notation: "compact", maximumFractionDigits: 1 });
    return `${CURRENCIES[ccy].symbol} ${f.format(n)}`;
  }
  const f = nf(`m-${ccy}-${opts.sign ? 1 : 0}`, {
    minimumFractionDigits: dp, maximumFractionDigits: dp, signDisplay: opts.sign ? "exceptZero" : "auto",
  });
  // Intl acepta cadenas decimales exactas: se evita pasar por coma flotante.
  return `${CURRENCIES[ccy].symbol} ${f.format(typeof value === "string" ? (value as unknown as number) : n)}`;
}

export function num(value: NumLike, digits = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  return nf(`n-${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value));
}

export function pct(value: NumLike, digits = 1): string {
  if (value === null || value === undefined || value === "") return "—";
  return `${num(value, digits)} %`;
}

export function date(value: string | Date | null | undefined): string {
  if (!value) return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }
  const dt = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: process.env.MH_TIMEZONE ?? "America/Asuncion" }).format(dt);
}

export function dateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const dt = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    timeZone: process.env.MH_TIMEZONE ?? "America/Asuncion" }).format(dt);
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PY", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export function currencyOf(code: string): CurrencyCode {
  return isCurrency(code) ? code : "USD";
}
