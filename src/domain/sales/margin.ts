/**
 * Márgenes. Todos los importes en moneda base de la organización.
 *
 *   Margen estimado de inventario = precio de lista − costes (registrados + estimados)
 *   Margen estimado de operación  = precio de venta − costes (registrados + estimados)
 *   Margen bruto realizado        = precio de venta − costes registrados,
 *                                   sólo para operaciones ENTREGADAS y sin
 *                                   costes estimados pendientes.
 *   Gastos pendientes             = costes marcados como estimados.
 *
 * Margen de trade-in estimado = precio de reventa esperado − valor de
 *   aceptación − costes atribuibles (reparaciones estimadas + otros).
 *
 * Los intereses de financiación NO forman parte del margen bruto de la unidad;
 * se informan por separado como ingreso financiero proyectado.
 */
import { type CurrencyCode, fromMinor, toMinor } from "../money";

export interface CostLine {
  amountBase: number;
  isEstimate: boolean;
}

export interface OperationMargin {
  registeredCosts: number;
  pendingCosts: number;
  totalCosts: number;
  estimatedMargin: number;
  estimatedMarginPct: number | null;
  /** null si la operación no está entregada o tiene costes pendientes */
  realizedMargin: number | null;
}

export function operationMargin(
  salePriceBase: number,
  costs: readonly CostLine[],
  base: CurrencyCode,
  delivered: boolean,
): OperationMargin {
  const registered = costs.filter((c) => !c.isEstimate).reduce((a, c) => a + toMinor(c.amountBase, base), 0);
  const pending = costs.filter((c) => c.isEstimate).reduce((a, c) => a + toMinor(c.amountBase, base), 0);
  const sale = toMinor(salePriceBase, base);
  const estimated = sale - registered - pending;
  return {
    registeredCosts: fromMinor(registered, base),
    pendingCosts: fromMinor(pending, base),
    totalCosts: fromMinor(registered + pending, base),
    estimatedMargin: fromMinor(estimated, base),
    estimatedMarginPct: sale > 0 ? Math.round((estimated / sale) * 10000) / 100 : null,
    realizedMargin: delivered && pending === 0 ? fromMinor(sale - registered, base) : null,
  };
}

export interface TradeInMarginInput {
  expectedResalePrice: number;
  acceptedValue: number;
  attributableCosts: number;
  currency: CurrencyCode;
}

export function tradeInEstimatedMargin(i: TradeInMarginInput): number {
  return fromMinor(
    toMinor(i.expectedResalePrice, i.currency) - toMinor(i.acceptedValue, i.currency) - toMinor(i.attributableCosts, i.currency),
    i.currency,
  );
}
