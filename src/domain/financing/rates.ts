/**
 * Convenciones de tasa.
 *
 * La tasa se ingresa en porcentaje y se interpreta según la convención:
 *   - nominal_annual  (TNA): tasa mensual = TNA / 12
 *   - effective_annual (TEA): tasa mensual = (1 + TEA)^(1/12) − 1
 *   - monthly         (TEM): tasa mensual = TEM
 *
 * Todas las cuotas se calculan con la tasa mensual efectiva (TEM) resultante.
 * Para transparencia se informan las tres expresiones equivalentes.
 */

export type RateConvention = "nominal_annual" | "effective_annual" | "monthly";

export const RATE_CONVENTIONS: readonly RateConvention[] = ["nominal_annual", "effective_annual", "monthly"];

export const RATE_CONVENTION_LABELS: Record<RateConvention, string> = {
  nominal_annual: "Nominal anual (TNA)",
  effective_annual: "Efectiva anual (TEA)",
  monthly: "Mensual (TEM)",
};

export function monthlyRateFrom(ratePercent: number, convention: RateConvention): number {
  if (!Number.isFinite(ratePercent) || ratePercent < 0) {
    throw new Error("La tasa debe ser un número mayor o igual a cero");
  }
  const r = ratePercent / 100;
  switch (convention) {
    case "nominal_annual":
      return r / 12;
    case "effective_annual":
      return Math.pow(1 + r, 1 / 12) - 1;
    case "monthly":
      return r;
  }
}

export interface EquivalentRates {
  /** Tasa efectiva mensual, en porcentaje */
  tem: number;
  /** Tasa nominal anual, en porcentaje (TEM × 12) */
  tna: number;
  /** Tasa efectiva anual, en porcentaje ((1+TEM)^12 − 1) */
  tea: number;
}

export function equivalentRates(monthlyRate: number): EquivalentRates {
  return {
    tem: monthlyRate * 100,
    tna: monthlyRate * 12 * 100,
    tea: (Math.pow(1 + monthlyRate, 12) - 1) * 100,
  };
}

/** Redondeo a 12 decimales para persistir la tasa mensual sin ruido binario. */
export function normalizeRate(rate: number): number {
  return Number(rate.toFixed(12));
}
