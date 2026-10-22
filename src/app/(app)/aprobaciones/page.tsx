import Link from "next/link";
import type { Metadata } from "next";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ApprovalButtons } from "@/components/finance/approval-buttons";
import { formatDateTime, formatMoney, formatNumber } from "@/lib/format";
import { APPROVAL_KIND, APPROVAL_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";

export const metadata: Metadata = { title: "Aprobaciones" };

const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/ventas/${id}`,
  contract: (id) => `/financiaciones/${id}`,
  trade_in: (id) => `/tradein/${id}`,
  supplier_invoice: (id) => `/compras/facturas/${id}`,
  expense: () => `/gastos`,
};

interface Row {
  id: string; kind: string; entity_type: string; entity_id: string; title: string; reason: string | null; amount: string | null; currency: string | null;
  payload: Record<string, unknown>; status: string; requested_by_id: string | null; requested_by: string | null; requested_at: Date;
  decided_by: string | null; decided_at: Date | null; decision_note: string | null; can_decide: boolean;
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("deals.approve", "contracts.approve", "tradein.approve", "payables.approve", "expenses.approve");
  const sp = await searchParams;
  const tab = param(sp, "vista") === "historial" ? "historial" : "pendientes";
  const rows = await ctx.db((tx) => tx<Row[]>`
    select a.id, a.kind, a.entity_type, a.entity_id, a.title, a.reason, a.amount, a.currency, a.payload, a.status,
           a.requested_by as requested_by_id, r.full_name as requested_by, a.requested_at, d.full_name as decided_by, a.decided_at, a.decision_note,
           app.has_perm(a.org_id, app.approval_permission(a.kind)) as can_decide
    from public.approvals a
    left join public.user_profiles r on r.id = a.requested_by
    left join public.user_profiles d on d.id = a.decided_by
    where a.org_id = ${ctx.org.id} and ${tab === "pendientes" ? tx`a.status = 'pendiente'` : tx`a.status <> 'pendiente'`}
    order by ${tab === "pendientes" ? tx`a.requested_at` : tx`a.decided_at desc`}
    limit 200`);
  const isDirector = ctx.org.role === "director";

  return (
    <>
      <PageHeader title="Aprobaciones" description="Descuentos, precios bajo mínimo, tasaciones, ajustes de cuenta, refinanciaciones, facturas y gastos. Quien solicita no puede aprobar su propia solicitud (salvo dirección)." />
      <Tabs active={tab} items={[{ key: "pendientes", label: "Pendientes", href: "/aprobaciones" }, { key: "historial", label: "Historial", href: "/aprobaciones?vista=historial" }]} />
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title={tab === "pendientes" ? "No hay solicitudes pendientes" : "Sin historial"} /></div> : (
        <TableWrap>
          <Table>
            <THead><Th>Tipo</Th><Th>Solicitud</Th><Th numeric>Importe</Th><Th>Solicitó</Th>{tab === "historial" ? <><Th>Estado</Th><Th>Resolvió</Th></> : <Th />}</THead>
            <tbody>
              {rows.map((a) => {
                const href = ENTITY_HREF[a.entity_type]?.(a.entity_id);
                const own = a.requested_by_id === ctx.userId && !isDirector;
                return (
                  <Tr key={a.id}>
                    <Td><StatusPill tone={a.kind === "refinanciacion" || a.kind === "nota_credito" ? "warning" : "neutral"}>{APPROVAL_KIND[a.kind]}</StatusPill></Td>
                    <Td className="max-w-[520px]">
                      {href ? <Link href={href} className="font-medium text-ink hover:underline">{a.title}</Link> : <span className="font-medium text-ink">{a.title}</span>}
                      {a.reason ? <p className="mt-0.5 text-[12.5px] text-muted">{a.reason}</p> : null}
                      <Detail a={a} />
                    </Td>
                    <Td numeric>{a.amount ? <Money value={a.amount} currency={a.currency ?? "PYG"} /> : "—"}</Td>
                    <Td><span className="text-ink-2">{a.requested_by}</span><span className="block whitespace-nowrap text-[11.5px] text-faint">{formatDateTime(a.requested_at)}</span></Td>
                    {tab === "historial" ? (
                      <>
                        <Td><CatalogPill catalog={APPROVAL_STATUS} value={a.status} /></Td>
                        <Td><span className="text-ink-2">{a.decided_by ?? "—"}</span><span className="block text-[11.5px] text-faint">{formatDateTime(a.decided_at)}{a.decision_note ? ` · «${a.decision_note}»` : ""}</span></Td>
                      </>
                    ) : (
                      <Td className="text-right">
                        {!a.can_decide ? <span className="text-[12px] text-faint">Lo decide otro rol</span>
                          : own ? <span className="text-[12px] text-faint">Solicitud propia: la decide otra persona</span>
                          : <ApprovalButtons id={a.id} title={a.title} />}
                      </Td>
                    )}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}

function Detail({ a }: { a: Row }) {
  const p = a.payload ?? {};
  if (a.kind === "descuento" || a.kind === "precio_bajo_minimo") {
    return (
      <p className="num mt-1 text-[12px] text-faint">
        Lista {formatMoney(p.list_price as number, a.currency ?? "PYG")} · venta {formatMoney(p.sale_price as number, a.currency ?? "PYG")} · descuento {formatNumber(Number(p.discount_pct), 2)} %
        {p.min_price ? ` · mínimo ${formatMoney(p.min_price as number, a.currency ?? "PYG")}` : ""}
      </p>
    );
  }
  if (a.kind === "tasacion") {
    return (
      <p className="num mt-1 text-[12px] text-faint">
        Mercado estimado {formatMoney(p.market_value_estimate as number, a.currency ?? "PYG")} ({String(p.market_value_source ?? "")}) · reventa esperada {formatMoney(p.expected_resale_price as number, a.currency ?? "PYG")} · reparaciones {formatMoney(p.estimated_repair_costs as number, a.currency ?? "PYG")}
      </p>
    );
  }
  if (a.kind === "refinanciacion") {
    const plan = (p.plan ?? {}) as Record<string, unknown>;
    return <p className="num mt-1 text-[12px] text-faint">Saldo {formatMoney(p.outstanding_at_request as number, a.currency ?? "PYG")} · {String(plan.term_months)} meses · {formatNumber(Number(plan.rate_input), 2)} % · intereses {formatMoney(plan.total_interest as number, a.currency ?? "PYG")}</p>;
  }
  if (a.kind === "recargo" || a.kind === "nota_credito") {
    return <p className="mt-1 text-[12px] text-faint">{String(p.description ?? "")}{p.due_date ? ` · vence ${String(p.due_date)}` : ""}</p>;
  }
  return null;
}
