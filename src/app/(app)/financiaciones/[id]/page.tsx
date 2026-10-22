import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CheckCircle2, AlertTriangle, MessageCircle } from "lucide-react";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, KindTag, StatusPill } from "@/components/ui/status";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Table, TableWrap, Td, TFootRow, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/components/ui/cn";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { AdjustmentDialog, CollectionActionDialog, PaymentRowActions, RefinanceDialog, RegisterPaymentDialog } from "@/components/finance/payment-actions";
import { agingSeverity } from "@/domain/collections/aging";
import { earlyPayoffQuote } from "@/domain/financing/payoff";
import { AMORTIZATION_LABELS } from "@/domain/financing/amortization";
import { RATE_CONVENTION_LABELS, type RateConvention } from "@/domain/financing/rates";
import { formatDate, formatDateTime, formatMoney, formatNumber, whatsappHref } from "@/lib/format";
import { CHANNEL, COLLECTION_RESULT, CONTRACT_STATUS, INSTALLMENT_KIND, INSTALLMENT_STATE, LEDGER_KIND, PAYMENT_METHOD, PAYMENT_STATUS, PROMISE_STATUS, APPROVAL_KIND } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getToday, listCashAccounts } from "@/server/queries/common";
import {
  contractAllocations, contractConsistency, contractInstallments, contractLedger, contractPayments, contractPendingApprovals, contractVersions, getContract,
} from "@/server/queries/contracts";

export const metadata: Metadata = { title: "Contrato" };

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("contracts.view", "collections.view");
  const { id } = await params;
  const sp = await searchParams;
  const tab = param(sp, "tab") ?? "cuotas";
  const c = await getContract(ctx, id);
  if (!c) notFound();
  const cur = c.currency;
  const [installments, consistency, today, pending] = await Promise.all([
    contractInstallments(ctx, id), contractConsistency(ctx, id), getToday(ctx), contractPendingApprovals(ctx, id),
  ]);
  const canRegister = ctx.perms.has("payments.register") && c.status !== "anulado";
  const accounts = canRegister ? await listCashAccounts(ctx) : [];
  const sev = agingSeverity(c.max_days_overdue);
  const vigentes = installments.filter((i) => i.status === "vigente");
  const payoff = earlyPayoffQuote(vigentes.map((i) => ({ dueDate: i.due_date, principal: Number(i.principal), interest: Number(i.interest), fee: Number(i.fee), outstanding: Number(i.outstanding) })), today, cur);
  const wa = whatsappHref(c.customer_phone);
  const href = (t: string) => `/financiaciones/${id}?tab=${t}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Financiaciones", href: "/financiaciones" }, { label: c.number }]}
        title={<span className="num">{c.number}</span>}
        description={<>
          <Link href={`/clientes/${c.customer_id}`} className="text-ink-2 hover:text-ink">{c.customer}</Link> · <Link href={`/inventario/${c.vehicle_id}`} className="text-ink-2 hover:text-ink">{c.vehicle}</Link>
          {" · "}Venta <Link href={`/ventas/${c.deal_id}`} className="num text-ink-2 hover:text-ink">{c.deal_number}</Link> · Firmado el {formatDate(c.signed_on)}
        </>}
        meta={<>
          <CatalogPill catalog={CONTRACT_STATUS} value={c.status} />
          {c.max_days_overdue > 0 ? <StatusPill tone={sev === "low" ? "warning" : "critical"}>En mora · {c.bucket} · {c.max_days_overdue} días</StatusPill> : c.status === "vigente" ? <StatusPill tone="positive">Al día</StatusPill> : null}
          <StatusPill tone="neutral">Versión {c.current_version}</StatusPill>
          {c.collector ? <StatusPill tone="neutral">Cobranza: {c.collector}</StatusPill> : null}
          {consistency ? (consistency.consistent
            ? <span className="inline-flex items-center gap-1 text-[12px] text-positive"><CheckCircle2 className="size-3.5" aria-hidden /> Saldos verificados</span>
            : <span className="inline-flex items-center gap-1 text-[12px] text-critical"><AlertTriangle className="size-3.5" aria-hidden /> Diferencia entre cuenta corriente y cuotas</span>) : null}
        </>}
        actions={<>
          {wa ? <a href={wa} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink-2 hover:bg-elevated"><MessageCircle className="size-4" aria-hidden /> WhatsApp</a> : null}
          {ctx.perms.has("collections.manage") ? <CollectionActionDialog customerId={c.customer_id} contractId={id} currency={cur} today={today} /> : null}
          {ctx.perms.has("contracts.adjust") && c.status !== "anulado" ? <AdjustmentDialog contractId={id} currency={cur} today={today} /> : null}
          {ctx.perms.has("contracts.adjust") && c.status === "vigente" && Number(c.outstanding) > 0 ? <RefinanceDialog contractId={id} currency={cur} outstanding={Number(c.outstanding)} today={today} /> : null}
          {canRegister ? <RegisterPaymentDialog customerId={c.customer_id} contractId={id} contractCurrency={cur} accounts={accounts} today={today} canConfirm={ctx.perms.has("payments.confirm")} /> : null}
        </>}
      />

      {pending.length ? (
        <div className="mb-5"><Notice tone="warning">
          Solicitudes pendientes de aprobación: {pending.map((p) => `${APPROVAL_KIND[p.kind]}${p.amount ? ` por ${formatMoney(p.amount, p.currency ?? cur)}` : ""}`).join(" · ")}. No afectan el saldo hasta ser aprobadas.
        </Notice></div>
      ) : null}

      <StatGrid className="mb-6 xl:grid-cols-5">
        <Stat id="c-total" label="Obligación total" value={<Money value={c.total_due} currency={cur} compact />} sub={`Incluye intereses: ${formatMoney(c.total_interest, cur)}`}
          definition={{ formula: "Suma de cuotas, entregas y recargos vigentes (menos lo dado de baja por refinanciación o anulación).", source: "Cuotas del contrato." }} />
        <Stat id="c-paid" label="Cobrado" value={<Money value={c.cash_collected} currency={cur} compact />} sub={`Último pago: ${formatDate(c.last_payment_on)}`}
          definition={{ formula: "Pagos CONFIRMADOS en efectivo, transferencia, depósito, cheque o tarjeta, en moneda del contrato. No incluye usado ni notas de crédito.", source: "Pagos de clientes." }} />
        <Stat id="c-out" label="Saldo pendiente" value={<Money value={c.outstanding} currency={cur} compact />} sub={Number(c.unapplied_credit) > 0 ? `Saldo a favor: ${formatMoney(c.unapplied_credit, cur)}` : undefined}
          definition={{ formula: "Σ (importe de cuota − cancelado − aplicaciones de pagos confirmados).", source: "Cuotas y aplicaciones." }} />
        <Stat id="c-over" label="Vencido" value={<Money value={c.overdue_amount} currency={cur} compact />} tone={Number(c.overdue_amount) > 0 ? "critical" : "neutral"}
          sub={c.overdue_installments ? `${c.overdue_installments} cuota(s) · ${c.max_days_overdue} días` : "Sin atraso"}
          definition={{ formula: "Saldo de las cuotas con vencimiento anterior a hoy. Días de atraso = hoy − vencimiento de la cuota impaga más antigua.", source: "Cuotas y aplicaciones." }} />
        <Stat id="c-next" label="Próximo vencimiento" value={c.next_due_date ? formatDate(c.next_due_date) : "—"} sub={c.next_due_amount ? formatMoney(c.next_due_amount, cur) : undefined}
          definition={{ formula: "Primera cuota con saldo que aún no venció.", source: "Cuotas." }} />
      </StatGrid>

      <Tabs active={tab} items={[
        { key: "cuotas", label: "Cuotas", href: href("cuotas"), count: installments.length },
        { key: "cuenta", label: "Estado de cuenta", href: href("cuenta") },
        ...(ctx.perms.has("payments.view") ? [{ key: "pagos", label: "Pagos", href: href("pagos") }] : []),
        { key: "gestiones", label: "Gestiones", href: href("gestiones") },
        { key: "plan", label: "Plan y versiones", href: href("plan") },
        { key: "documentos", label: "Documentos", href: href("documentos") },
      ]} />

      {tab === "cuotas" ? <InstallmentsTab ctx={ctx} id={id} cur={cur} installments={installments} /> : null}
      {tab === "cuenta" ? <LedgerTab ctx={ctx} id={id} cur={cur} /> : null}
      {tab === "pagos" ? <PaymentsTab ctx={ctx} id={id} cur={cur} /> : null}
      {tab === "gestiones" ? <ActionsTab ctx={ctx} id={id} /> : null}
      {tab === "plan" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <PlanTab ctx={ctx} id={id} cur={cur} />
          <Panel title="Cancelación anticipada" description="Cotización al día de hoy.">
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between text-ink-2"><dt>Saldo vencido (capital, interés y recargos)</dt><dd className="num">{formatMoney(payoff.overdueAmount, cur)}</dd></div>
              <div className="flex justify-between text-ink-2"><dt>Capital de cuotas no vencidas</dt><dd className="num">{formatMoney(payoff.futurePrincipal, cur)}</dd></div>
              <div className="flex justify-between font-semibold text-ink"><dt>Importe de cancelación</dt><dd className="num">{formatMoney(payoff.payoffAmount, cur)}</dd></div>
              <div className="flex justify-between text-ink-2"><dt className="flex items-center gap-1.5">Intereses futuros a bonificar <KindTag kind="proyectado" /></dt><dd className="num">{formatMoney(payoff.waivedInterest, cur)}</dd></div>
            </dl>
            <p className="mt-3 text-[12px] text-faint">Para cancelar: registre el pago por el importe de cancelación y solicite una nota de crédito por los intereses a bonificar (requiere aprobación).</p>
          </Panel>
        </div>
      ) : null}
      {tab === "documentos" ? <DocsTab ctx={ctx} id={id} /> : null}
    </>
  );
}

type Ctx = AppContext;

async function InstallmentsTab({ ctx, id, cur, installments }: { ctx: Ctx; id: string; cur: string; installments: Awaited<ReturnType<typeof contractInstallments>>[number][] }) {
  const allocations = await contractAllocations(ctx, id);
  const byInst = new Map<string, Array<(typeof allocations)[number]>>();
  for (const a of allocations) byInst.set(a.installment_id, [...(byInst.get(a.installment_id) ?? []), a]);
  const total = (k: "amount" | "amount_applied" | "outstanding") => installments.filter((i) => i.status === "vigente" || k !== "outstanding").reduce((s, i) => s + Number(i[k]), 0);
  return (
    <TableWrap>
      <Table>
        <THead><Th>N.º</Th><Th>Concepto</Th><Th>Vence</Th><Th numeric>Capital</Th><Th numeric>Interés</Th><Th numeric className="hidden lg:table-cell">Recargo</Th><Th numeric>Importe</Th><Th numeric>Aplicado</Th><Th numeric>Saldo</Th><Th>Estado</Th><Th className="hidden xl:table-cell">Pagos aplicados</Th></THead>
        <tbody>
          {installments.map((i) => {
            const late = i.days_overdue > 0;
            return (
              <Tr key={i.id} className={cn(i.status === "reemplazada" && "opacity-55")}>
                <Td className="num" muted>{i.seq}</Td>
                <Td>{i.description ?? INSTALLMENT_KIND[i.kind]}</Td>
                <Td className="num whitespace-nowrap">{formatDate(i.due_date)}{late ? <span className="block text-[11.5px] text-critical">{i.days_overdue} días de atraso</span> : null}</Td>
                <Td numeric><Money value={i.principal} currency={cur} /></Td>
                <Td numeric muted><Money value={i.interest} currency={cur} /></Td>
                <Td numeric className="hidden lg:table-cell">{Number(i.fee) ? <Money value={i.fee} currency={cur} /> : <span className="text-faint">—</span>}</Td>
                <Td numeric><Money value={i.amount} currency={cur} /></Td>
                <Td numeric><Money value={i.amount_applied} currency={cur} tone="muted" /></Td>
                <Td numeric><Money value={i.outstanding} currency={cur} tone={late ? "critical" : undefined} /></Td>
                <Td>{late ? <StatusPill tone="critical">Vencida</StatusPill> : <CatalogPill catalog={INSTALLMENT_STATE} value={i.payment_state} />}</Td>
                <Td className="hidden max-w-56 truncate text-[12px] xl:table-cell" muted>
                  {(byInst.get(i.id) ?? []).map((a) => `${a.payment_number}${a.reversal ? " (rev.)" : ""} ${formatMoney(a.amount, cur)}`).join(" · ") || "—"}
                </Td>
              </Tr>
            );
          })}
        </tbody>
        <TFootRow>
          <Td colSpan={6}>Totales</Td>
          <Td numeric><Money value={total("amount")} currency={cur} /></Td>
          <Td numeric><Money value={total("amount_applied")} currency={cur} /></Td>
          <Td numeric><Money value={total("outstanding")} currency={cur} /></Td>
          <Td colSpan={2} />
        </TFootRow>
      </Table>
    </TableWrap>
  );
}

async function LedgerTab({ ctx, id, cur }: { ctx: Ctx; id: string; cur: string }) {
  const rows = await contractLedger(ctx, id);
  return (
    <Panel title="Estado de cuenta" description="Cada movimiento es inmutable. Las correcciones se registran como reversiones o bajas, nunca editando saldos." bodyClassName="p-0">
      {rows.length === 0 ? <EmptyState title="Sin movimientos" /> : (
        <TableWrap className="rounded-none border-0">
          <Table>
            <THead><Th>Fecha</Th><Th>Movimiento</Th><Th>Detalle</Th><Th numeric>Debe</Th><Th numeric>Haber</Th><Th numeric>Saldo</Th><Th className="hidden lg:table-cell">Usuario</Th></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}>
                  <Td className="num whitespace-nowrap">{formatDate(r.entry_date)}</Td>
                  <Td>{LEDGER_KIND[r.kind] ?? r.kind}</Td>
                  <Td className="max-w-80 truncate" muted>{r.description}</Td>
                  <Td numeric>{Number(r.debit) ? <Money value={r.debit} currency={cur} /> : ""}</Td>
                  <Td numeric>{Number(r.credit) ? <Money value={r.credit} currency={cur} /> : ""}</Td>
                  <Td numeric><Money value={r.balance} currency={cur} className="text-ink" /></Td>
                  <Td className="hidden lg:table-cell" muted>{r.created_by ?? "Sistema"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}

async function PaymentsTab({ ctx, id, cur }: { ctx: Ctx; id: string; cur: string }) {
  const rows = await contractPayments(ctx, id);
  return (
    <Panel title="Pagos del contrato" description="Registrado = informado, sin efecto. Confirmado = cobro aplicado. Revertido = anulado con trazabilidad." bodyClassName="p-0">
      {rows.length === 0 ? <EmptyState title="Sin pagos" /> : (
        <TableWrap className="rounded-none border-0">
          <Table>
            <THead><Th>N.º</Th><Th>Fecha</Th><Th>Medio</Th><Th className="hidden lg:table-cell">Cuenta / referencia</Th><Th numeric>Importe</Th><Th numeric>{`En ${cur}`}</Th><Th numeric>Aplicado</Th><Th>Estado</Th><Th /></THead>
            <tbody>
              {rows.map((p) => (
                <Tr key={p.id}>
                  <Td className="num whitespace-nowrap">{p.number}</Td>
                  <Td className="num whitespace-nowrap">{formatDate(p.received_on)}</Td>
                  <Td>{PAYMENT_METHOD[p.method] ?? p.method}</Td>
                  <Td className="hidden lg:table-cell" muted>{[p.account, p.reference].filter(Boolean).join(" · ") || "—"}</Td>
                  <Td numeric><Money value={p.amount} currency={p.currency} /></Td>
                  <Td numeric>{p.currency !== cur && p.amount_contract ? <span title={`Tipo de cambio ${formatNumber(Number(p.fx_rate_to_contract), 6)}`}><Money value={p.amount_contract} currency={cur} /></span> : <span className="text-faint">—</span>}</Td>
                  <Td numeric><Money value={p.applied} currency={cur} tone="muted" /></Td>
                  <Td>
                    <CatalogPill catalog={PAYMENT_STATUS} value={p.status} />
                    {p.reversal_reason ? <span className="block max-w-48 truncate text-[11.5px] text-faint" title={p.reversal_reason}>{p.reversal_reason}</span> : null}
                    {p.confirmed_by ? <span className="block text-[11.5px] text-faint">por {p.confirmed_by}</span> : null}
                  </Td>
                  <Td>
                    <PaymentRowActions paymentId={p.id} contractId={id} status={p.status}
                      canConfirm={ctx.perms.has("payments.confirm")} canVoid={ctx.perms.has("payments.register")} canReverse={ctx.perms.has("payments.reverse") && !["trade_in", "nota_credito"].includes(p.method)} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Panel>
  );
}

async function ActionsTab({ ctx, id }: { ctx: Ctx; id: string }) {
  const rows = await ctx.db((tx) => tx<{ id: string; channel: string; result: string; notes: string | null; occurred_at: Date; user_name: string; promise_amount: string | null; promise_currency: string | null; promise_date: string | null; promise_status: string | null; next_action: string | null; next_action_at: string | null }[]>`
    select a.id, a.channel, a.result, a.notes, a.occurred_at, u.full_name as user_name, a.promise_amount, a.promise_currency, a.promise_date::text,
           p.promise_status, a.next_action, a.next_action_at::text
    from public.collection_actions a join public.user_profiles u on u.id = a.user_id
    left join public.v_payment_promises p on p.id = a.id
    where a.contract_id = ${id} order by a.occurred_at desc`);
  return (
    <Panel title="Gestiones de cobranza" bodyClassName="p-0">
      {rows.length === 0 ? <EmptyState title="Sin gestiones" /> : (
        <ol className="divide-y divide-line-soft">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3 text-[13px]">
              <p className="text-ink-2">{CHANNEL[r.channel]} · <span className="text-ink">{COLLECTION_RESULT[r.result]}</span> <span className="text-faint">· {r.user_name} · {formatDateTime(r.occurred_at)}</span></p>
              {r.notes ? <p className="mt-1 text-ink">{r.notes}</p> : null}
              {r.promise_amount ? (
                <p className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
                  Promesa: {formatMoney(r.promise_amount, r.promise_currency ?? "PYG")} al {formatDate(r.promise_date)}
                  <CatalogPill catalog={PROMISE_STATUS} value={r.promise_status} />
                </p>
              ) : null}
              {r.next_action_at ? <p className="mt-1 text-[12.5px] text-faint">Próxima acción: {r.next_action ?? "—"} · {formatDate(r.next_action_at)}</p> : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

async function PlanTab({ ctx, id, cur }: { ctx: Ctx; id: string; cur: string }) {
  const versions = await contractVersions(ctx, id);
  return (
    <Panel title="Versiones del contrato" bodyClassName="p-0">
      <ul className="divide-y divide-line-soft">
        {versions.map((v) => (
          <li key={v.version_no} className="px-4 py-3 text-[13px]">
            <p className="flex items-center justify-between"><span className="font-medium text-ink">Versión {v.version_no}</span><span className="text-faint">{formatDateTime(v.created_at)} · {v.created_by ?? "—"}</span></p>
            <p className="mt-0.5 text-muted">{v.reason}</p>
            {v.method && v.method !== "sin_financiacion" ? (
              <p className="num mt-1 text-[12.5px] text-ink-2">
                {AMORTIZATION_LABELS[v.method as "frances" | "aleman"]} · {formatMoney(v.principal, cur)} · {v.term_months} meses · {formatNumber(Number(v.rate_input), 2)} % {RATE_CONVENTION_LABELS[v.rate_convention as RateConvention]} · intereses {formatMoney(v.total_interest, cur)}
              </p>
            ) : <p className="mt-1 text-[12.5px] text-faint">Sin financiación</p>}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

async function DocsTab({ ctx, id }: { ctx: Ctx; id: string }) {
  const docs = await ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by
    where d.entity_type = 'contract' and d.entity_id = ${id} order by d.uploaded_at desc`);
  return <DocumentsPanel documents={docs} entityType="contract" entityId={id} canUpload={ctx.perms.any("deals.formalize", "contracts.adjust")} allowRestricted={ctx.perms.has("documents.view_restricted")} />;
}
