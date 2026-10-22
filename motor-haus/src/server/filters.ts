import { addDays } from "@/domain/finance/dates";
import { isCurrency } from "@/domain/finance/money";
import { sp, SearchParams } from "@/components/ui/Table";

export interface Period { from: string; to: string; preset: string; label: string }

const PRESETS: Record<string, string> = { "30": "Últimos 30 días", "90": "Últimos 90 días", ytd: "Año en curso", "365": "Últimos 12 meses", custom: "Personalizado" };
export const PERIOD_OPTIONS = Object.entries(PRESETS) as Array<[string, string]>;

export function resolvePeriod(params: SearchParams, today: string, fallback = "90"): Period {
  const preset = sp(params, "p") ?? fallback;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (preset === "custom") {
    const from = sp(params, "from"), to = sp(params, "to");
    if (from && to && iso.test(from) && iso.test(to) && from <= to) return { from, to, preset, label: `${from} → ${to}` };
  }
  if (preset === "ytd") return { from: `${today.slice(0, 4)}-01-01`, to: today, preset, label: PRESETS.ytd };
  const days = preset === "30" ? 30 : preset === "365" ? 365 : 90;
  return { from: addDays(today, -(days - 1)), to: today, preset: String(days), label: PRESETS[String(days)] };
}

export function resolveCurrency(params: SearchParams, fallback: string): string {
  const c = sp(params, "ccy");
  return c && isCurrency(c) ? c : fallback;
}

export function uuidOrNull(v: string | undefined): string | null {
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}
