import { randomUUID } from "node:crypto";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { PAYMENT_METHOD } from "@/lib/labels";
import { date, money } from "@/lib/format";
import { uuidOrNull } from "@/server/filters";
import { recordPaymentAction } from "../actions";

export const metadata = { title: "Registrar pago" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function NewPaymentPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "payment.create")) return <Panel><Empty title="Se requiere el permiso payment.create" /></Panel>;
  const customerId = uuidOrNull(sp(params, "customer"));
  const contractId = uuidOrNull(sp(params, "contract"));
  const d = await query(ctx, async (db) => {
    const customers = await db.rows<R>(
      "select distinct c.id, c.display_name from public.customers c join public.sales_contracts s on s.customer_id = c.id where c.organization_id = $1 order by c.display_name", [ctx.org.id]);
    const contracts = customerId ? await db.rows<R>("select contract_id, number, currency, outstanding, overdue_amount from public.contract_balances where customer_id = $1 and status <> 'cancelled'", [customerId]) : [];
    const contract = contracts.find((c) => c.contract_id === contractId) ?? contracts[0];
    const installments = contract ? await db.rows<R>("select id, label, due_date, outstanding, pending_allocated from public.installment_status where contract_id = $1 and outstanding > 0 order by due_date, seq", [contract.contract_id]) : [];
    const accounts = contract ? await db.rows<R>("select id, name from public.cash_accounts where organization_id = $1 and active and currency = $2 order by name", [ctx.org.id, contract.currency]) : [];
    return { customers, contracts, contract, installments, accounts };
  });
  const ccy = d.contract?.currency ?? ctx.org.currency;
  return (
    <>
      <PageHeader crumbs={[["/payments", "Pagos recibidos"]]} title="Registrar pago recibido"
        subtitle="Queda pendiente de conciliación hasta que un usuario autorizado (distinto de quien registra) lo confirme contra el banco o la caja." />
      <Panel className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Cliente</span>
            <select name="customer" defaultValue={customerId ?? ""} className="h-8 w-72 rounded-sm border border-line bg-ink px-2 text-[13px]">
              <option value="">Seleccione…</option>{d.customers.map((c) => <option key={c.id} value={c.id}>{c.display_name}</option>)}
            </select></label>
          {d.contracts.length > 0 && <label className="block"><span className="mb-1 block text-[10px] uppercase tracking-wider text-faint">Contrato</span>
            <select name="contract" defaultValue={d.contract?.contract_id} className="h-8 w-72 rounded-sm border border-line bg-ink px-2 text-[13px]">
              {d.contracts.map((c) => <option key={c.contract_id} value={c.contract_id}>{c.number} · pendiente {money(c.outstanding, c.currency)}</option>)}
            </select></label>}
          <button className="h-8 rounded-sm border border-line px-3 text-[13px]">Continuar</button>
        </form>
      </Panel>
      {d.contract && (
        <Panel title={`Pago para ${d.contract.number}`} subtitle={`Moneda contractual ${ccy}: solo cuentas en ${ccy}. Vencido ${money(d.contract.overdue_amount, ccy)}.`}>
          {d.accounts.length === 0 ? <Empty title={`No hay cuentas financieras activas en ${ccy}`} hint="No se convierten monedas en silencio; cree una cuenta en esa moneda en Tesorería." /> : (
            <ActionForm action={recordPaymentAction} className="grid grid-cols-2 gap-3 px-4 py-3 lg:grid-cols-4">
              <input type="hidden" name="customer" value={customerId!} /><input type="hidden" name="contract" value={d.contract.contract_id} />
              <input type="hidden" name="currency" value={ccy} /><input type="hidden" name="idempotency_key" value={randomUUID()} />
              <Field label={`Importe (${ccy})`} name="amount"><Input name="amount" inputMode="decimal" /></Field>
              <Field label="Fecha efectiva" name="effective_date"><Input type="date" name="effective_date" defaultValue={ctx.today} max={ctx.today} /></Field>
              <Field label="Medio" name="method"><Select name="method" options={Object.entries(PAYMENT_METHOD)} /></Field>
              <Field label="Referencia" name="reference" hint="Obligatoria salvo efectivo; no puede repetirse en la cuenta"><Input name="reference" /></Field>
              <Field label="Cuenta receptora" name="cash_account"><Select name="cash_account" options={d.accounts.map((a) => [a.id, a.name])} /></Field>
              <Field label="Asignación" name="mode"><Select name="mode" options={[["auto", "Automática: cuotas más antiguas primero"], ["manual", "Manual (importes abajo)"], ["none", "Sin asignar por ahora"]]} /></Field>
              <Field label="Notas" name="notes" className="col-span-2"><Textarea name="notes" rows={1} /></Field>
              {d.installments.length > 0 && (
                <div className="col-span-2 lg:col-span-4">
                  <div className="mb-1 text-[11px] uppercase tracking-wider text-muted">Asignación manual (opcional)</div>
                  <table className="mh-table"><thead><tr><th>Obligación</th><th>Vence</th><th className="r">Pendiente</th><th className="r">Ya asignado sin conciliar</th><th className="r w-40">Asignar</th></tr></thead>
                    <tbody>{d.installments.map((i) => (
                      <tr key={i.id}><td>{i.label}</td><td className="num">{date(i.due_date)}</td><td className="r">{money(i.outstanding, ccy)}</td>
                        <td className="r text-warn">{Number(i.pending_allocated) ? money(i.pending_allocated, ccy) : "—"}</td>
                        <td className="r"><Input name={`alloc_${i.id}`} inputMode="decimal" placeholder="0" /></td></tr>
                    ))}</tbody></table>
                </div>
              )}
              <div className="col-span-2 lg:col-span-4">
                <ConfirmSubmit label="Revisar pago" confirmLabel="Registrar pago"
                  fields={[{ name: "amount", label: "Importe" }, { name: "effective_date", label: "Fecha efectiva" }, { name: "method", label: "Medio", options: PAYMENT_METHOD },
                    { name: "reference", label: "Referencia" }, { name: "cash_account", label: "Cuenta", options: Object.fromEntries(d.accounts.map((a) => [a.id, a.name])) },
                    { name: "mode", label: "Asignación", options: { auto: "Automática", manual: "Manual", none: "Sin asignar" } }]}
                  warning="El pago quedará pendiente de conciliación y no se contará como cobrado hasta su confirmación." />
              </div>
            </ActionForm>
          )}
        </Panel>
      )}
    </>
  );
}
