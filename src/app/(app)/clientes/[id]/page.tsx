import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Handshake, MessageCircle, Pencil } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { AssignCollectorDialog, InteractionDialog, OpportunityDialog } from "@/components/customers/customer-actions";
import { agingBucket, agingSeverity } from "@/domain/collections/aging";
import { formatDate, formatDateTime, formatMoney, whatsappHref } from "@/lib/format";
import { CHANNEL, COLLECTION_RESULT, CONTRACT_STATUS, DEAL_STATUS, DOC_TYPE, PAYMENT_METHOD, PAYMENT_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { listMembers } from "@/server/queries/common";
import {
  customerContracts, customerDeals, customerDocuments, customerInteractions, customerOpportunities, customerPayments, getCustomer, pipelineStages,
} from "@/server/queries/customers";
import { sellableVehicles } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Cliente" };

export default async function CustomerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("customers.view", "customers.view_all");
  const { id } = await params;
  const sp = await searchParams;
  const tab = param(sp, "tab") ?? "resumen";
  const c = await getCustomer(ctx, id);
  if (!c) notFound();

  const canAccount = ctx.perms.any("contracts.view", "collections.view");
  const canPayments = ctx.perms.has("payments.view");
  const [deals, contracts, opportunities] = await Promise.all([
    customerDeals(ctx, id),
    canAccount ? customerContracts(ctx, id) : Promise.resolve([]),
    customerOpportunities(ctx, id),
  ]);
  const crm = ctx.perms.has("crm.manage");
  const [stages, vehicles] = crm ? await Promise.all([pipelineStages(ctx), sellableVehicles(ctx)]) : [[], []];
  const collectors = ctx.perms.has("collections.assign") ? await listMembers(ctx, ["cobranzas", "administracion", "finanzas", "director"]) : [];
  const wa = whatsappHref(c.phone);
  const overdue = contracts.filter((k) => Number(k.overdue_amount) > 0);
  const maxDays = Math.max(0, ...contracts.map((k) => k.max_days_overdue));
  const href = (t: string) => `/clientes/${id}?tab=${t}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: c.full_name }]}
        title={c.full_name}
        description={`${DOC_TYPE[c.doc_type]} ${c.doc_number}${c.city ? ` · ${c.city}` : ""} · Cliente desde ${formatDate(c.created_at)}`}
        meta={
          <>
            {c.seller ? <StatusPill tone="neutral">Vendedor: {c.seller}</StatusPill> : <StatusPill tone="warning">Sin vendedor asignado</StatusPill>}
            {c.collector ? <StatusPill tone="neutral">Cobranza: {c.collector}</StatusPill> : null}
            {canAccount && contracts.length ? (
              overdue.length ? <StatusPill tone={agingSeverity(maxDays) === "low" ? "warning" : "critical"}>En mora · {agingBucket(maxDays).label}</StatusPill>
                : <StatusPill tone="positive">Al día</StatusPill>
            ) : null}
          </>
        }
        actions={
          <>
            {wa ? <a href={wa} target="_blank" rel="noopener" className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-ink-2 hover:bg-elevated"><MessageCircle className="size-4" aria-hidden /> WhatsApp</a> : null}
            {collectors.length ? <AssignCollectorDialog customerId={id} current={c.collector_id} collectors={collectors} /> : null}
            {crm || ctx.perms.has("collections.manage") ? <InteractionDialog customerId={id} /> : null}
            {ctx.perms.has("customers.edit") ? <ButtonLink href={`/clientes/${id}/editar`}><Pencil aria-hidden /> Editar</ButtonLink> : null}
            {ctx.perms.has("deals.create") ? <ButtonLink href={`/ventas/nueva?cliente=${id}`} variant="primary"><Handshake aria-hidden /> Nueva venta</ButtonLink> : null}
          </>
        }
      />
      <Tabs active={tab} items={[
        { key: "resumen", label: "Resumen", href: href("resumen") },
        { key: "operaciones", label: "Operaciones", href: href("operaciones"), count: deals.length + opportunities.length },
        ...(canAccount ? [{ key: "cuenta", label: "Cuenta y pagos", href: href("cuenta"), count: contracts.length }] : []),
        { key: "gestiones", label: "Gestiones", href: href("gestiones") },
        { key: "documentos", label: "Documentos", href: href("documentos") },
      ]} />

      {tab === "resumen" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.2fr]">
          <Panel title="Datos del cliente">
            <DescriptionList items={[
              { label: "Tipo", value: c.kind === "empresa" ? "Empresa" : "Persona física" },
              { label: "Categoría", value: c.customer_type },
              { label: "Teléfono", value: c.phone },
              { label: "Correo", value: c.email },
              { label: "Dirección", value: c.address },
              { label: "Ciudad", value: c.city },
              { label: "Origen", value: c.source },
              { label: "Alta", value: `${formatDate(c.created_at)} · ${c.created_by_name ?? "—"}` },
            ]} />
            {c.notes ? <p className="mt-4 whitespace-pre-line border-t border-line-soft pt-4 text-[13px] text-ink-2">{c.notes}</p> : null}
          </Panel>
          <div className="space-y-5">
            {canAccount ? (
              <Panel title="Situación financiera" description="Saldos calculados desde cuotas y pagos confirmados.">
                {contracts.length === 0 ? <p className="text-sm text-muted">Sin contratos.</p> : (
                  <ul className="divide-y divide-line-soft">
                    {contracts.map((k) => (
                      <li key={k.contract_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                        <div>
                          <Link href={`/financiaciones/${k.contract_id}`} className="num font-medium text-ink hover:underline">{k.number}</Link>
                          <span className="ml-2"><CatalogPill catalog={CONTRACT_STATUS} value={k.status} /></span>
                          <p className="text-[12px] text-faint">Próximo vencimiento: {k.next_due_date ? `${formatDate(k.next_due_date)} · ${formatMoney(k.next_due_amount, k.currency)}` : "—"}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[12px] text-faint">Saldo</p>
                          <Money value={k.outstanding} currency={k.currency} className="font-semibold text-ink" />
                          {Number(k.overdue_amount) > 0 ? <p className="text-[12px] text-critical">Vencido {formatMoney(k.overdue_amount, k.currency)} · {k.max_days_overdue} días</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            ) : null}
            <Panel title="Oportunidades abiertas" actions={crm ? <OpportunityDialog customerId={id} stages={stages} vehicles={vehicles} /> : null}>
              {opportunities.filter((o) => o.status === "abierta").length === 0 ? <p className="text-sm text-muted">Sin oportunidades abiertas.</p> : (
                <ul className="space-y-2">
                  {opportunities.filter((o) => o.status === "abierta").map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 text-[13.5px]">
                      <span className="min-w-0 truncate text-ink-2">{o.title}{o.vehicle ? <span className="text-faint"> · {o.vehicle}</span> : null}</span>
                      <StatusPill tone="info">{o.stage}</StatusPill>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      ) : null}

      {tab === "operaciones" ? (
        <div className="space-y-5">
          <Panel title="Operaciones de venta" bodyClassName="p-0">
            {deals.length === 0 ? <EmptyState title="Sin operaciones" /> : (
              <TableWrap className="rounded-none border-0"><Table>
                <THead><Th>N.º</Th><Th>Unidad</Th><Th>Vendedor</Th><Th>Modalidad</Th><Th>Estado</Th><Th numeric>Precio de venta</Th><Th>Fecha</Th></THead>
                <tbody>
                  {deals.map((d) => (
                    <Tr key={d.id}>
                      <Td><Link href={`/ventas/${d.id}`} className="num text-ink hover:underline">{d.number}</Link></Td>
                      <Td><Link href={`/inventario/${d.vehicle_id}`} className="hover:text-ink">{d.vehicle}</Link></Td>
                      <Td muted>{d.seller}</Td>
                      <Td>{d.payment_type === "contado" ? "Contado" : "Financiado"}</Td>
                      <Td><CatalogPill catalog={DEAL_STATUS} value={d.status} /></Td>
                      <Td numeric><Money value={d.sale_price} currency={d.currency} /></Td>
                      <Td>{formatDate(d.created_at)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table></TableWrap>
            )}
          </Panel>
          <Panel title="Historial de oportunidades" bodyClassName="p-0">
            {opportunities.length === 0 ? <EmptyState title="Sin oportunidades" /> : (
              <Table>
                <THead><Th>Oportunidad</Th><Th>Unidad</Th><Th>Etapa</Th><Th>Estado</Th><Th numeric>Valor esperado</Th></THead>
                <tbody>
                  {opportunities.map((o) => (
                    <Tr key={o.id}>
                      <Td>{o.title}</Td><Td muted>{o.vehicle ?? "—"}</Td><Td>{o.stage}</Td>
                      <Td>{o.status === "abierta" ? <StatusPill tone="info">Abierta</StatusPill> : o.status === "ganada" ? <StatusPill tone="positive">Ganada</StatusPill> : <StatusPill tone="neutral">Perdida</StatusPill>}</Td>
                      <Td numeric><Money value={o.expected_value} currency={o.currency} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
        </div>
      ) : null}

      {tab === "cuenta" && canAccount ? <AccountTab ctx={ctx} id={id} contracts={contracts} canPayments={canPayments} /> : null}

      {tab === "gestiones" ? <TimelineTab ctx={ctx} id={id} /> : null}

      {tab === "documentos" ? (
        <DocumentsPanel documents={await customerDocuments(ctx, id)} entityType="customer" entityId={id} canUpload={ctx.perms.has("customers.edit")}
          allowRestricted={ctx.perms.has("documents.view_restricted")} />
      ) : null}
    </>
  );
}

async function AccountTab({ ctx, id, contracts, canPayments }: { ctx: AppContext; id: string; contracts: Awaited<ReturnType<typeof customerContracts>>[number][]; canPayments: boolean }) {
  const payments = canPayments ? await customerPayments(ctx, id) : [];
  return (
    <div className="space-y-5">
      <Panel title="Contratos" bodyClassName="p-0">
        {contracts.length === 0 ? <EmptyState title="Sin contratos" /> : (
          <TableWrap className="rounded-none border-0"><Table>
            <THead><Th>Contrato</Th><Th>Estado</Th><Th numeric>Precio</Th><Th numeric>Cobrado (efectivo)</Th><Th numeric>Saldo</Th><Th numeric>Vencido</Th><Th numeric>Días</Th><Th>Último pago</Th></THead>
            <tbody>
              {contracts.map((k) => (
                <Tr key={k.contract_id}>
                  <Td><Link href={`/financiaciones/${k.contract_id}`} className="num text-ink hover:underline">{k.number}</Link></Td>
                  <Td><CatalogPill catalog={CONTRACT_STATUS} value={k.status} /></Td>
                  <Td numeric><Money value={k.sale_price} currency={k.currency} /></Td>
                  <Td numeric><Money value={k.cash_collected} currency={k.currency} /></Td>
                  <Td numeric><Money value={k.outstanding} currency={k.currency} /></Td>
                  <Td numeric><Money value={k.overdue_amount} currency={k.currency} tone={Number(k.overdue_amount) > 0 ? "critical" : "muted"} /></Td>
                  <Td numeric>{k.max_days_overdue || "—"}</Td>
                  <Td>{formatDate(k.last_payment_on)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table></TableWrap>
        )}
      </Panel>
      {canPayments ? (
        <Panel title="Pagos" description="Sólo los pagos confirmados cuentan como cobro." bodyClassName="p-0">
          {payments.length === 0 ? <EmptyState title="Sin pagos" /> : (
            <TableWrap className="rounded-none border-0"><Table>
              <THead><Th>N.º</Th><Th>Fecha</Th><Th>Contrato</Th><Th>Medio</Th><Th>Referencia</Th><Th>Estado</Th><Th numeric>Importe</Th></THead>
              <tbody>
                {payments.map((p) => (
                  <Tr key={p.id}>
                    <Td className="num">{p.number}</Td><Td>{formatDate(p.received_on)}</Td><Td className="num" muted>{p.contract ?? "Reserva"}</Td>
                    <Td>{PAYMENT_METHOD[p.method] ?? p.method}</Td><Td muted>{p.reference ?? "—"}</Td>
                    <Td><CatalogPill catalog={PAYMENT_STATUS} value={p.status} /></Td>
                    <Td numeric><Money value={p.amount} currency={p.currency} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table></TableWrap>
          )}
        </Panel>
      ) : null}
    </div>
  );
}

async function TimelineTab({ ctx, id }: { ctx: AppContext; id: string }) {
  const items = await customerInteractions(ctx, id);
  return (
    <Panel title="Gestiones e interacciones" description="Comercial y de cobranza, en orden cronológico." bodyClassName="p-0">
      {items.length === 0 ? <EmptyState title="Sin gestiones registradas" /> : (
        <ol className="divide-y divide-line-soft">
          {items.map((i) => (
            <li key={`${i.kind}-${i.id}`} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-4">
              <span className="num w-40 shrink-0 text-[12.5px] text-faint">{formatDateTime(i.occurred_at)}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[13px]">
                  <StatusPill tone={i.kind === "cobranza" ? "warning" : "neutral"}>{i.kind === "cobranza" ? "Cobranza" : "Comercial"}</StatusPill>
                  <span className="text-ink-2">{CHANNEL[i.channel] ?? i.channel}</span>
                  {i.result ? <span className="text-faint">· {COLLECTION_RESULT[i.result] ?? i.result}</span> : null}
                  <span className="text-faint">· {i.user_name}</span>
                </p>
                {i.summary ? <p className="mt-1 text-[13.5px] text-ink">{i.summary}</p> : null}
                {i.promise_amount ? (
                  <p className="mt-1 text-[12.5px] text-info">Compromiso: {formatMoney(i.promise_amount, i.promise_currency ?? "PYG")} para el {formatDate(i.promise_date)} (no es un cobro)</p>
                ) : null}
                {i.next_action || i.next_action_at ? <p className="mt-1 text-[12.5px] text-muted">Próxima acción: {i.next_action ?? "—"} {i.next_action_at ? `· ${formatDate(i.next_action_at)}` : ""}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
