/**
 * Orden de la bandeja diaria de cobranza.
 *
 * Prioriza, en este orden:
 *   1. Promesas de pago incumplidas (el cliente se comprometió y no pagó).
 *   2. Acciones agendadas para hoy o atrasadas.
 *   3. Mayor importe vencido (en moneda base) ponderado por antigüedad.
 * El puntaje es explicable: cada componente se devuelve junto al total.
 */
export interface CollectionCase {
  overdueAmountBase: number;
  maxDaysOverdue: number;
  brokenPromises: number;
  nextActionDue: boolean;
}

export interface PriorityScore {
  score: number;
  reasons: string[];
}

export function collectionPriority(c: CollectionCase): PriorityScore {
  const reasons: string[] = [];
  let score = 0;
  if (c.brokenPromises > 0) {
    score += 1_000_000;
    reasons.push(c.brokenPromises === 1 ? "Promesa de pago incumplida" : `${c.brokenPromises} promesas incumplidas`);
  }
  if (c.nextActionDue) {
    score += 500_000;
    reasons.push("Gestión agendada para hoy o atrasada");
  }
  if (c.maxDaysOverdue > 0) {
    // Logaritmo del importe para que una deuda grande no tape todo lo demás.
    const amountFactor = Math.log10(Math.max(10, c.overdueAmountBase));
    const ageFactor = 1 + Math.min(c.maxDaysOverdue, 180) / 30;
    score += Math.round(amountFactor * ageFactor * 10_000);
    reasons.push(`${c.maxDaysOverdue} días de atraso`);
  }
  return { score, reasons };
}
