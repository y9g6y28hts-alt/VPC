import Decimal from "decimal.js";

// Aritmética decimal exacta. ROUND_HALF_UP equivale a round() de PostgreSQL
// para importes positivos (redondeo hacia afuera en el medio).
export const Dec = Decimal.clone({ precision: 50, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export const CURRENCIES = {
  USD: { minorUnits: 2, symbol: "US$", name: "Dólar estadounidense" },
  PYG: { minorUnits: 0, symbol: "₲", name: "Guaraní paraguayo" },
  EUR: { minorUnits: 2, symbol: "€", name: "Euro" },
  BRL: { minorUnits: 2, symbol: "R$", name: "Real brasileño" },
  ARS: { minorUnits: 2, symbol: "AR$", name: "Peso argentino" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function minorUnits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}

export function roundMoney(value: Decimal.Value, currency: CurrencyCode): Decimal {
  return new Dec(value).toDecimalPlaces(minorUnits(currency), Decimal.ROUND_HALF_UP);
}

export function moneyString(value: Decimal.Value, currency: CurrencyCode): string {
  return roundMoney(value, currency).toFixed(minorUnits(currency));
}

/** Importe exacto: rechaza más decimales de los que admite la moneda. */
export function parseMoney(value: string | number, currency: CurrencyCode, label = "importe"): Decimal {
  const raw = typeof value === "number" ? String(value) : value.trim().replace(/\s/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`${label}: formato numérico inválido`);
  const d = new Dec(raw);
  if (!d.equals(roundMoney(d, currency))) {
    throw new Error(`${label}: ${currency} admite ${minorUnits(currency)} decimales`);
  }
  return d;
}

export function sumDec(values: Decimal.Value[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(v), new Dec(0));
}
