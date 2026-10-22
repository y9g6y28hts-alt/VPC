import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Gráficos de Da Silva OS. Renderizados en el servidor (HTML + CSS), sin
 * dependencias. Convenciones (guía de visualización):
 *   - una serie por gráfico (el título la nombra, sin leyenda); un solo eje;
 *   - barras finas con extremo de datos redondeado de 4 px anclado a la base;
 *   - grilla recesiva; tooltip al pasar el cursor o enfocar (teclado);
 *   - cada gráfico ofrece su tabla de datos («Ver datos»).
 * Los colores de estado (crítico/advertencia) nunca se usan como color de serie.
 */

export interface Datum {
  key: string;
  label: string;
  value: number;
  display: string;
  detail?: string;
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-raised px-2.5 py-1.5 text-[12px] text-ink shadow-[var(--shadow-pop)] group-hover:block group-focus-visible:block"
    >
      {children}
    </span>
  );
}

function DataTable({ data, valueLabel }: { data: Datum[]; valueLabel: string }) {
  return (
    <details className="mt-3 text-[12.5px]">
      <summary className="cursor-pointer text-faint hover:text-ink-2">Ver datos</summary>
      <table className="mt-2 w-full">
        <thead><tr className="text-left text-faint"><th className="py-1 font-medium">Período / categoría</th><th className="py-1 text-right font-medium">{valueLabel}</th></tr></thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key} className="border-t border-line-soft"><td className="py-1 text-ink-2">{d.label}</td><td className="num py-1 text-right text-ink">{d.display}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** Barras horizontales (distribuciones por categoría ordenada). */
export function HBars({ data, valueLabel, color = "var(--color-series-1)", emptyText = "Sin datos" }: { data: Datum[]; valueLabel: string; color?: string; emptyText?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (max <= 0) return <p className="py-6 text-center text-[13px] text-faint">{emptyText}</p>;
  return (
    <div>
      <ul className="space-y-2.5">
        {data.map((d) => {
          const pct = (d.value / max) * 100;
          return (
            <li key={d.key} className="grid grid-cols-[minmax(84px,30%)_1fr_auto] items-center gap-3 text-[12.5px]">
              <span className="truncate text-ink-2">{d.label}</span>
              <span tabIndex={0} aria-label={`${d.label}: ${d.display}`} className="group relative flex h-5 items-center outline-none">
                <span className="absolute inset-y-[9px] left-0 right-0 rounded-full bg-[var(--color-grid)]" aria-hidden />
                <span className="relative h-2.5 rounded-r-[4px] transition-[filter] group-hover:brightness-125" style={{ width: `${Math.max(pct, d.value > 0 ? 1.5 : 0)}%`, background: color }} />
                <Tip><span className="font-medium">{d.label}</span> · {d.display}{d.detail ? <span className="text-muted"> · {d.detail}</span> : null}</Tip>
              </span>
              <span className="num text-right text-ink">{d.display}</span>
            </li>
          );
        })}
      </ul>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}

/** Columnas verticales para series temporales (meses). */
export function Columns({ data, valueLabel, color = "var(--color-series-1)", height = 168, axisFormat, emptyText = "Sin movimientos en el período" }: { data: Datum[]; valueLabel: string; color?: string; height?: number; axisFormat: (n: number) => string; emptyText?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (max <= 0) return <p className="py-6 text-center text-[13px] text-faint">{emptyText}</p>;
  const top = niceMax(max);
  const ticks = [0, top / 2, top];
  return (
    <div>
      <div className="relative mt-6" style={{ height }}>
        {ticks.map((t, i) => (
          <div key={i} className="absolute inset-x-0 flex items-center gap-2" style={{ bottom: `${top ? (t / top) * 100 : 0}%` }} aria-hidden>
            <span className="num w-14 shrink-0 -translate-y-1/2 text-right text-[10.5px] text-faint">{axisFormat(t)}</span>
            <span className="h-px flex-1 -translate-y-1/2 bg-[var(--color-grid)]" />
          </div>
        ))}
        <ol className="absolute inset-y-0 left-16 right-0 flex items-end gap-[2px]">
          {data.map((d) => (
            <li key={d.key} tabIndex={0} aria-label={`${d.label}: ${d.display}`} className="group relative flex h-full flex-1 items-end justify-center outline-none">
              <span className="w-[62%] max-w-7 rounded-t-[4px] transition-[filter] group-hover:brightness-125"
                style={{ height: `${top ? (d.value / top) * 100 : 0}%`, minHeight: d.value > 0 ? 2 : 0, background: color }} />
              <Tip><span className="font-medium">{d.label}</span> · {d.display}{d.detail ? <span className="text-muted"> · {d.detail}</span> : null}</Tip>
            </li>
          ))}
        </ol>
      </div>
      <ol className="ml-16 mt-1.5 flex gap-[2px]" aria-hidden>
        {data.map((d, i) => (
          <li key={d.key} className="flex-1 truncate text-center text-[10.5px] text-faint">{i % Math.ceil(data.length / 12) === 0 ? d.label : ""}</li>
        ))}
      </ol>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}

/** Línea para evolución (p. ej. morosidad). Puntos con área de interacción por mes. */
export function Line({ data, valueLabel, color = "var(--color-series-2)", height = 168, axisFormat, emptyText = "Sin valores en el período" }: { data: Datum[]; valueLabel: string; color?: string; height?: number; axisFormat: (n: number) => string; emptyText?: string }) {
  const max = Math.max(0, ...data.map((d) => d.value));
  if (max <= 0) return <p className="py-6 text-center text-[13px] text-faint">{emptyText}</p>;
  const top = niceMax(max);
  const n = data.length;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => (top ? 100 - (v / top) * 100 : 100);
  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  return (
    <div>
      <div className="relative ml-16 mt-6" style={{ height }}>
        {[0, top / 2, top].map((t, i) => (
          <div key={i} className="absolute inset-x-0 flex items-center" style={{ bottom: `${top ? (t / top) * 100 : 0}%` }} aria-hidden>
            <span className="num absolute -left-16 w-14 -translate-y-1/2 text-right text-[10.5px] text-faint">{axisFormat(t)}</span>
            <span className="h-px w-full -translate-y-1/2 bg-[var(--color-grid)]" />
          </div>
        ))}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          <polyline points={points} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <ol className="absolute inset-0">
          {data.map((d, i) => (
            <li key={d.key} tabIndex={0} aria-label={`${d.label}: ${d.display}`} className="group absolute top-0 h-full -translate-x-1/2 outline-none"
              style={{ left: `${x(i)}%`, width: `${100 / Math.max(n, 1)}%` }}>
              <span className="absolute left-1/2 top-0 hidden h-full w-px -translate-x-1/2 bg-line group-hover:block group-focus-visible:block" aria-hidden />
              <span className="absolute left-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface" style={{ top: `${y(d.value)}%`, background: color }} aria-hidden />
              <span className="absolute left-1/2" style={{ top: `${y(d.value)}%` }}><Tip><span className="font-medium">{d.label}</span> · {d.display}{d.detail ? <span className="text-muted"> · {d.detail}</span> : null}</Tip></span>
            </li>
          ))}
        </ol>
      </div>
      <ol className="ml-16 mt-1.5 flex justify-between" aria-hidden>
        {data.map((d, i) => <li key={d.key} className="text-[10.5px] text-faint">{i % Math.ceil(n / 6) === 0 || i === n - 1 ? d.label : ""}</li>)}
      </ol>
      <DataTable data={data} valueLabel={valueLabel} />
    </div>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 0;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

export function ChartCard({ title, subtitle, children, className }: { title: string; subtitle?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-lg border border-line-soft bg-surface p-4", className)}>
      <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
      {subtitle ? <p className="mt-0.5 text-[12px] text-faint">{subtitle}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
