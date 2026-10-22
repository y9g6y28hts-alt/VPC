// =============================================================================
// Motor Haus · Motor financiero
// Fuente única de cálculo para mesa de negociación, contratos y cobranzas.
// El servidor (PostgreSQL, app.validate_schedule) verifica de forma independiente
// la coherencia de cada calendario antes de guardarlo o formalizarlo.
//
// Convenciones (documentadas en docs/financial-engine.md):
//  · Importes en unidades menores exactas de la moneda (USD 2, PYG 0 decimales).
//  · Tasa periódica efectiva redondeada a 12 decimales.
//  · Interés del período = round(saldo inicial × tasa del período, moneda).
//  · Primer período irregular: fracción f = días(inicio→1er venc.) /
//    días(inicio→inicio + m meses), redondeada a 10 decimales; tasa = (1+i)^f − 1.
//  · Vencimientos: primer vencimiento + (k−1)·m meses (recorte a fin de mes).
//  · La última cuota amortiza el saldo remanente (ajuste de redondeo explícito).
//  · Refuerzos: pagos adicionales en el vencimiento de un período; amortizan capital.
// =============================================================================

import Decimal from "decimal.js";
import { addMonths, assertIsoDate, daysBetween } from "./dates";
import { CurrencyCode, Dec, isCurrency, minorUnits, parseMoney, roundMoney, sumDec } from "./money";

export const ENGINE_VERSION = "mh-fin-1.0.0";
const RATE_DP = 12;
const FRACTION_DP = 10;

export type AmortizationSystem = "french" | "german" | "zero_interest" | "custom";
export type RateType = "effective_annual" | "nominal_annual" | "effective_monthly" | "none";
export type MonthsPerPeriod = 1 | 2 | 3 | 6 | 12;

export interface Balloon { period: number; amount: string }
export interface UpfrontPayment { dueDate: string; amount: string; label: string }

export interface PlanInputs {
  system: AmortizationSystem;
  currency: CurrencyCode;
  principal: string;
  rateType: RateType;
  /** Tasa como fracción decimal (0.12 = 12 %). */
  rate: string;
  termPeriods: number;
  monthsPerPeriod: MonthsPerPeriod;
  startDate: string;
  firstDueDate: string;
  balloons: Balloon[];
  upfront: UpfrontPayment[];
  /** Solo sistema 'custom': amortización de capital por período (sin refuerzos). */
  customPrincipal?: string[];
}

export interface ScheduleRow {
  period: number;
  dueDate: string;
  periodFraction: string;
  periodRate: string;
  openingBalance: string;
  interest: string;
  principal: string;
  balloon: string;
  payment: string;
  closingBalance: string;
}

export interface PlanSummary {
  principal: string;
  periodicRate: string;
  effectiveAnnualRate: string;
  installmentAmount: string;
  lastInstallment: string;
  lastInstallmentAdjustment: string;
  totalInterest: string;
  totalPayments: string;
  totalBalloons: string;
  totalUpfront: string;
  totalProjected: string;
  termPeriods: number;
  termMonths: number;
  irregularFirstPeriod: boolean;
  engineVersion: string;
}

export interface FinancingPlan {
  inputs: PlanInputs;
  summary: PlanSummary;
  schedule: ScheduleRow[];
}

export class FinancingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancingError";
  }
}

const fail = (msg: string): never => { throw new FinancingError(msg); };

// -----------------------------------------------------------------------------
// Tasas
// -----------------------------------------------------------------------------

/** Tasa efectiva del período de m meses. Una TNA se capitaliza mensualmente (TNA/12). */
export function periodicRate(rateType: RateType, rate: Decimal.Value, monthsPerPeriod: number): Decimal {
  const r = new Dec(rate);
  if (r.isNegative()) fail("La tasa no puede ser negativa");
  let value: Decimal;
  switch (rateType) {
    case "none":
      if (!r.isZero()) fail("Tipo de tasa 'sin interés' con tasa distinta de cero");
      value = new Dec(0);
      break;
    case "effective_annual":
      value = r.plus(1).pow(new Dec(monthsPerPeriod).div(12)).minus(1);
      break;
    case "nominal_annual":
      value = r.div(12).plus(1).pow(monthsPerPeriod).minus(1);
      break;
    case "effective_monthly":
      value = r.plus(1).pow(monthsPerPeriod).minus(1);
      break;
    default:
      return fail("Tipo de tasa inválido");
  }
  return value.toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP);
}

/** TEA → tasa efectiva mensual: (1 + TEA)^(1/12) − 1. */
export function effectiveAnnualToMonthly(tea: Decimal.Value): Decimal {
  return periodicRate("effective_annual", tea, 1);
}

/** Tasa efectiva anual equivalente a una tasa periódica. */
export function effectiveAnnualFromPeriodic(rate: Decimal.Value, monthsPerPeriod: number): Decimal {
  return new Dec(rate).plus(1).pow(new Dec(12).div(monthsPerPeriod)).minus(1);
}

/** Cuota del sistema francés: C = P·i(1+i)^n / ((1+i)^n − 1); con i = 0, C = P/n. */
export function frenchInstallment(principal: Decimal.Value, rate: Decimal.Value, n: number): Decimal {
  const P = new Dec(principal);
  const i = new Dec(rate);
  if (n < 1) fail("El plazo debe ser de al menos un período");
  if (i.isZero()) return P.div(n);
  const f = i.plus(1).pow(n);
  return P.mul(i).mul(f).div(f.minus(1));
}

// -----------------------------------------------------------------------------
// Validación de entradas
// -----------------------------------------------------------------------------

export function validateInputs(inputs: PlanInputs): void {
  if (!isCurrency(inputs.currency)) fail("Moneda no soportada");
  const P = parseMoney(inputs.principal, inputs.currency, "Capital");
  if (P.isNegative()) fail("El capital financiado no puede ser negativo");
  if (!["french", "german", "zero_interest", "custom"].includes(inputs.system)) fail("Sistema de amortización inválido");
  if (![1, 2, 3, 6, 12].includes(inputs.monthsPerPeriod)) fail("Frecuencia inválida");
  if (!Number.isInteger(inputs.termPeriods) || inputs.termPeriods < 1 || inputs.termPeriods > 360) {
    fail("El plazo debe estar entre 1 y 360 períodos");
  }
  assertIsoDate(inputs.startDate, "Fecha de inicio");
  assertIsoDate(inputs.firstDueDate, "Primer vencimiento");
  if (inputs.firstDueDate <= inputs.startDate) fail("El primer vencimiento debe ser posterior al inicio");
  if (inputs.firstDueDate > addMonths(inputs.startDate, 2 * inputs.monthsPerPeriod)) {
    fail("El primer vencimiento debe caer dentro de los dos primeros períodos");
  }
  const rate = new Dec(inputs.rate || "0");
  if (rate.isNegative() || rate.gt(5)) fail("Tasa fuera de rango (0 % a 500 %)");
  if (inputs.system === "zero_interest" && (inputs.rateType !== "none" || !rate.isZero())) {
    fail("La financiación sin interés usa tasa 'none' igual a cero");
  }
  if (inputs.system !== "zero_interest" && inputs.rateType === "none" && !rate.isZero()) fail("Tasa inconsistente");

  const seen = new Set<number>();
  for (const b of inputs.balloons) {
    if (!Number.isInteger(b.period) || b.period < 1 || b.period > inputs.termPeriods) fail(`Refuerzo en período inválido (${b.period})`);
    if (seen.has(b.period)) fail(`Más de un refuerzo en el período ${b.period}`);
    seen.add(b.period);
    if (!parseMoney(b.amount, inputs.currency, `Refuerzo período ${b.period}`).isPositive()) fail("Los refuerzos deben ser positivos");
  }
  const balloonTotal = sumDec(inputs.balloons.map((b) => b.amount));
  if (P.isPositive() && balloonTotal.gte(P)) fail("Los refuerzos no pueden igualar ni superar el capital financiado");

  for (const u of inputs.upfront) {
    assertIsoDate(u.dueDate, "Fecha de entrega inicial");
    if (u.dueDate < inputs.startDate) fail("Una entrega inicial no puede ser anterior al inicio del contrato");
    if (!parseMoney(u.amount, inputs.currency, "Entrega inicial").isPositive()) fail("Las entregas iniciales deben ser positivas");
  }
  if (inputs.system === "custom") {
    const cp = inputs.customPrincipal ?? [];
    if (cp.length !== inputs.termPeriods) fail("El calendario personalizado debe definir la amortización de cada período");
    cp.forEach((v, idx) => {
      if (parseMoney(v, inputs.currency, `Amortización período ${idx + 1}`).isNegative()) fail("Amortización negativa");
    });
    if (!sumDec(cp).plus(balloonTotal).equals(P)) fail("La amortización personalizada más los refuerzos debe igualar el capital");
  }
}

// -----------------------------------------------------------------------------
// Construcción del calendario
// -----------------------------------------------------------------------------

function firstPeriodFraction(inputs: PlanInputs): Decimal {
  const regular = addMonths(inputs.startDate, inputs.monthsPerPeriod);
  if (regular === inputs.firstDueDate) return new Dec(1);
  return new Dec(daysBetween(inputs.startDate, inputs.firstDueDate))
    .div(daysBetween(inputs.startDate, regular))
    .toDecimalPlaces(FRACTION_DP, Decimal.ROUND_HALF_UP);
}

function rateForFraction(base: Decimal, fraction: Decimal): Decimal {
  if (fraction.equals(1)) return base;
  return base.plus(1).pow(fraction).minus(1).toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP);
}

export function buildPlan(rawInputs: PlanInputs): FinancingPlan {
  const inputs: PlanInputs = {
    ...rawInputs,
    rate: rawInputs.rate || "0",
    balloons: [...(rawInputs.balloons ?? [])].sort((a, b) => a.period - b.period),
    upfront: [...(rawInputs.upfront ?? [])],
  };
  validateInputs(inputs);
  const ccy = inputs.currency;
  const dp = minorUnits(ccy);
  const P = new Dec(inputs.principal);
  const n = inputs.termPeriods;
  const m = inputs.monthsPerPeriod;
  const base = periodicRate(inputs.rateType, inputs.rate, m);
  const f1 = firstPeriodFraction(inputs);
  const rates = Array.from({ length: n }, (_, k) => (k === 0 ? rateForFraction(base, f1) : base));
  const balloonAt = new Map(inputs.balloons.map((b) => [b.period, new Dec(b.amount)]));
  const totalUpfront = sumDec(inputs.upfront.map((u) => u.amount));

  if (P.isZero()) {
    return {
      inputs,
      schedule: [],
      summary: summarize(inputs, [], base, f1, new Dec(0), totalUpfront),
    };
  }

  // Cuota nivelada (francés / sin interés): valor presente de cuotas + refuerzos = capital.
  let level = new Dec(0);
  if (inputs.system === "french" || inputs.system === "zero_interest") {
    let discount = new Dec(1);
    let sumD = new Dec(0);
    let pvBalloons = new Dec(0);
    for (let k = 1; k <= n; k++) {
      discount = discount.div(rates[k - 1].plus(1));
      sumD = sumD.plus(discount);
      pvBalloons = pvBalloons.plus((balloonAt.get(k) ?? new Dec(0)).mul(discount));
    }
    level = roundMoney(P.minus(pvBalloons).div(sumD), ccy);
  } else if (inputs.system === "german") {
    level = roundMoney(P.minus(sumDec([...balloonAt.values()])).div(n), ccy);
  }

  const rows: ScheduleRow[] = [];
  let open = P;
  for (let k = 1; k <= n; k++) {
    const r = rates[k - 1];
    const balloon = balloonAt.get(k) ?? new Dec(0);
    const interest = open.mul(r).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
    let principal: Decimal;
    if (k === n) {
      principal = open;
    } else if (inputs.system === "french" || inputs.system === "zero_interest") {
      principal = level.minus(interest).plus(balloon);
    } else if (inputs.system === "german") {
      principal = level.plus(balloon);
    } else {
      principal = new Dec(inputs.customPrincipal![k - 1]).plus(balloon);
    }
    if (principal.minus(balloon).isNegative()) {
      fail(`La cuota del período ${k} no cubre los intereses (amortización negativa); reduzca refuerzos o plazo`);
    }
    if (principal.gt(open)) {
      fail(`La amortización del período ${k} supera el saldo; revise refuerzos y plazo`);
    }
    const close = open.minus(principal);
    rows.push({
      period: k,
      dueDate: addMonths(inputs.firstDueDate, (k - 1) * m),
      periodFraction: (k === 1 ? f1 : new Dec(1)).toString(),
      periodRate: r.toFixed(RATE_DP),
      openingBalance: open.toFixed(dp),
      interest: interest.toFixed(dp),
      principal: principal.toFixed(dp),
      balloon: balloon.toFixed(dp),
      payment: interest.plus(principal).toFixed(dp),
      closingBalance: close.toFixed(dp),
    });
    open = close;
  }
  if (!open.isZero()) fail("El calendario no cancela el capital");
  return { inputs, schedule: rows, summary: summarize(inputs, rows, base, f1, level, totalUpfront) };
}

function summarize(
  inputs: PlanInputs, rows: ScheduleRow[], base: Decimal, f1: Decimal, level: Decimal, totalUpfront: Decimal,
): PlanSummary {
  const dp = minorUnits(inputs.currency);
  const totalInterest = sumDec(rows.map((r) => r.interest));
  const totalPayments = sumDec(rows.map((r) => r.payment));
  const totalBalloons = sumDec(rows.map((r) => r.balloon));
  const last = rows.at(-1);
  const lastRegular = last ? new Dec(last.payment).minus(last.balloon) : new Dec(0);
  const first = rows[0];
  const installment = inputs.system === "french" || inputs.system === "zero_interest"
    ? level
    : first ? new Dec(first.payment).minus(first.balloon) : new Dec(0);
  return {
    principal: new Dec(inputs.principal).toFixed(dp),
    periodicRate: base.toFixed(RATE_DP),
    effectiveAnnualRate: effectiveAnnualFromPeriodic(base, inputs.monthsPerPeriod).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6),
    installmentAmount: installment.toFixed(dp),
    lastInstallment: lastRegular.toFixed(dp),
    lastInstallmentAdjustment: inputs.system === "french" || inputs.system === "zero_interest"
      ? lastRegular.minus(level).toFixed(dp) : "0",
    totalInterest: totalInterest.toFixed(dp),
    totalPayments: totalPayments.toFixed(dp),
    totalBalloons: totalBalloons.toFixed(dp),
    totalUpfront: totalUpfront.toFixed(dp),
    totalProjected: totalPayments.plus(totalUpfront).toFixed(dp),
    termPeriods: inputs.termPeriods,
    termMonths: inputs.termPeriods * inputs.monthsPerPeriod,
    irregularFirstPeriod: !f1.equals(1),
    engineVersion: ENGINE_VERSION,
  };
}

// -----------------------------------------------------------------------------
// Capital financiado (misma fórmula que app.deal_economics en el servidor)
// -----------------------------------------------------------------------------

export interface DealAmounts {
  negotiatedTotal: Decimal.Value;
  financedCharges: Decimal.Value;
  tradeInAccepted: Decimal.Value;
  tradeInLienPayoff: Decimal.Value;
  cashDownPayment: Decimal.Value;
  otherCredits: Decimal.Value;
}

/**
 * Capital financiado = precio negociado + cargos financiados
 *                      − (valor aceptado del trade-in − cancelación de prenda asumida)
 *                      − entrega en efectivo − otros créditos iniciales.
 */
export function financedPrincipal(a: DealAmounts): Decimal {
  return new Dec(a.negotiatedTotal)
    .plus(a.financedCharges)
    .minus(new Dec(a.tradeInAccepted).minus(a.tradeInLienPayoff))
    .minus(a.cashDownPayment)
    .minus(a.otherCredits);
}

// -----------------------------------------------------------------------------
// Pagos extraordinarios (cancelación parcial anticipada)
// -----------------------------------------------------------------------------

export type PrepaymentMode = "reduce_term" | "reduce_installment";

/**
 * Recalcula el plan tras un pago extraordinario aplicado en el vencimiento del
 * período `afterPeriod` (una vez pagada esa cuota). El resultado es un nuevo plan
 * que debe formalizarse como una nueva versión contractual; los refuerzos
 * posteriores se conservan en su fecha original.
 */
export function applyPrepayment(plan: FinancingPlan, afterPeriod: number, amount: string, mode: PrepaymentMode): FinancingPlan {
  const { inputs, schedule } = plan;
  if (inputs.system === "custom") fail("Los calendarios personalizados se reprograman manualmente");
  if (!Number.isInteger(afterPeriod) || afterPeriod < 1 || afterPeriod >= inputs.termPeriods) {
    fail("El pago extraordinario debe aplicarse entre el primer y el penúltimo vencimiento");
  }
  const extra = parseMoney(amount, inputs.currency, "Pago extraordinario");
  const balance = new Dec(schedule[afterPeriod - 1].closingBalance);
  const remainingBalloons = inputs.balloons
    .filter((b) => b.period > afterPeriod)
    .map((b) => ({ period: b.period - afterPeriod, amount: b.amount }));
  const newPrincipal = balance.minus(extra);
  if (!extra.isPositive() || newPrincipal.lte(sumDec(remainingBalloons.map((b) => b.amount)))) {
    fail("El pago extraordinario debe ser positivo y menor que el saldo no cubierto por refuerzos; use cancelación total");
  }
  const startDate = schedule[afterPeriod - 1].dueDate;
  const remaining = inputs.termPeriods - afterPeriod;
  const base: PlanInputs = {
    ...inputs,
    principal: newPrincipal.toFixed(minorUnits(inputs.currency)),
    startDate,
    firstDueDate: schedule[afterPeriod].dueDate,
    upfront: [],
    balloons: remainingBalloons,
  };
  if (mode === "reduce_installment") return buildPlan({ ...base, termPeriods: remaining });

  const original = new Dec(plan.summary.installmentAmount);
  for (let n = 1; n <= remaining; n++) {
    const candidateBalloons = remainingBalloons.filter((b) => b.period <= n);
    if (candidateBalloons.length !== remainingBalloons.length) continue;
    try {
      const candidate = buildPlan({ ...base, termPeriods: n, balloons: candidateBalloons });
      if (new Dec(candidate.summary.installmentAmount).lte(original)) return candidate;
    } catch {
      // plazo demasiado corto para estos refuerzos: probar el siguiente
    }
  }
  return buildPlan({ ...base, termPeriods: remaining });
}

/** Comprobaciones de reconciliación usadas por las pruebas y por la interfaz. */
export function reconcile(plan: FinancingPlan): { ok: boolean; issues: string[] } {
  const issues: string[] = [];
  const P = new Dec(plan.inputs.principal);
  const principalSum = sumDec(plan.schedule.map((r) => r.principal));
  if (!principalSum.equals(P)) issues.push(`Σ amortización ${principalSum} ≠ capital ${P}`);
  plan.schedule.forEach((r, idx) => {
    if (!new Dec(r.payment).equals(new Dec(r.interest).plus(r.principal))) issues.push(`Período ${r.period}: cuota ≠ interés + capital`);
    if (!new Dec(r.closingBalance).equals(new Dec(r.openingBalance).minus(r.principal))) issues.push(`Período ${r.period}: saldo final`);
    if (idx > 0 && r.openingBalance !== plan.schedule[idx - 1].closingBalance) issues.push(`Período ${r.period}: saldo inicial`);
  });
  if (plan.schedule.length && plan.schedule.at(-1)!.closingBalance !== new Dec(0).toFixed(minorUnits(plan.inputs.currency))) {
    issues.push("El saldo final no es cero");
  }
  return { ok: issues.length === 0, issues };
}
