import { AlertTriangle, CheckCircle2, Circle, CircleDot, Info, OctagonAlert } from "lucide-react";
import type { Tone } from "@/lib/labels";

const TONES: Record<Tone, string> = {
  neutral: "border-line text-text-2 bg-raised",
  good: "border-good/30 text-good bg-good-bg",
  warn: "border-warn/30 text-warn bg-warn-bg",
  risk: "border-risk/40 text-risk bg-risk-bg",
  info: "border-info/30 text-info bg-info-bg",
  accent: "border-accent/35 text-accent bg-accent/8",
};
const ICONS: Record<Tone, typeof Circle> = {
  neutral: Circle, good: CheckCircle2, warn: AlertTriangle, risk: OctagonAlert, info: Info, accent: CircleDot,
};

/** Estado con icono + texto: nunca depende solo del color. */
export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  const Icon = ICONS[tone];
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-sm border px-1.5 py-0.5 text-[11px] font-medium leading-4 ${TONES[tone]}`}>
      <Icon aria-hidden className="size-3 shrink-0" strokeWidth={2} />
      {children}
    </span>
  );
}

export function StatusBadge({ map, value }: { map: Record<string, [string, Tone]>; value: string | null | undefined }) {
  if (!value) return <span className="text-faint">—</span>;
  const [text, tone] = map[value] ?? [value, "neutral" as Tone];
  return <Badge tone={tone}>{text}</Badge>;
}

/** Procedencia de una cifra: real, estimada, manual, proyectada. */
export function Basis({ kind }: { kind: "real" | "estimado" | "manual" | "proyección" | "confirmado" | "contractual" }) {
  const cls = kind === "estimado" || kind === "proyección" ? "text-warn border-warn/30" : kind === "manual" ? "text-info border-info/30" : "text-muted border-line";
  return <span className={`rounded-sm border px-1 py-px text-[10px] uppercase tracking-wider ${cls}`}>{kind}</span>;
}
