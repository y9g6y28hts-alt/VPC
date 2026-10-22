import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { ActionForm, ConfirmSubmit, Input, Submit } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { PAYMENT_METHOD, PAYMENT_STATUS, label } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";
import { autoAllocateAction, confirmPaymentAction, rejectPaymentAction, reversePaymentAction } from "./actions";

export const metadata = { title: "Pagos recibidos" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "payment.read")) return <Panel><Empty title="Se requiere el permiso payment.read" /></Panel>;
  const status = sp(params, "status") ?? "";
  const q = sp(params, "q")?.trim() ?? "";
  const focus = sp(params, "focus");
  const rows = await query(ctx, (db) => db.rows<R>(
    `select ps.*, rb.full_name recorded_name, cb.full_name confirmed_name, sc.number contract_number,
            (select json_agg(json_build_object('label', i.label, 'amount', a.amount, 'contract', c2.number) order by i.seq)
               from public.payment_allocations a join public.receivable_installments i on i.id = a.installment_id
               join public.sales_contracts c2 on c2.id = i.contract_id where a.payment_id = ps.id) allocations,
            pr.reason reversal_reason
       from public.payment_status ps left join public.user_profiles rb on rb.id = ps.recorded_by
       left join public.user_profiles cb on cb.id = ps.confirmed_by left join public.sales_contracts sc on sc.id = ps.contract_id
       left join public.payment_reversals pr on pr.payment_id = ps.id
      where ps.organization_id = $1 and ($2 = '' or ps.status = $2)
        and ($3 = '' or ps.number ilike '%' || $3 || '%' or ps.customer_name ilike '%' || $3 || '%' or coalesce(ps.reference, '') ilike '%' || $3 || '%')
      order by (ps.id::text = $4) desc, ps.status = 'pending_reconciliation' desc, ps.effective_date desc, ps.recorded_at desc limit 300`,
    [ctx.org.id, status, q, focus ?? ""]));
  return (
    <>
      <PageHeader title="Pagos recibidos" subtitle="Registro, asignación a obligaciones, conciliación, rechazo y reversión. Un pago pendiente no cuenta como cobrado."
        actions={can(ctx, "payment.create") && <LinkButton href="/payments/new" variant="primary">Registrar pago</LinkButton>} />
      <FilterBar base="/payments" filters={[
        { name: "q", label: "Buscar", type: "search", value: q, placeholder: "Número, cliente, referencia" },
        { name: "status", label: "Estado", value: status, all: "Todos", options: Object.entries(PAYMENT_STATUS).map(([k, [l]]) => [k, l]) },
      ]} />
      <Panel>
        {rows.length === 0 ? <Empty title="Sin pagos con estos filtros" /> : (
          <div className="overflow-x-auto">
            <table className="mh-table">
              <thead><tr><th>Pago</th><th>Cliente</th><th>Fecha efectiva</th><th>Medio / referencia</th><th>Cuenta</th><th className="r">Importe</th><th>Asignado a</th><th>Estado</th><th>Acciones</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className={p.id === focus ? "bg-raised" : ""}>
                    <td><span className="text-text">{p.number}</span><div className="text-xs text-faint">reg. {p.recorded_name} · {dateTime(p.recorded_at)}</div></td>
                    <td><Link href={`/receivables/${p.customer_id}`} className="text-text-2 hover:text-accent">{p.customer_name}</Link><div className="text-xs text-faint">{p.contract_number ?? "Sin contrato"}</div></td>
                    <td className="num text-text-2">{date(p.effective_date)}</td>
                    <td className="text-text-2">{label(PAYMENT_METHOD, p.method)}<div className="text-xs text-faint">{p.reference ?? "—"}</div></td>
                    <td className="text-xs text-text-2">{p.cash_account_name}</td>
                    <td className="r"><Money value={p.amount} currency={p.currency} />{Number(p.unallocated_amount) > 0 && <div className="text-xs text-warn">{money(p.unallocated_amount, p.currency)} sin asignar</div>}</td>
                    <td className="max-w-56 text-xs text-text-2">{(p.allocations ?? []).map((a: R, i: number) => <div key={i} className="truncate">{a.contract} · {a.label}: {money(a.amount, p.currency)}</div>)}</td>
                    <td><StatusBadge map={PAYMENT_STATUS} value={p.status} />
                      {p.confirmed_name && <div className="text-xs text-faint">conf. {p.confirmed_name}</div>}
                      {p.rejected_reason && <div className="text-xs text-faint">{p.rejected_reason}</div>}
                      {p.reversal_reason && <div className="text-xs text-risk">{p.reversal_reason}</div>}
                    </td>
                    <td className="min-w-52">
                      {p.status === "pending_reconciliation" && can(ctx, "payment.confirm") && (
                        <div className="space-y-1">
                          <ActionForm action={confirmPaymentAction}>
                            <input type="hidden" name="payment" value={p.id} />
                            <ConfirmSubmit label="Confirmar" confirmLabel="Confirmar conciliación" fields={[]}
                              warning={`Confirma que ${money(p.amount, p.currency)} (${p.reference ?? "efectivo"}) se acreditó en ${p.cash_account_name}. Se registrará el movimiento de caja.`} />
                          </ActionForm>
                          <details><summary className="cursor-pointer text-xs text-muted hover:text-risk">Rechazar</summary>
                            <ActionForm action={rejectPaymentAction} className="mt-1 flex gap-1"><input type="hidden" name="payment" value={p.id} /><Input name="reason" placeholder="Motivo" /><Submit size="sm" variant="danger">Rechazar</Submit></ActionForm>
                          </details>
                        </div>
                      )}
                      {p.status === "pending_reconciliation" && can(ctx, "payment.create") && Number(p.unallocated_amount) > 0 && (
                        <ActionForm action={autoAllocateAction} className="mt-1"><input type="hidden" name="payment" value={p.id} /><Submit size="sm" variant="ghost">Asignar automáticamente</Submit></ActionForm>
                      )}
                      {p.status === "confirmed" && can(ctx, "payment.reverse") && (
                        <details><summary className="cursor-pointer text-xs text-muted hover:text-risk">Revertir</summary>
                          <ActionForm action={reversePaymentAction} className="mt-1 space-y-1"><input type="hidden" name="payment" value={p.id} /><Input name="reason" placeholder="Motivo (p. ej. cheque rechazado)" />
                            <ConfirmSubmit variant="danger" label="Revertir pago" confirmLabel="Confirmar reversión" fields={[{ name: "reason", label: "Motivo" }]}
                              warning="El pago dejará de contar como cobrado y se registrará un movimiento de caja negativo. La acción queda auditada." />
                          </ActionForm>
                        </details>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
