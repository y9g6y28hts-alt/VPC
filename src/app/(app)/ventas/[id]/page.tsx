import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ExternalLink, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, KindTag, StatusPill } from "@/components/ui/status";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { CancelDealButton, DeliverDialog, FormalizeDialog, ReopenDealButton, SubmitDealButton } from "@/components/sales/deal-actions";
import { buildDealSchedule } from "@/domain/financing/deal-schedule";
import { AMORTIZATION_LABELS } from "@/domain/financing/amortization";
import { RATE_CONVENTION_LABELS } from "@/domain/financing/rates";
import { operationMargin } from "@/domain/sales/margin";
import { convert } from "@/domain/money";
import { formatDate, formatDateTime, formatMoney, formatNumber, vehicleName } from "@/lib/format";
import { APPROVAL_KIND, APPROVAL_STATUS, DEAL_STATUS } from "@/lib/labels";
import { requirePerm } from "@/server/auth/context";
import { getToday, latestRate, listMembers } from "@/server/queries/common";
import { dealApprovals, dealEvents, getDeal, vehicleCostLines } from "@/server/queries/sales";

export const metadata: Metadata = { title: "Operación de venta" };

const EVENT_LABELS: Record<string, string> = {
  creada: "Operación creada",
  condiciones_modificadas: "Condiciones modificadas",
  financiacion_modificada: "Financiación modificada",
  estado: "Cambio de estado",
};

export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("deals.view", "deals.view_all");
  const { id } = await params;
  const d = await getDeal(ctx, id);
  if (!d) notFound();
  const [events, approvals, today] = await Promise.all([dealEvents(ctx, id), dealApprovals(ctx, id), getToday(ctx)]);
  const canCosts = ctx.perms.has("inventory.costs.view");
  const base = ctx.org.baseCurrency;
  const cur = d.currency;

  let schedule = null;
  try {
    schedule = buildDealSchedule({
      currency: cur,
      listPrice: Number(d.list_price),
      discount: Number(d.discount_amount),
      tradeInValue: Number(d.trade_in_value),
      downPayment: Number(d.down_payment),
      operationDate: today,
      financing: d.payment_type === "financiado" ? d.financing_terms : null,
    });
  } catch {
    schedule = null;
  }

  let margin = null;
  let salePriceBase: number | null = null;
  let rateNote: string | null = null;
  if (canCosts) {
    const costs = await vehicleCostLines(ctx, d.vehicle_id);
    const rate = d.fx_rate_to_base ? Number(d.fx_rate_to_base) : (await latestRate(ctx, cur, base))?.rate ?? null;
    if (rate) {
      salePriceBase = convert(Number(d.sale_price), rate, base);
      margin = operationMargin(salePriceBase, costs.map((c) => ({ amountBase: Number(c.amount_base), isEstimate: c.is_estimate })), base, d.status === "entregada");
      if (cur !== base) rateNote = d.fx_rate_to_base ? `Tipo de cambio fijado al formalizar: ${formatNumber(rate, 2)}` : `Tipo de cambio vigente: ${formatNumber(rate, 2)} (referencial)`;
    } else {
      rateNote = `Falta el tipo de cambio ${cur}→${base} para calcular el margen.`;
    }
  }

  let collection = null;
  if (d.contract_id && ctx.perms.any("contracts.view", "collections.view")) {
    const [b] = await ctx.db((tx) => tx<{ cash_collected: string; outstanding: string; overdue_amount: string; total_due: string; total_interest: string }[]>`
      select cash_collected, outstanding, overdue_amount, total_due, total_interest from public.v_contract_balances where contract_id = ${d.contract_id!}`);
    collection = b ?? null;
  }

  const isOwner = d.seller_id === ctx.userId || ctx.perms.has("deals.view_all");
  const canCreate = ctx.perms.has("deals.create") && isOwner;
  const collectors = d.status === "aprobada" && ctx.perms.has("deals.formalize") ? await listMembers(ctx, ["cobranzas", "administracion", "finanzas", "director"]) : [];
  const docs = await ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by
    where d.entity_type = 'deal' and d.entity_id = ${id} order by d.uploaded_at desc`);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Ventas", href: "/ventas" }, { label: d.number }]}
        title={<span className="num">{d.number}</span>}
        description={<>
          <Link href={`/clientes/${d.customer_id}`} className="text-ink-2 hover:text-ink">{d.customer}</Link>{" · "}
          <Link href={`/inventario/${d.vehicle_id}`} className="text-ink-2 hover:text-ink">{vehicleName(d.brand, d.model)} {d.vehicle_version ?? ""} {d.vehicle_year}</Link>
          <span className="num text-faint"> · {d.stock_code}</span>
        </>}
        meta={<>
          <CatalogPill catalog={DEAL_STATUS} value={d.status} />
          <StatusPill tone="neutral">{d.payment_type === "contado" ? "Contado" : "Financiado"}</StatusPill>
          <StatusPill tone="neutral">Vendedor: {d.seller}</StatusPill>
        </>}
        actions={<>
          {d.status === "borrador" && canCreate ? <ButtonLink href={`/ventas/${id}/editar`}><Pencil aria-hidden /> Editar</ButtonLink> : null}
          {d.status === "borrador" && canCreate ? <SubmitDealButton dealId={id} /> : null}
          {["pendiente_aprobacion", "aprobada"].includes(d.status) && canCreate ? <ReopenDealButton dealId={id} /> : null}
          {["borrador", "pendiente_aprobacion", "aprobada"].includes(d.status) && (canCreate || ctx.perms.has("deals.cancel")) ? <CancelDealButton dealId={id} formalized={false} /> : null}
          {d.status === "formalizada" && ctx.perms.has("deals.cancel") ? <CancelDealButton dealId={id} formalized /> : null}
          {d.status === "aprobada" && ctx.perms.has("deals.formalize") ? (
            <FormalizeDialog dealId={id} today={today} firstDueDate={d.financing_terms?.firstDueDate ?? null} financed={d.payment_type === "financiado"}
              collectors={collectors} reservedForOther={false} />
          ) : null}
          {d.status === "formalizada" && ctx.perms.has("deals.deliver") ? <DeliverDialog dealId={id} today={today} /> : null}
          {d.contract_id && ctx.perms.any("contracts.view", "collections.view") ? <ButtonLink href={`/financiaciones/${d.contract_id}`}><ExternalLink aria-hidden /> Contrato {d.contract_number}</ButtonLink> : null}
        </>}
      />

      {d.status === "pendiente_aprobacion" ? <div className="mb-5"><Notice tone="warning">Pendiente de aprobación: {d.approval_reason}. La decide gerencia comercial o dirección desde Aprobaciones.</Notice></div> : null}
      {d.status === "anulada" ? <div className="mb-5"><Notice tone="critical">Anulada el {formatDateTime(d.cancelled_at)}: {d.cancel_reason}</Notice></div> : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.25fr_1fr]">
        <div className="space-y-5">
          <Panel title="Condiciones comerciales" description={`Importes en ${cur}.`}>
            <dl className="space-y-2 text-[13.5px]">
              <Line label="Precio de lista" value={formatMoney(d.list_price, cur)} />
              <Line label="Descuento" value={Number(d.discount_amount) ? `− ${formatMoney(d.discount_amount, cur)} (${formatNumber((Number(d.discount_amount) * 100) / Number(d.list_price), 2)} %)` : "—"} />
              <Line label="Precio de venta" value={formatMoney(d.sale_price, cur)} strong />
              <Line label="Vehículo usado (trade-in)" value={Number(d.trade_in_value) ? <span>− {formatMoney(d.trade_in_value, cur)} <span className="text-faint">· {d.appraisal_number} {d.appraisal_label}</span></span> : "—"} />
              <Line label={d.payment_type === "contado" ? "Pago de contado" : "Entrega inicial"} value={`− ${formatMoney(d.down_payment, cur)}`} />
              {schedule ? <Line label="Saldo a financiar" value={formatMoney(schedule.financedAmount, cur)} strong /> : null}
            </dl>
            {d.notes ? <p className="mt-4 whitespace-pre-line border-t border-line-soft pt-3 text-[13px] text-ink-2">{d.notes}</p> : null}
          </Panel>

          {d.payment_type === "financiado" && d.financing_terms ? (
            <Panel title="Financiación propuesta" description={d.contract_id ? "El plan vigente está en el contrato." : "Al formalizar se recalcula con la fecha de firma."}>
              <DescriptionList cols={3} items={[
                { label: "Sistema", value: AMORTIZATION_LABELS[d.financing_terms.method] },
                { label: "Tasa", value: `${formatNumber(d.financing_terms.ratePercent, 2)} % ${RATE_CONVENTION_LABELS[d.financing_terms.rateConvention]}` },
                { label: "Plazo", value: `${d.financing_terms.termMonths} meses` },
                { label: "Primer vencimiento", value: formatDate(d.financing_terms.firstDueDate) },
                { label: "Refuerzos", value: d.financing_terms.balloons?.length ? `${d.financing_terms.balloons.length} (${formatMoney(d.financing_terms.balloons.reduce((a, b) => a + b.amount, 0), cur)})` : "—" },
                { label: "Cuota regular", value: schedule?.regularPayment ? formatMoney(schedule.regularPayment, cur) : "—" },
                { label: "Intereses totales", value: schedule ? formatMoney(schedule.totalInterest, cur) : "—" },
                { label: "Total a pagar", value: schedule ? formatMoney(schedule.totalPayable, cur) : "—" },
              ]} />
            </Panel>
          ) : null}

          {canCosts ? (
            <Panel title="Rentabilidad de la operación" description={`En ${base}. ${rateNote ?? ""}`}>
              {margin ? (
                <dl className="space-y-2 text-[13.5px]">
                  <Line label="Precio de venta" value={formatMoney(salePriceBase, base)} />
                  <Line label="Costes registrados" value={`− ${formatMoney(margin.registeredCosts, base)}`} />
                  <Line label={<span className="flex items-center gap-1.5">Gastos pendientes <KindTag kind="estimado" /></span>} value={`− ${formatMoney(margin.pendingCosts, base)}`} />
                  <Line label={<span className="flex items-center gap-1.5">Margen estimado <KindTag kind="estimado" /></span>} value={<span className={margin.estimatedMargin < 0 ? "text-critical" : undefined}>{formatMoney(margin.estimatedMargin, base)}{margin.estimatedMarginPct !== null ? ` (${formatNumber(margin.estimatedMarginPct, 1)} %)` : ""}</span>} strong />
                  <Line label="Margen bruto realizado" value={margin.realizedMargin !== null ? formatMoney(margin.realizedMargin, base) : <span className="text-faint">{d.status === "entregada" ? "Pendiente: hay costes estimados" : "Se determina al entregar"}</span>} strong />
                  {schedule && schedule.totalInterest > 0 ? (
                    <Line label={<span className="flex items-center gap-1.5">Ingreso financiero <KindTag kind="proyectado" /></span>} value={formatMoney(schedule.totalInterest, cur)} />
                  ) : null}
                </dl>
              ) : <p className="text-sm text-warning">{rateNote}</p>}
              <p className="mt-3 text-[12px] text-faint">El margen no incluye intereses de financiación. Facturación, cobros y beneficio se informan por separado.</p>
            </Panel>
          ) : null}

          {collection ? (
            <Panel title="Cobro" description={`Desde el contrato ${d.contract_number}. Sólo pagos confirmados.`}>
              <dl className="space-y-2 text-[13.5px]">
                <Line label="Obligación total (con intereses)" value={formatMoney(collection.total_due, cur)} />
                <Line label="Cobrado en efectivo y transferencias" value={formatMoney(collection.cash_collected, cur)} />
                <Line label="Saldo por cobrar" value={formatMoney(collection.outstanding, cur)} strong />
                <Line label="Vencido" value={<span className={Number(collection.overdue_amount) > 0 ? "text-critical" : undefined}>{formatMoney(collection.overdue_amount, cur)}</span>} />
              </dl>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-5">
          <Panel title="Aprobaciones" bodyClassName="p-0">
            {approvals.length === 0 ? <EmptyState title="Sin solicitudes" description="Dentro de los límites autorizados no requiere aprobación." /> : (
              <ul className="divide-y divide-line-soft">
                {approvals.map((a) => (
                  <li key={a.id} className="px-4 py-3 text-[13px]">
                    <div className="flex items-center justify-between gap-2"><span className="text-ink">{APPROVAL_KIND[a.kind]}</span><CatalogPill catalog={APPROVAL_STATUS} value={a.status} /></div>
                    <p className="mt-1 text-faint">{a.reason}</p>
                    <p className="mt-1 text-[12px] text-faint">Pedida por {a.requested_by} · {formatDateTime(a.requested_at)}</p>
                    {a.decided_at ? <p className="text-[12px] text-faint">Resuelta por {a.decided_by} · {formatDateTime(a.decided_at)}{a.decision_note ? ` · «${a.decision_note}»` : ""}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Historial de la operación" bodyClassName="p-0">
            <ol className="divide-y divide-line-soft">
              {events.map((e) => (
                <li key={e.id} className="px-4 py-2.5 text-[13px]">
                  <p className="text-ink-2">{EVENT_LABELS[e.event] ?? e.event}
                    {e.event === "estado" ? <span className="text-faint"> · {DEAL_STATUS[String(e.details.de)]?.label} → <span className="text-ink">{DEAL_STATUS[String(e.details.a)]?.label}</span></span> : null}
                    {e.event === "condiciones_modificadas" ? <span className="text-faint"> · descuento {formatMoney(Number((e.details.antes as Record<string, number>)?.discount_amount), cur)} → {formatMoney(Number((e.details.despues as Record<string, number>)?.discount_amount), cur)}</span> : null}
                  </p>
                  <p className="text-[12px] text-faint">{e.actor ?? "Sistema"} · {formatDateTime(e.occurred_at)}</p>
                </li>
              ))}
            </ol>
          </Panel>
          <DocumentsPanel documents={docs} entityType="deal" entityId={id} canUpload={ctx.perms.any("deals.create", "deals.formalize")} allowRestricted={ctx.perms.has("documents.view_restricted")} />
        </div>
      </div>
    </>
  );
}

function Line({ label, value, strong }: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-start justify-between gap-4 ${strong ? "font-semibold text-ink" : "text-ink-2"}`}>
      <dt>{label}</dt>
      <dd className="num text-right">{value}</dd>
    </div>
  );
}
