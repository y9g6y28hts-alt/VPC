import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "./cn";
import { InfoTip } from "./info-tip";
import { KindTag } from "./status";

export interface StatDefinition {
  formula: string;
  source: string;
}

/**
 * Indicador clave. Cada indicador declara su definición (fórmula y fuente)
 * y si el valor es registrado, estimado o proyectado.
 */
export function Stat({
  id,
  label,
  value,
  sub,
  kind = "registrado",
  definition,
  tone = "neutral",
  href,
}: {
  id: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  kind?: "registrado" | "estimado" | "proyectado";
  definition: StatDefinition;
  tone?: "neutral" | "critical" | "warning" | "positive";
  href?: string;
}) {
  const accent = {
    neutral: "before:bg-line",
    critical: "before:bg-critical",
    warning: "before:bg-warning",
    positive: "before:bg-positive",
  }[tone];
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12.5px] font-medium text-muted">{label}</span>
        <span className="flex items-center gap-1">
          {kind !== "registrado" ? <KindTag kind={kind} /> : null}
        </span>
      </div>
      <div className="display num mt-2 truncate text-[24px] font-semibold leading-none text-ink">{value}</div>
      {sub ? <div className="num mt-2 truncate text-[12.5px] text-faint">{sub}</div> : null}
    </>
  );
  return (
    <div
      data-stat={id}
      className={cn(
        "relative flex min-w-0 flex-col rounded-lg border border-line-soft bg-surface px-4 py-3.5",
        "before:absolute before:inset-y-3 before:left-0 before:w-[2px] before:rounded-r",
        accent,
      )}
    >
      <div className="absolute right-2 top-2.5">
        <InfoTip id={`def-${id}`} title={label}>
          <p>{definition.formula}</p>
          <p className="mt-2 text-[12px] text-faint">Fuente: {definition.source}</p>
          {kind !== "registrado" ? (
            <p className="mt-2 text-[12px] text-warning">
              Valor {kind}: no corresponde a un importe registrado ni verificado.
            </p>
          ) : null}
        </InfoTip>
      </div>
      {href ? (
        <Link href={href} className="block pr-6 outline-offset-4">
          {body}
        </Link>
      ) : (
        <div className="pr-6">{body}</div>
      )}
    </div>
  );
}

export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5", className)}>{children}</div>;
}
