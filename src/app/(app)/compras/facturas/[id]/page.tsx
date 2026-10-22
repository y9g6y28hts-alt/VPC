import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, Td, Th, THead, Tr } from "@/components/ui/table";
import { DocumentsPanel } from "@/components/documents/documents-panel";
import { ConfirmSupplierPaymentButton, SupplierPaymentDialog } from "@/components/payables/payables-forms";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { INVOICE_CATEGORY, INVOICE_STATUS, MOVEMENT_STATUS, PAYMENT_STATUS } from "@/lib/labels";
import { requirePerm } from "@/server/auth/context";
import { getToday, listCashAccounts } from "@/server/queries/common";

export const metadata: Metadata = { title: "Factura de proveedor" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("payables.view");
  const { id } = await params;
  const [inv] = await ctx.db((tx) => tx<{ id: string; supplier: string; invoice_number: string; timbrado: string | null; issue_date: string; due_date: string; currency: string; amount: string; tax_amount: string; concept: string; category: string; status: string; paid_confirmed: string; paid_registered_pending: string; paid_reconciled: string; outstanding: string; days_overdue: number; vehicle_id: string | null; vehicle: string | null; created_by: string | null }[]>`
    select ib.*, si.timbrado, si.tax_amount, s.name as supplier, u.full_name as created_by,
           case when v.id is not null then v.stock_code || ' · ' || app.vehicle_name(b.name, v.model) end as vehicle
    from public.v_supplier_invoice_balances ib join public.supplier_invoices si on si.id = ib.id join public.suppliers s on s.id = ib.supplier_id
    left join public.vehicles v on v.id = ib.vehicle_id left join public.brands b on b.id = v.brand_id left join public.user_profiles u on u.id = si.created_by
    where ib.id = ${id} and ib.org_id = ${ctx.org.id}`);
  if (!inv) notFound();
  const [payments, today, accounts] = await Promise.all([
    ctx.db((tx) => tx<{ id: string; paid_on: string; amount: string; status: string; reference: string | null; account: string; movement_status: string | null; created_by: string | null; confirmed_at: Date | null }[]>`
      select sp.id, sp.paid_on, sp.amount, sp.status, sp.reference, a.name as account, cm.status as movement_status, u.full_name as created_by, sp.confirmed_at
      from public.supplier_payments sp join public.cash_accounts a on a.id = sp.cash_account_id
      left join public.cash_movements cm on cm.id = sp.cash_movement_id left join public.user_profiles u on u.id = sp.created_by
      where sp.invoice_id = ${id} order by sp.paid_on, sp.created_at`),
    getToday(ctx),
    ctx.perms.has("payables.pay") ? listCashAccounts(ctx) : Promise.resolve([]),
  ]);
  const docs = await ctx.db((tx) => tx<{ id: string; title: string; mime_type: string; size_bytes: string; is_restricted: boolean; uploaded_at: Date; uploaded_by: string | null }[]>`
    select d.id, d.title, d.mime_type, d.size_bytes, d.is_restricted, d.uploaded_at, u.full_name as uploaded_by
    from public.documents d left join public.user_profiles u on u.id = d.uploaded_by where d.entity_type = 'supplier_invoice' and d.entity_id = ${id} order by d.uploaded_at desc`);
  const available = Number(inv.outstanding) - Number(inv.paid_registered_pending);
  const cur = inv.currency;
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Compras", href: "/compras" }, { label: inv.invoice_number }]} title={`${inv.supplier} · ${inv.invoice_number}`} description={inv.concept}
        meta={<>
          {inv.status === "aprobada" && Number(inv.outstanding) === 0 ? <StatusPill tone="positive">Pagada</StatusPill> : <CatalogPill catalog={INVOICE_STATUS} value={inv.status} />}
          {inv.days_overdue > 0 && Number(inv.outstanding) > 0 ? <StatusPill tone="critical">Vencida hace {inv.days_overdue} días</StatusPill> : null}
        </>}
        actions={inv.status === "aprobada" && available > 0 && ctx.perms.has("payables.pay") ? <SupplierPaymentDialog invoiceId={id} currency={cur} accounts={accounts} today={today} maxAmount={formatMoney(available, cur)} /> : null} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <Panel title="Factura">
            <DescriptionList items={[
              { label: "Emisión", value: formatDate(inv.issue_date) },
              { label: "Vencimiento", value: formatDate(inv.due_date) },
              { label: "Timbrado", value: inv.timbrado },
              { label: "Categoría", value: INVOICE_CATEGORY[inv.category] },
              { label: "Unidad", value: inv.vehicle && inv.vehicle_id ? <Link href={`/inventario/${inv.vehicle_id}?tab=costes`} className="hover:text-ink">{inv.vehicle}</Link> : "—" },
              { label: "Registró", value: inv.created_by },
            ]} />
          </Panel>
          <Panel title="Saldos" description={`En ${cur}.`}>
            <dl className="space-y-2 text-[13.5px]">
              <div className="flex justify-between text-ink-2"><dt>Importe (IVA {formatMoney(inv.tax_amount, cur)})</dt><dd className="num">{formatMoney(inv.amount, cur)}</dd></div>
              <div className="flex justify-between text-ink-2"><dt>Pagos confirmados</dt><dd className="num">{formatMoney(inv.paid_confirmed, cur)}</dd></div>
              <div className="flex justify-between text-faint"><dt>· de ellos, conciliados con el extracto</dt><dd className="num">{formatMoney(inv.paid_reconciled, cur)}</dd></div>
              <div className="flex justify-between text-ink-2"><dt>Pagos registrados sin confirmar</dt><dd className="num">{formatMoney(inv.paid_registered_pending, cur)}</dd></div>
              <div className="flex justify-between font-semibold text-ink"><dt>Saldo pendiente</dt><dd className="num">{formatMoney(inv.outstanding, cur)}</dd></div>
            </dl>
          </Panel>
        </div>
        <div className="space-y-5">
          <Panel title="Pagos" bodyClassName="p-0">
            {payments.length === 0 ? <EmptyState title="Sin pagos" /> : (
              <Table>
                <THead><Th>Fecha</Th><Th>Cuenta / ref.</Th><Th numeric>Importe</Th><Th>Estado</Th><Th>Conciliación</Th><Th /></THead>
                <tbody>
                  {payments.map((p) => (
                    <Tr key={p.id}>
                      <Td className="num">{formatDate(p.paid_on)}</Td>
                      <Td muted>{p.account}{p.reference ? ` · ${p.reference}` : ""}<span className="block text-[11.5px]">{p.created_by}{p.confirmed_at ? ` · conf. ${formatDateTime(p.confirmed_at)}` : ""}</span></Td>
                      <Td numeric><Money value={p.amount} currency={cur} /></Td>
                      <Td><CatalogPill catalog={PAYMENT_STATUS} value={p.status} /></Td>
                      <Td>{p.movement_status ? <CatalogPill catalog={MOVEMENT_STATUS} value={p.movement_status} /> : <span className="text-faint">—</span>}</Td>
                      <Td>{p.status === "registrado" && ctx.perms.has("payables.pay") ? <ConfirmSupplierPaymentButton paymentId={p.id} invoiceId={id} /> : null}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Panel>
          <DocumentsPanel documents={docs} entityType="supplier_invoice" entityId={id} canUpload={ctx.perms.has("payables.create")} allowRestricted={ctx.perms.has("documents.view_restricted")} />
        </div>
      </div>
    </>
  );
}
