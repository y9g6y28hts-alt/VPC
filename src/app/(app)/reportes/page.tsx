import Link from "next/link";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, Notice } from "@/components/ui/states";
import { KindTag } from "@/components/ui/status";
import { Table, TableWrap, Td, TFootRow, Th, THead, Tr } from "@/components/ui/table";
import { addMonths, startOfMonth, endOfMonth } from "@/domain/dates";
import { formatDate, formatMoney, formatNumber, formatPercent } from "@/lib/format";
import { hrefWith, param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { toFriendlyError } from "@/server/errors";
import { getToday, listBrands, listMembers } from "@/server/queries/common";
import { REPORTS, canRunReport, parseReportFilters, reportByKey, type Column } from "@/server/reports";

export const metadata: Metadata = { title: "Reportes" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("reports.view");
  const sp = await searchParams;
  const available = REPORTS.filter((r) => canRunReport(ctx, r));
  const report = reportByKey(param(sp, "r")) ?? available[0];
  const today = await getToday(ctx);
  const filters = parseReportFilters((k) => param(sp, k), today);
  const canExport = ctx.perms.has("reports.export");

  if (!report || !canRunReport(ctx, report)) {
    return (
      <>
        <PageHeader title="Reportes" />
        <EmptyState title="No tiene reportes disponibles" description="Su rol no tiene acceso a la información que alimenta estos reportes." />
      </>
    );
  }

  const [brands, sellers] = await Promise.all([listBrands(ctx), ctx.perms.has("deals.view_all") ? listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : []]);
  let rows: Record<string, unknown>[] = [];
  let error: string | null = null;
  try {
    rows = await report.run(ctx, filters);
  } catch (e) {
    error = toFriendlyError(e).message;
  }

  const prevMonth = addMonths(startOfMonth(today), -1);
  const presets = [
    { label: "Mes en curso", from: startOfMonth(today), to: today },
    { label: "Mes anterior", from: prevMonth, to: endOfMonth(prevMonth) },
    { label: "Últimos 3 meses", from: addMonths(startOfMonth(today), -2), to: today },
    { label: "Año en curso", from: `${today.slice(0, 4)}-01-01`, to: today },
  ];
  const usesBrand = report.columns.length > 0 && ["inventario", "antiguedad", "ventas", "ventas_vendedor", "margen", "descuentos"].includes(report.key);
  const usesSeller = ["ventas", "ventas_marca", "margen", "descuentos"].includes(report.key) && sellers.length > 0;
  const qs = new URLSearchParams({ desde: filters.from, hasta: filters.to, ...(filters.brand ? { marca: filters.brand } : {}), ...(filters.seller ? { vendedor: filters.seller } : {}) });

  const groups = [...new Set(available.map((r) => r.group))];

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Información operativa calculada en el momento a partir de los registros. Las proyecciones se identifican como tales y nunca se mezclan con valores registrados."
      />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label="Reportes" className="flex gap-4 overflow-x-auto lg:flex-col lg:gap-5">
          {groups.map((g) => (
            <div key={g} className="min-w-44">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-faint">{g}</p>
              <ul className="flex flex-col">
                {available.filter((r) => r.group === g).map((r) => (
                  <li key={r.key}>
                    <Link
                      href={hrefWith("/reportes", sp, { r: r.key })}
                      aria-current={r.key === report.key ? "page" : undefined}
                      className={cn(
                        "block rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-elevated hover:text-ink",
                        r.key === report.key && "bg-elevated font-medium text-ink",
                      )}
                    >
                      {r.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <section aria-labelledby="report-title" className="min-w-0">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 id="report-title" className="flex items-center gap-2 text-lg font-semibold text-ink">
                {report.title} {report.projected ? <KindTag kind="proyectado" /> : null}
              </h2>
              <p className="mt-1 max-w-2xl text-[13px] text-muted">{report.description}</p>
            </div>
            {canExport && !error ? (
              <ButtonLink href={`/api/reportes/${report.key}?${qs}`} variant="outline" size="sm" prefetch={false}>
                <Download aria-hidden /> Exportar CSV
              </ButtonLink>
            ) : null}
          </div>

          <FilterForm keep={[["r", report.key]]}>
            {report.usesPeriod ? (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Desde</span>
                  <input type="date" name="desde" defaultValue={filters.from} className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Hasta</span>
                  <input type="date" name="hasta" defaultValue={filters.to} className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2" />
                </label>
              </>
            ) : null}
            {usesBrand ? <FilterSelect name="marca" label="Marca" defaultValue={filters.brand} allLabel="Todas" options={brands.map((b) => ({ value: b.id, label: b.name }))} /> : null}
            {usesSeller ? <FilterSelect name="vendedor" label="Vendedor" defaultValue={filters.seller} options={sellers.map((s) => ({ value: s.id, label: s.full_name }))} /> : null}
            {report.usesPeriod ? (
              <button type="submit" className="h-9 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-elevated">Aplicar</button>
            ) : null}
          </FilterForm>
          {report.usesPeriod ? (
            <div className="-mt-2 mb-4 flex flex-wrap gap-1.5">
              {presets.map((p) => {
                const active = p.from === filters.from && p.to === filters.to;
                return (
                  <Link key={p.label} href={hrefWith("/reportes", sp, { r: report.key, desde: p.from, hasta: p.to })}
                    className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", active ? "border-ink-2 text-ink" : "border-line text-muted hover:text-ink")}>
                    {p.label}
                  </Link>
                );
              })}
              <span className="self-center pl-1 text-[12px] text-faint">{formatDate(filters.from)} – {formatDate(filters.to)}</span>
            </div>
          ) : null}

          {report.projected ? (
            <div className="mb-4">
              <Notice tone="warning">Proyección: no son movimientos registrados. Supone cobros y pagos en fecha y usa el último tipo de cambio cargado; las cuotas vencidas impagas se informan aparte y no se suman al flujo futuro.</Notice>
            </div>
          ) : null}

          {error ? (
            <ErrorState detail={error} />
          ) : rows.length === 0 ? (
            <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin resultados para los filtros seleccionados" /></div>
          ) : (
            <ReportTable columns={report.columns} rows={rows} base={ctx.org.baseCurrency} totals={!report.noTotals} />
          )}
          {!error && rows.length > 0 ? (
            <p className="mt-2 text-[12px] text-faint">
              {formatNumber(rows.length)} filas · importes «base» en {ctx.org.baseCurrency} convertidos con el tipo de cambio de cada operación o, si no corresponde, el último registrado.
              {!canExport ? " Su rol no tiene permiso de exportación." : ""}
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

function cell(col: Column, row: Record<string, unknown>, base: string) {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return <span className="text-faint">—</span>;
  switch (col.type) {
    case "money":
      return formatMoney(v as string, String(row[col.currencyKey ?? "moneda"] ?? base));
    case "base":
      return formatMoney(v as string, base);
    case "number":
      return formatNumber(v as string);
    case "pct":
      return formatPercent(v as string, 2);
    case "date":
      return formatDate(v as string);
    default:
      return col.labels?.[String(v)] ?? String(v);
  }
}

function ReportTable({ columns, rows, base, totals: withTotals }: { columns: Column[]; rows: Record<string, unknown>[]; base: string; totals: boolean }) {
  const numeric = (c: Column) => c.type !== "text" && c.type !== "date";
  // Totales: sólo columnas aditivas. Importes en moneda de origen, separados por moneda.
  const totals = columns.map((c) => {
    if (c.type === "base" || c.type === "number") {
      if (c.key === "dias" || c.key === "dias_atraso") return null;
      return { [base]: rows.reduce((a, r) => a + Number(r[c.key] ?? 0), 0) };
    }
    if (c.type === "money") {
      return rows.reduce<Record<string, number>>((a, r) => {
        const cur = String(r[c.currencyKey ?? "moneda"] ?? base);
        a[cur] = (a[cur] ?? 0) + Number(r[c.key] ?? 0);
        return a;
      }, {});
    }
    return null;
  });
  return (
    <TableWrap className="max-h-[70vh]">
      <Table>
        <THead>{columns.map((c) => <Th key={c.key} numeric={numeric(c)}>{c.label}</Th>)}</THead>
        <tbody>
          {rows.map((r, i) => (
            <Tr key={i}>
              {columns.map((c) => (
                <Td key={c.key} numeric={numeric(c)} className={cn("whitespace-nowrap", c.type === "date" && "num")}>{cell(c, r, base)}</Td>
              ))}
            </Tr>
          ))}
        </tbody>
        {withTotals && rows.length > 1 ? (
          <TFootRow>
            {columns.map((c, i) => (
              <Td key={c.key} numeric={numeric(c)}>
                {i === 0 ? "Total" : totals[i]
                  ? Object.entries(totals[i]!).map(([cur, v]) => <span key={cur} className="block">{c.type === "number" ? formatNumber(v) : formatMoney(v, cur)}</span>)
                  : null}
              </Td>
            ))}
          </TFootRow>
        ) : null}
      </Table>
    </TableWrap>
  );
}
