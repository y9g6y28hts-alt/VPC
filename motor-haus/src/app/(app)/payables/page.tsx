import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { APPROVAL_STATUS, PAYABLE_CATEGORY, PAYABLE_STATE, label } from "@/lib/labels";
import { date } from "@/lib/format";
import { cancelPayableAction, createPayableAction, createSupplierAction, payPayableAction } from "./actions";

export const metadata = { title: "Cuentas por pagar" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function PayablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "payable.read")) return <Panel><Empty title="Se requiere el permiso payable.read" /></Panel>;
  const state = sp(params, "state") ?? "open";
  const focus = sp(params, "focus");
  const d = await query(ctx, async (db) => ({
    rows: await db.rows<R>(
      `select ps.*, u.stock_number, (select json_agg(json_build_object('paid_on', pp.paid_on, 'amount', pp.amount, 'status', pp.status, 'ref', pp.reference)) from public.payable_payments pp where pp.payable_id = ps.id) payments
         from public.payable_status ps left join public.units u on u.id = ps.unit_id
        where ps.organization_id = $1 and ($2 = 'all' or ($2 = 'open' and ps.payable_state in ('open','overdue')) or ps.payable_state = $2)
        order by (ps.id::text = $3) desc, ps.due_date`, [ctx.org.id, state, focus ?? ""]),
    totals: await db.rows<R>(
      `select currency, sum(outstanding) filter (where payable_state in ('open','overdue')) outstanding, sum(outstanding) filter (where payable_state = 'overdue') overdue,
              sum(outstanding) filter (where payable_state = 'open' and due_date <= app.today() + 30) next30
         from public.payable_status where organization_id = $1 and approval_status <> 'rejected' group by currency`, [ctx.org.id]),
    suppliers: await db.rows<R>("select id, name from public.suppliers where organization_id = $1 and active order by name", [ctx.org.id]),
    accounts: can(ctx, "payable.pay") ? await db.rows<R>("select id, name, currency from public.cash_accounts where organization_id = $1 and active order by name", [ctx.org.id]) : [],
    units: await db.rows<R>("select id, stock_number, make, model from public.units where organization_id = $1 and commercial_status not in ('delivered','retired') order by stock_number", [ctx.org.id]),
  }));
  return (
    <>
      <PageHeader title="Cuentas por pagar" subtitle="Compromisos con proveedores de vehículos, logística, aduana, servicios y gastos operativos. Pago solo de facturas aprobadas." />
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
        {d.totals.map((t) => <span key={t.currency}>{t.currency}: pendiente <Money value={t.outstanding} currency={t.currency} /> · vencido <Money value={t.overdue} currency={t.currency} className="text-risk" /> · próximos 30 días <Money value={t.next30} currency={t.currency} /></span>)}
      </div>
      <FilterBar base="/payables" filters={[{ name: "state", label: "Estado", value: state, options: [["open", "Pendientes"], ["overdue", "Vencidas"], ["paid", "Pagadas"], ["cancelled", "Anuladas"], ["all", "Todas"]] }]} />
      <Panel className="mb-4">
        {d.rows.length === 0 ? <Empty title="Sin facturas con este filtro" /> : (
          <div className="overflow-x-auto"><table className="mh-table">
            <thead><tr><th>Proveedor</th><th>Documento</th><th>Concepto</th><th>Unidad</th><th>Emisión</th><th>Vence</th><th className="r">Importe</th><th className="r">Pendiente</th><th>Aprobación</th><th>Estado</th><th>Acciones</th></tr></thead>
            <tbody>{d.rows.map((p) => (
              <tr key={p.id} className={p.id === focus ? "bg-raised" : ""}>
                <td>{p.supplier_name}</td><td className="text-text-2">{p.document_number}</td>
                <td className="max-w-56 truncate text-text-2" title={p.concept}>{p.concept}<div className="text-xs text-faint">{label(PAYABLE_CATEGORY, p.category)}</div></td>
                <td>{p.stock_number ? <Link href={`/inventory/${p.unit_id}`} className="text-xs text-text-2 hover:text-accent">{p.stock_number}</Link> : "—"}</td>
                <td className="num text-text-2">{date(p.issue_date)}</td>
                <td className="num">{date(p.due_date)}{p.payable_state === "open" && <div className="text-xs text-faint">en {p.days_to_due} d</div>}</td>
                <td className="r"><Money value={p.amount} currency={p.currency} /></td>
                <td className="r"><Money value={p.outstanding} currency={p.currency} /></td>
                <td><StatusBadge map={APPROVAL_STATUS} value={p.approval_status} /></td>
                <td><StatusBadge map={PAYABLE_STATE} value={p.payable_state} /></td>
                <td className="min-w-48">
                  {p.approval_status === "approved" && ["open", "overdue"].includes(p.payable_state) && can(ctx, "payable.pay") && (
                    <details><summary className="cursor-pointer text-xs text-accent">Registrar pago</summary>
                      <ActionForm action={payPayableAction} className="mt-2 grid grid-cols-2 gap-1">
                        <input type="hidden" name="payable" value={p.id} />
                        <Field label="Importe" name="amount"><Input name="amount" inputMode="decimal" defaultValue={Number(p.outstanding).toFixed(2)} /></Field>
                        <Field label="Fecha" name="paid_on"><Input type="date" name="paid_on" defaultValue={ctx.today} max={ctx.today} /></Field>
                        <Field label="Cuenta" name="cash_account" className="col-span-2"><Select name="cash_account" options={d.accounts.map((a) => [a.id, `${a.name} (${a.currency})`])} /></Field>
                        <Field label="Referencia" name="reference" className="col-span-2"><Input name="reference" /></Field>
                        <Field label="Cotización si otra moneda" name="fx_rate"><Input name="fx_rate" inputMode="decimal" /></Field>
                        <Field label="Fecha cot." name="fx_date"><Input type="date" name="fx_date" /></Field>
                        <Field label="Fuente cot." name="fx_source" className="col-span-2"><Input name="fx_source" /></Field>
                        <div className="col-span-2"><ConfirmSubmit label="Revisar" confirmLabel="Registrar pago" fields={[{ name: "amount", label: "Importe" }, { name: "paid_on", label: "Fecha" }, { name: "reference", label: "Referencia" }]} /></div>
                      </ActionForm>
                    </details>
                  )}
                  {p.approval_status === "pending" && <Link href="/approvals" className="text-xs text-muted hover:text-text">Bandeja de aprobación →</Link>}
                  {(p.payments ?? []).map((x: R, i: number) => <div key={i} className="text-xs text-faint">{date(x.paid_on)} · {x.amount} · {x.status === "reversed" ? "revertido" : x.ref ?? ""}</div>)}
                  {can(ctx, "payable.approve") && ["open", "overdue"].includes(p.payable_state) && !(p.payments ?? []).some((x: R) => x.status === "posted") && (
                    <details><summary className="cursor-pointer text-xs text-muted hover:text-risk">Anular</summary>
                      <ActionForm action={cancelPayableAction} className="mt-1 flex gap-1"><input type="hidden" name="payable" value={p.id} /><Input name="reason" placeholder="Motivo" /><Submit size="sm" variant="danger">Anular</Submit></ActionForm>
                    </details>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
      {can(ctx, "payable.write") && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <Panel title="Registrar factura de proveedor">
            <ActionForm action={createPayableAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4">
              <Field label="Proveedor" name="supplier_id"><Select name="supplier_id" options={d.suppliers.map((s) => [s.id, s.name])} /></Field>
              <Field label="Tipo" name="document_type"><Select name="document_type" options={[["invoice", "Factura"], ["receipt", "Recibo"], ["debit_note", "Nota de débito"], ["other", "Otro"]]} /></Field>
              <Field label="Número" name="document_number"><Input name="document_number" /></Field>
              <Field label="Categoría" name="category"><Select name="category" options={Object.entries(PAYABLE_CATEGORY)} /></Field>
              <Field label="Concepto" name="concept" className="col-span-2"><Input name="concept" /></Field>
              <Field label="Unidad relacionada" name="unit_id"><Select name="unit_id" placeholder="—" options={d.units.map((u) => [u.id, `${u.stock_number} · ${u.make} ${u.model}`])} /></Field>
              <Field label="Moneda" name="currency"><Select name="currency" options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]]} /></Field>
              <Field label="Importe" name="amount"><Input name="amount" inputMode="decimal" /></Field>
              <Field label="Emisión" name="issue_date"><Input type="date" name="issue_date" defaultValue={ctx.today} /></Field>
              <Field label="Vencimiento" name="due_date"><Input type="date" name="due_date" /></Field>
              <Field label="Notas" name="notes"><Input name="notes" /></Field>
              <div className="col-span-2 md:col-span-4"><Submit variant="secondary">Registrar factura</Submit></div>
            </ActionForm>
          </Panel>
          <Panel title="Nuevo proveedor">
            <ActionForm action={createSupplierAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3">
              <Field label="Nombre" name="name" className="col-span-2"><Input name="name" /></Field>
              <Field label="Tipo" name="kind"><Select name="kind" options={[["vehicle_seller", "Vendedor de vehículos"], ["logistics", "Logística"], ["customs_broker", "Despachante"], ["workshop", "Taller"], ["services", "Servicios"], ["operating", "Operativo"], ["other", "Otro"]]} /></Field>
              <Field label="País" name="country"><Input name="country" /></Field>
              <Field label="Identificación fiscal" name="tax_id" className="col-span-2"><Input name="tax_id" /></Field>
              <div><Submit variant="secondary">Crear</Submit></div>
            </ActionForm>
          </Panel>
        </div>
      )}
    </>
  );
}
