/**
 * Cronograma completo de una operación: entrega en vehículo usado, entrega
 * inicial y financiación. Es la única función que genera los cronogramas que
 * se guardan (formalización) y los que se muestran (simulador, propuesta PDF).
 */
import { type CurrencyCode, fromMinor, isValidAmount, toMinor } from "../money";
import { type IsoDate, compareDates, isIsoDate } from "../dates";
import { type AmortizationMethod, type Balloon, FinancingError, amortize } from "./amortization";
import { type RateConvention, equivalentRates, monthlyRateFrom, normalizeRate } from "./rates";

export interface FinancingTerms {
  method: AmortizationMethod;
  ratePercent: number;
  rateConvention: RateConvention;
  termMonths: number;
  firstDueDate: IsoDate;
  balloons?: readonly Balloon[];
}

export interface DealScheduleInput {
  currency: CurrencyCode;
  listPrice: number;
  discount: number;
  tradeInValue: number;
  downPayment: number;
  /** Fecha de firma / de la operación: vencimiento de las entregas */
  operationDate: IsoDate;
  /** Requerido si queda capital a financiar */
  financing?: FinancingTerms | null;
}

export type InstallmentKind = "entrega_usado" | "entrega_inicial" | "cuota" | "refuerzo";

export interface DealScheduleRow {
  kind: InstallmentKind;
  dueDate: IsoDate;
  principal: number;
  interest: number;
  total: number;
  description: string;
}

export interface DealSchedule {
  currency: CurrencyCode;
  listPrice: number;
  discount: number;
  salePrice: number;
  tradeInValue: number;
  downPayment: number;
  financedAmount: number;
  rows: DealScheduleRow[];
  regularPayment: number | null;
  totalInterest: number;
  /** Total a pagar por el cliente: precio de venta + intereses */
  totalPayable: number;
  plan: {
    method: AmortizationMethod | "sin_financiacion";
    rateInput: number;
    rateConvention: RateConvention;
    monthlyRate: number;
    termMonths: number;
    firstDueDate: IsoDate | null;
    balloons: Balloon[];
    totalInterest: number;
    tem: number;
    tna: number;
    tea: number;
  };
}

export function buildDealSchedule(input: DealScheduleInput): DealSchedule {
  const { currency } = input;
  for (const [label, value] of [
    ["precio de lista", input.listPrice],
    ["descuento", input.discount],
    ["trade-in", input.tradeInValue],
    ["entrega inicial", input.downPayment],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new FinancingError(`El ${label} no puede ser negativo`);
    if (!isValidAmount(value, currency)) throw new FinancingError(`El ${label} no admite esos decimales en ${currency}`);
  }
  if (!isIsoDate(input.operationDate)) throw new FinancingError("Fecha de operación inválida");

  const list = toMinor(input.listPrice, currency);
  const discount = toMinor(input.discount, currency);
  if (discount > list) throw new FinancingError("El descuento no puede superar el precio de lista");
  const sale = list - discount;
  const tradeIn = toMinor(input.tradeInValue, currency);
  const down = toMinor(input.downPayment, currency);
  const financed = sale - tradeIn - down;
  if (financed < 0) throw new FinancingError("La entrega y el trade-in superan el precio de venta");

  const rows: DealScheduleRow[] = [];
  if (tradeIn > 0) {
    rows.push({
      kind: "entrega_usado",
      dueDate: input.operationDate,
      principal: fromMinor(tradeIn, currency),
      interest: 0,
      total: fromMinor(tradeIn, currency),
      description: "Entrega en vehículo usado",
    });
  }
  if (down > 0) {
    rows.push({
      kind: "entrega_inicial",
      dueDate: input.operationDate,
      principal: fromMinor(down, currency),
      interest: 0,
      total: fromMinor(down, currency),
      description: financed > 0 ? "Entrega inicial" : "Pago de contado",
    });
  }

  let regularPayment: number | null = null;
  let totalInterest = 0;
  let plan: DealSchedule["plan"] = {
    method: "sin_financiacion",
    rateInput: 0,
    rateConvention: "nominal_annual",
    monthlyRate: 0,
    termMonths: 0,
    firstDueDate: null,
    balloons: [],
    totalInterest: 0,
    tem: 0,
    tna: 0,
    tea: 0,
  };

  if (financed > 0) {
    const f = input.financing;
    if (!f) throw new FinancingError("Defina las condiciones de financiación del saldo");
    if (compareDates(f.firstDueDate, input.operationDate) < 0) {
      throw new FinancingError("El primer vencimiento no puede ser anterior a la fecha de la operación");
    }
    const monthlyRate = normalizeRate(monthlyRateFrom(f.ratePercent, f.rateConvention));
    const result = amortize({
      principal: fromMinor(financed, currency),
      currency,
      monthlyRate,
      termMonths: f.termMonths,
      method: f.method,
      firstDueDate: f.firstDueDate,
      balloons: f.balloons,
    });
    for (const r of result.rows) {
      rows.push({
        kind: r.kind,
        dueDate: r.dueDate,
        principal: r.principal,
        interest: r.interest,
        total: r.total,
        description: r.description,
      });
    }
    regularPayment = result.regularPayment;
    totalInterest = result.totalInterest;
    const eq = equivalentRates(monthlyRate);
    plan = {
      method: f.method,
      rateInput: f.ratePercent,
      rateConvention: f.rateConvention,
      monthlyRate,
      termMonths: f.termMonths,
      firstDueDate: f.firstDueDate,
      balloons: [...(f.balloons ?? [])].sort((a, b) => a.index - b.index),
      totalInterest,
      tem: eq.tem,
      tna: eq.tna,
      tea: eq.tea,
    };
  }

  return {
    currency,
    listPrice: fromMinor(list, currency),
    discount: fromMinor(discount, currency),
    salePrice: fromMinor(sale, currency),
    tradeInValue: fromMinor(tradeIn, currency),
    downPayment: fromMinor(down, currency),
    financedAmount: fromMinor(financed, currency),
    rows,
    regularPayment,
    totalInterest,
    totalPayable: fromMinor(sale + toMinor(totalInterest, currency), currency),
    plan,
  };
}

/** Formato que esperan rpc_deal_formalize / rpc_contract_request_refinance. */
export function toRpcPayload(schedule: DealSchedule): {
  plan: Record<string, unknown>;
  schedule: Array<Record<string, unknown>>;
} {
  return {
    plan: {
      method: schedule.plan.method,
      rate_input: schedule.plan.rateInput,
      rate_convention: schedule.plan.rateConvention,
      monthly_rate: schedule.plan.monthlyRate,
      term_months: schedule.plan.termMonths,
      first_due_date: schedule.plan.firstDueDate,
      balloons: schedule.plan.balloons,
      total_interest: schedule.plan.totalInterest,
    },
    schedule: schedule.rows.map((r) => ({
      kind: r.kind,
      due_date: r.dueDate,
      principal: r.principal,
      interest: r.interest,
      description: r.description,
    })),
  };
}
