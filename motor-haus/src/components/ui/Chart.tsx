"use client";

import { useState } from "react";
import { money } from "@/lib/format";

// Gráfico de columnas con capa de hover. Sobre la superficie azul de marca:
// serie 1 azul claro, serie 2 blanco azulado (distintas en luminosidad, legibles con CVD).
const SERIES = ["var(--color-accent-deep)", "var(--color-steel)"];

export interface BarDatum { label: string; values: number[]; note?: string }

export function BarChart({ data, series, currency, height = 180, target, targetLabel, ariaLabel, width = 640 }: {
  data: BarDatum[]; series: string[]; currency: string; height?: number; target?: number; targetLabel?: string; ariaLabel: string; width?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, target ?? 0, ...data.flatMap((d) => d.values));
  const nice = niceMax(max);
  const W = width, H = height, padL = 56, padB = 22, padT = 8, padR = 8;
  const plotW = W - padL - padR, plotH = H - padB - padT;
  const groupW = plotW / Math.max(1, data.length);
  const barW = Math.min(28, (groupW - 10) / series.length - 2);
  const y = (v: number) => padT + plotH - (v / nice) * plotH;
  const ticks = [0, 0.5, 1].map((t) => t * nice);

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3">
        {series.length > 1 ? (
          <ul className="flex flex-wrap gap-3 text-xs text-text-2">
            {series.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5"><span className="inline-block size-2.5 rounded-[2px]" style={{ background: SERIES[i] }} />{s}</li>
            ))}
            {target !== undefined && <li className="flex items-center gap-1.5"><span className="inline-block h-px w-4 border-t border-dashed border-text-2" />{targetLabel}</li>}
          </ul>
        ) : <span className="text-xs text-muted">{series[0]}{target !== undefined && <> · <span className="border-b border-dashed border-text-2">{targetLabel}</span></>}</span>}
        <button type="button" onClick={() => setAsTable((v) => !v)} className="text-xs text-muted underline-offset-2 hover:text-text hover:underline">
          {asTable ? "Ver gráfico" : "Ver tabla"}
        </button>
      </div>
      {asTable ? (
        <table className="mh-table">
          <thead><tr><th>Período</th>{series.map((s) => <th key={s} className="r">{s}</th>)}</tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.label}><td>{d.label}</td>{d.values.map((v, i) => <td key={i} className="r num">{money(v, currency)}</td>)}</tr>
          ))}</tbody>
        </table>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full" onMouseLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke="var(--color-line-soft)" />
              <text x={padL - 8} y={y(t) + 3} textAnchor="end" className="fill-[var(--color-faint)] text-[11px]">{money(t, currency, { compact: true })}</text>
            </g>
          ))}
          {data.map((d, gi) => {
            const gx = padL + gi * groupW;
            const total = series.length * (barW + 2) - 2;
            return (
              <g key={d.label} onMouseEnter={() => setHover(gi)}>
                <rect x={gx} y={padT} width={groupW} height={plotH} fill={hover === gi ? "var(--color-raised)" : "transparent"} />
                {d.values.map((v, si) => {
                  const x = gx + (groupW - total) / 2 + si * (barW + 2);
                  const h = Math.max(0, padT + plotH - y(v));
                  const r = Math.min(4, h, barW / 2);
                  return h > 0 ? (
                    <path key={si} fill={SERIES[si]} d={`M${x},${padT + plotH} v${-(h - r)} q0,${-r} ${r},${-r} h${barW - 2 * r} q${r},0 ${r},${r} v${h - r} z`} />
                  ) : null;
                })}
                <text x={gx + groupW / 2} y={H - 6} textAnchor="middle" className="fill-[var(--color-muted)] text-[11px]">{d.label}</text>
              </g>
            );
          })}
          {target !== undefined && (
            <line x1={padL} x2={W - padR} y1={y(target)} y2={y(target)} stroke="var(--color-text-2)" strokeDasharray="4 4" />
          )}
        </svg>
      )}
      {!asTable && hover !== null && (
        <div className="pointer-events-none absolute right-0 top-6 z-10 min-w-44 rounded-sm border border-line bg-raised px-3 py-2 text-xs shadow-lg">
          <div className="mb-1 font-medium text-text">{data[hover].label}</div>
          {series.map((s, i) => (
            <div key={s} className="flex justify-between gap-4 text-text-2">
              <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-[2px]" style={{ background: SERIES[i] }} />{s}</span>
              <span className="num text-text">{money(data[hover].values[i], currency)}</span>
            </div>
          ))}
          {data[hover].note && <div className="mt-1 text-faint">{data[hover].note}</div>}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Barra horizontal proporcional (distribuciones con etiqueta y valor visibles). */
export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "risk" | "warn" | "muted" }) {
  const w = max > 0 ? Math.max(value > 0 ? 2 : 0, (value / max) * 100) : 0;
  const color = { accent: "var(--color-accent-deep)", risk: "var(--color-risk)", warn: "var(--color-warn)", muted: "var(--color-faint)" }[tone];
  return (
    <div className="h-1.5 w-full rounded-full bg-line-soft" aria-hidden>
      <div className="h-1.5 rounded-full" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}
