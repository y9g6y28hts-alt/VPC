/**
 * Motor de amortización (único para toda la plataforma).
 *
 * Sistemas:
 *   - Francés: cuota regular constante. Con refuerzos, la cuota regular se
 *     calcula sobre el capital neto del valor presente de los refuerzos:
 *       C = (P − Σ R_k / (1+i)^m_k) · i / (1 − (1+i)^−n)
 *   - Alemán: amortización de capital constante: (P − Σ R_k) / n por cuota;
 *     el interés se calcula sobre el saldo.
 *
 * Refuerzos: pagos extraordinarios de capital en la misma fecha que la cuota
 * regular `index` (1..n). Se generan como filas propias (kind "refuerzo",
 * interés 0): el interés del período ya está incluido en la cuota regular.
 *
 * Convenciones de cálculo:
 *   - Interés del período = saldo anterior × tasa mensual efectiva, redondeado
 *     a la unidad mínima de la moneda (PYG: 1 Gs; USD: 0,01) mitad hacia arriba.
 *   - El saldo se arrastra con importes ya redondeados.
 *   - La última cuota regular absorbe la diferencia de redondeo, de modo que la
 *     suma de capital es exactamente el capital financiado.
 *   - Tasa cero: sin intereses; la cuota francesa es (P − ΣR) / n.
 *   - Vencimientos mensuales desde el primer vencimiento, conservando el día.
 */
import { type CurrencyCode, fromMinor, isValidAmount, roundHalfUp, toMinor } from "../money";
import { type IsoDate, addMonths, isIsoDate } from "../dates";

export type AmortizationMethod = "frances" | "aleman";

export const AMORTIZATION_LABELS: Record<AmortizationMethod, string> = {
  frances: "Sistema francés (cuota fija)",
  aleman: "Sistema alemán (capital fijo)",
};

export interface Balloon {
  /** Número de cuota regular (1..n) en cuya fecha vence el refuerzo */
  index: number;
  /** Importe de capital del refuerzo */
  amount: number;
}

export interface AmortizationInput {
  principal: number;
  currency: CurrencyCode;
  monthlyRate: number;
  termMonths: number;
  method: AmortizationMethod;
  firstDueDate: IsoDate;
  balloons?: readonly Balloon[];
}

export interface ScheduleRow {
  kind: "cuota" | "refuerzo";
  /** Número de cuota regular a la que corresponde (refuerzos comparten índice) */
  index: number;
  dueDate: IsoDate;
  principal: number;
  interest: number;
  total: number;
  /** Saldo de capital luego de esta fila */
  balanceAfter: number;
  description: string;
}

export interface AmortizationResult {
  rows: ScheduleRow[];
  /** Cuota regular nominal (francés: constante; alemán: la primera) */
  regularPayment: number;
  totalPrincipal: number;
  totalInterest: number;
  totalPayable: number;
}

export class FinancingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinancingError";
  }
}

function validate(input: AmortizationInput): void {
  const { principal, currency, monthlyRate, termMonths, firstDueDate } = input;
  if (!(principal > 0)) throw new FinancingError("El capital a financiar debe ser mayor que cero");
  if (!isValidAmount(principal, currency)) {
    throw new FinancingError(`El capital no admite esos decimales en ${currency}`);
  }
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 120) {
    throw new FinancingError("El plazo debe estar entre 1 y 120 meses");
  }
  if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 0.2) {
    throw new FinancingError("La tasa mensual debe estar entre 0% y 20%");
  }
  if (!isIsoDate(firstDueDate)) throw new FinancingError("Fecha de primer vencimiento inválida");
  const seen = new Set<number>();
  let sum = 0;
  for (const b of input.balloons ?? []) {
    if (!Number.isInteger(b.index) || b.index < 1 || b.index > termMonths) {
      throw new FinancingError(`El refuerzo debe ubicarse entre la cuota 1 y la ${termMonths}`);
    }
    if (seen.has(b.index)) throw new FinancingError(`Hay más de un refuerzo en la cuota ${b.index}`);
    seen.add(b.index);
    if (!(b.amount > 0) || !isValidAmount(b.amount, currency)) {
      throw new FinancingError("Importe de refuerzo inválido");
    }
    sum += b.amount;
  }
  if (sum >= principal) throw new FinancingError("Los refuerzos no pueden cubrir todo el capital");
}

export function amortize(input: AmortizationInput): AmortizationResult {
  validate(input);
  const { currency, monthlyRate: i, termMonths: n, method, firstDueDate } = input;
  const P = toMinor(input.principal, currency);
  const balloonsMinor = new Map<number, number>();
  for (const b of input.balloons ?? []) balloonsMinor.set(b.index, toMinor(b.amount, currency));
  const balloonTotal = [...balloonsMinor.values()].reduce((a, b) => a + b, 0);

  // Cuota francesa exacta (sin redondear) y luego redondeada.
  let frenchPayment = 0;
  if (method === "frances") {
    if (i === 0) {
      frenchPayment = (P - balloonTotal) / n;
    } else {
      let pvBalloons = 0;
      for (const [k, amt] of balloonsMinor) pvBalloons += amt / Math.pow(1 + i, k);
      frenchPayment = ((P - pvBalloons) * i) / (1 - Math.pow(1 + i, -n));
    }
    frenchPayment = roundHalfUp(frenchPayment);
  }
  const germanPrincipal = (P - balloonTotal) / n;

  const anchorDay = Number(firstDueDate.slice(8, 10));
  const rows: ScheduleRow[] = [];
  let balance = P;
  let germanAccumulated = 0;

  for (let k = 1; k <= n; k++) {
    const dueDate = addMonths(firstDueDate, k - 1, anchorDay);
    const interest = roundHalfUp(balance * i);
    const balloon = balloonsMinor.get(k) ?? 0;
    let principal: number;

    if (k === n) {
      principal = balance - balloon;
    } else if (method === "frances") {
      principal = frenchPayment - interest;
    } else {
      // Capital alemán acumulado redondeado para que no se desvíe del ideal.
      const target = roundHalfUp(germanPrincipal * k);
      principal = target - germanAccumulated;
      germanAccumulated = target;
    }

    if (principal < 0) {
      throw new FinancingError(
        `Con estos refuerzos la cuota ${k} no alcanza a cubrir los intereses. Reduzca los refuerzos o el plazo.`,
      );
    }
    if (principal + balloon > balance) {
      throw new FinancingError("Los refuerzos superan el saldo pendiente en la cuota " + k);
    }

    balance -= principal;
    rows.push({
      kind: "cuota",
      index: k,
      dueDate,
      principal: fromMinor(principal, currency),
      interest: fromMinor(interest, currency),
      total: fromMinor(principal + interest, currency),
      balanceAfter: fromMinor(balance, currency),
      description: `Cuota ${k}/${n}`,
    });

    if (balloon > 0) {
      balance -= balloon;
      rows.push({
        kind: "refuerzo",
        index: k,
        dueDate,
        principal: fromMinor(balloon, currency),
        interest: 0,
        total: fromMinor(balloon, currency),
        balanceAfter: fromMinor(balance, currency),
        description: `Refuerzo (cuota ${k})`,
      });
    }
  }

  if (balance !== 0) {
    // No debería ocurrir: la última cuota absorbe el saldo.
    throw new FinancingError("Error interno: el cronograma no cancela el capital");
  }

  const totalInterestMinor = rows.reduce((a, r) => a + toMinor(r.interest, currency), 0);
  const firstRegular = rows.find((r) => r.kind === "cuota");
  return {
    rows,
    regularPayment: method === "frances" ? fromMinor(frenchPayment, currency) : (firstRegular?.total ?? 0),
    totalPrincipal: fromMinor(P, currency),
    totalInterest: fromMinor(totalInterestMinor, currency),
    totalPayable: fromMinor(P + totalInterestMinor, currency),
  };
}

/**
 * Ayuda para refuerzos estacionales (p. ej. julio y diciembre, coincidentes
 * con el aguinaldo): devuelve los índices de cuota cuyo vencimiento cae en
 * esos meses.
 */
export function balloonIndicesForMonths(firstDueDate: IsoDate, termMonths: number, months: readonly number[]): number[] {
  const anchor = Number(firstDueDate.slice(8, 10));
  const out: number[] = [];
  for (let k = 1; k <= termMonths; k++) {
    const m = Number(addMonths(firstDueDate, k - 1, anchor).slice(5, 7));
    if (months.includes(m)) out.push(k);
  }
  return out;
}
