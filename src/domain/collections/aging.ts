/**
 * Clasificación de mora.
 *
 * Días de atraso de una cuota = hoy − vencimiento, sólo si tiene saldo
 * pendiente (aplicaciones de pagos CONFIRMADOS). Una cuota saldada nunca está
 * vencida. Días de atraso de un contrato = los de su cuota impaga más antigua.
 *
 * Los tramos son configurables por organización (tabla aging_buckets); los
 * tramos por defecto replican los de la base de datos.
 */
import { type IsoDate, daysBetween } from "../dates";

export interface AgingBucket {
  label: string;
  minDays: number;
  maxDays: number | null;
}

export const DEFAULT_AGING_BUCKETS: readonly AgingBucket[] = [
  { label: "Al día", minDays: 0, maxDays: 0 },
  { label: "1–30 días", minDays: 1, maxDays: 30 },
  { label: "31–60 días", minDays: 31, maxDays: 60 },
  { label: "61–90 días", minDays: 61, maxDays: 90 },
  { label: "Más de 90 días", minDays: 91, maxDays: null },
];

export function daysOverdue(dueDate: IsoDate, today: IsoDate, outstanding: number): number {
  if (!(outstanding > 0)) return 0;
  return Math.max(0, daysBetween(dueDate, today));
}

export function agingBucket(days: number, buckets: readonly AgingBucket[] = DEFAULT_AGING_BUCKETS): AgingBucket {
  const found = buckets.find((b) => days >= b.minDays && (b.maxDays === null || days <= b.maxDays));
  if (!found) throw new Error(`No hay tramo de mora para ${days} días`);
  return found;
}

export type AgingSeverity = "ok" | "low" | "medium" | "high" | "critical";

export function agingSeverity(days: number): AgingSeverity {
  if (days <= 0) return "ok";
  if (days <= 30) return "low";
  if (days <= 60) return "medium";
  if (days <= 90) return "high";
  return "critical";
}
