/**
 * Moneda e importes.
 *
 * Los importes viajan como `number` en unidades mayores (guaraníes, dólares),
 * pero toda aritmética que acumula se hace en unidades menores enteras
 * (PYG: 1 = 1 guaraní, sin decimales; USD: 1 = 1 centavo) para evitar
 * errores de coma flotante. La base de datos guarda numeric(18,2) y rechaza
 * decimales no válidos para la moneda (app.money_ok).
 */

export const CURRENCIES = {
  PYG: { code: "PYG", decimals: 0, symbol: "₲", name: "Guaraní paraguayo" },
  USD: { code: "USD", decimals: 2, symbol: "US$", name: "Dólar estadounidense" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && value in CURRENCIES;
}

export function decimalsOf(currency: CurrencyCode): number {
  return CURRENCIES[currency].decimals;
}

function factor(currency: CurrencyCode): number {
  return 10 ** decimalsOf(currency);
}

/**
 * Redondeo comercial (mitad hacia arriba, alejándose de cero). La tolerancia
 * absorbe el ruido de coma flotante en valores exactamente en .5.
 */
export function roundHalfUp(value: number): number {
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5 + 1e-7);
}

export function toMinor(amount: number, currency: CurrencyCode): number {
  return roundHalfUp(amount * factor(currency));
}

export function fromMinor(minor: number, currency: CurrencyCode): number {
  const f = factor(currency);
  return f === 1 ? minor : Number((minor / f).toFixed(decimalsOf(currency)));
}

export function roundMoney(amount: number, currency: CurrencyCode): number {
  return fromMinor(toMinor(amount, currency), currency);
}

/** ¿El importe respeta los decimales de la moneda? (PYG no admite decimales). */
export function isValidAmount(amount: number, currency: CurrencyCode): boolean {
  if (!Number.isFinite(amount)) return false;
  return Math.abs(amount * factor(currency) - Math.round(amount * factor(currency))) < 1e-6;
}

export function sumMoney(amounts: readonly number[], currency: CurrencyCode): number {
  return fromMinor(
    amounts.reduce((acc, a) => acc + toMinor(a, currency), 0),
    currency,
  );
}

/** Convierte un importe con un tipo de cambio explícito y redondea a la moneda destino. */
export function convert(amount: number, rate: number, to: CurrencyCode): number {
  if (!(rate > 0)) throw new Error("Tipo de cambio inválido");
  return roundMoney(amount * rate, to);
}

/**
 * Los drivers de Postgres devuelven numeric como string. Se convierte de forma
 * explícita y se rechaza cualquier valor no numérico.
 */
export function parseAmount(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Importe inválido: ${String(value)}`);
  return n;
}

export function amount(value: string | number | null | undefined): number {
  return parseAmount(value) ?? 0;
}
