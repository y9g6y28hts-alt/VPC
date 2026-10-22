import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatusTone = "neutral" | "positive" | "warning" | "critical" | "info" | "brand";

const tones: Record<StatusTone, string> = {
  neutral: "bg-elevated text-ink-2 border-line",
  positive: "bg-positive-soft text-positive border-positive/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  critical: "bg-critical-soft text-critical border-critical/30",
  info: "bg-info-soft text-info border-info/30",
  brand: "bg-brand-soft text-ink border-brand/40",
};

const dots: Record<StatusTone, string> = {
  neutral: "bg-faint",
  positive: "bg-positive",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-info",
  brand: "bg-brand",
};

export function StatusPill({ tone = "neutral", children, className }: { tone?: StatusTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm border px-2 text-[12px] font-medium",
        tones[tone],
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}

/** Pastilla a partir de un catálogo de src/lib/labels.ts */
export function CatalogPill({
  catalog,
  value,
}: {
  catalog: Record<string, { label: string; tone: StatusTone }>;
  value: string | null | undefined;
}) {
  if (!value) return <span className="text-faint">—</span>;
  const item = catalog[value] ?? { label: value, tone: "neutral" as const };
  return <StatusPill tone={item.tone}>{item.label}</StatusPill>;
}

/** Marca discreta para diferenciar valores estimados de registrados. */
export function KindTag({ kind }: { kind: "registrado" | "estimado" | "proyectado" | "demo" }) {
  const map = {
    registrado: "text-ink-2 border-line",
    estimado: "text-warning border-warning/40",
    proyectado: "text-info border-info/40",
    demo: "text-brand border-brand/50",
  } as const;
  return (
    <span className={cn("inline-flex h-[18px] items-center rounded-sm border px-1.5 text-[10.5px] font-semibold uppercase tracking-wider", map[kind])}>
      {kind}
    </span>
  );
}
