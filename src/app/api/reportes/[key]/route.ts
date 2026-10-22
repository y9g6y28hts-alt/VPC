import { decimalsOf, isCurrency } from "@/domain/money";
import { getContext } from "@/server/auth/context";
import { toFriendlyError } from "@/server/errors";
import { getToday } from "@/server/queries/common";
import { canRunReport, parseReportFilters, reportByKey, type Column } from "@/server/reports";

export const runtime = "nodejs";

/**
 * Exportación CSV de un reporte. Requiere reports.export y acceso al reporte;
 * cada exportación queda en la auditoría. Formato para planillas en español:
 * separador «;», coma decimal, fechas dd/mm/aaaa, UTF-8 con BOM.
 */
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await getContext();
  if (!ctx) return new Response("No autorizado", { status: 401 });
  const report = reportByKey((await params).key);
  if (!report) return new Response("No encontrado", { status: 404 });
  if (!canRunReport(ctx, report) || !ctx.perms.has("reports.export")) return new Response("Sin permiso de exportación", { status: 403 });

  const url = new URL(request.url);
  const filters = parseReportFilters((k) => url.searchParams.get(k) ?? undefined, await getToday(ctx));
  let rows: Record<string, unknown>[];
  try {
    rows = await report.run(ctx, filters);
    await ctx.db((tx) => tx`select public.rpc_report_export_log(${ctx.org.id}, ${report.key}, ${tx.json({ ...filters } as never)}, ${rows.length})`);
  } catch (e) {
    return new Response(toFriendlyError(e).message, { status: 500 });
  }

  const base = ctx.org.baseCurrency;
  const header: string[] = [];
  const getters: Array<(r: Record<string, unknown>) => string> = [];
  const seenCurrency = new Set<string>();
  for (const c of report.columns) {
    if (c.type === "money") {
      const ck = c.currencyKey ?? "moneda";
      if (!seenCurrency.has(ck)) {
        seenCurrency.add(ck);
        header.push("Moneda");
        getters.push((r) => String(r[ck] ?? ""));
      }
    }
    header.push(c.type === "base" ? `${c.label} (${base})` : c.label);
    getters.push((r) => {
      const cur = c.type === "base" ? base : c.type === "money" ? String(r[c.currencyKey ?? "moneda"] ?? base) : undefined;
      return csvValue(c, r[c.key], cur);
    });
  }
  const lines = [header, ...rows.map((r) => getters.map((g) => g(r)))].map((cols) => cols.map(quote).join(";"));
  const meta = report.projected ? "PROYECCIÓN — no son movimientos registrados" : "";
  const title = `${report.title}${report.usesPeriod ? ` (${filters.from} a ${filters.to})` : ""}${ctx.org.isDemo ? " — DATOS DE DEMOSTRACIÓN" : ""}`;
  const body = "﻿" + [quote(title), ...(meta ? [quote(meta)] : []), "", ...lines].join("\r\n") + "\r\n";
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${report.key}-${stamp}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}

function csvValue(c: Column, v: unknown, currency?: string): string {
  if (v === null || v === undefined) return "";
  switch (c.type) {
    case "money":
    case "base":
      return Number(v).toFixed(currency && isCurrency(currency) ? decimalsOf(currency) : 2).replace(".", ",");
    case "number":
      return String(v);
    case "pct":
      return Number(v).toFixed(2).replace(".", ",");
    case "date": {
      const s = String(v).slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.split("-").reverse().join("/") : s;
    }
    default: {
      const s = c.labels?.[String(v)] ?? String(v);
      // Evita la interpretación como fórmula al abrir en una planilla.
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    }
  }
}

function quote(s: string): string {
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
