/**
 * Cancelación anticipada.
 *
 * Importe de cancelación = saldo de todas las cuotas ya vencidas (capital,
 * interés y recargos) + capital pendiente de las cuotas no vencidas.
 * Los intereses de las cuotas no vencidas no se cobran; si ya fueron
 * generados en el contrato, se descuentan mediante una nota de crédito
 * por `waivedInterest`, que requiere aprobación.
 *
 * Cuando una cuota no vencida tiene un pago parcial, se considera que el
 * pago cubrió primero su interés (criterio conservador para la empresa).
 */
import { type CurrencyCode, fromMinor, toMinor } from "../money";
import { type IsoDate, compareDates } from "../dates";

export interface PayoffInstallment {
  dueDate: IsoDate;
  principal: number;
  interest: number;
  fee: number;
  /** Saldo pendiente (importe − cancelado − aplicado) */
  outstanding: number;
}

export interface PayoffQuote {
  overdueAmount: number;
  futurePrincipal: number;
  waivedInterest: number;
  payoffAmount: number;
}

export function earlyPayoffQuote(
  installments: readonly PayoffInstallment[],
  today: IsoDate,
  currency: CurrencyCode,
): PayoffQuote {
  let overdue = 0;
  let futurePrincipal = 0;
  let waived = 0;
  for (const inst of installments) {
    const out = toMinor(inst.outstanding, currency);
    if (out <= 0) continue;
    if (compareDates(inst.dueDate, today) <= 0) {
      overdue += out;
      continue;
    }
    const total = toMinor(inst.principal + inst.interest + inst.fee, currency);
    const paid = total - out;
    const interestAndFee = toMinor(inst.interest + inst.fee, currency);
    const interestLeft = Math.max(0, interestAndFee - paid);
    const principalLeft = out - interestLeft;
    futurePrincipal += principalLeft;
    waived += interestLeft;
  }
  return {
    overdueAmount: fromMinor(overdue, currency),
    futurePrincipal: fromMinor(futurePrincipal, currency),
    waivedInterest: fromMinor(waived, currency),
    payoffAmount: fromMinor(overdue + futurePrincipal, currency),
  };
}
