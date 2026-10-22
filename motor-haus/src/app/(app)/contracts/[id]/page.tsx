import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Facts } from "@/components/ui/Layout";
import { StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { ActionForm, Submit } from "@/components/ui/Form";
import { ACCOUNT_STATUS, COMMERCIAL, INSTALLMENT_STATUS, RATE_TYPE, SYSTEM, label } from "@/lib/labels";
import { date, dateTime, money, num } from "@/lib/format";
import { issueContractDocAction } from "../../receivables/actions";

export const metadata = { title: "Contrato" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const c = await db.maybe<R>(
      `select c.*, cu.display_name customer, p.full_name salesperson, d.number deal_number from public.sales_contracts c
         join public.customers cu on cu.id = c.customer_id join public.user_profiles p on p.id = c.salesperson_id
         join public.deals d on d.id = c.deal_id where c.id = $1`, [id]);
    if (!c) return null;
    const balance = await db.maybe<R>("select * from public.contract_balances where contract_id = $1", [id]);
    const version = await db.one<R>("select v.*, p.full_name author from public.contract_versions v left join public.user_profiles p on p.id = v.created_by where contract_id = $1 and version = $2", [id, c.current_version]);
    const units = await db.rows<R>("select u.id, u.stock_number, u.make, u.model, u.version, u.commercial_status, u.delivered_on, di.negotiated_price from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = $1", [c.deal_id]);
    const installments = await db.rows<R>("select * from public.installment_status where contract_id = $1 order by seq", [id]);
    const docs = await db.rows<R>("select id, number, kind, status, issued_at from public.documents where entity_type = 'contract' and entity_id = $1 order by issued_at desc", [id]);
    return { c, balance, version, units, installments, docs };
  });
  if (!d) notFound();
  const { c } = d;
  const ccy = c.currency;
  const plan = d.version.terms.plan;
  const econ = d.version.terms.economics;
  return (
    <>
      <PageHeader crumbs={[["/contracts", "Contratos"]]} title={<span className="flex items-center gap-2">{c.number}{d.balance && <StatusBadge map={ACCOUNT_STATUS} value={d.balance.account_status} />}</span>}
        subtitle={<>{c.customer} · firmado el {date(c.contract_date)} · <Link href={`/deals/${c.deal_id}`} className="text-accent">operación {c.deal_number}</Link> · vendedor {c.salesperson}</>}
        actions={<>
          {d.balance && <LinkButton href={`/receivables/${c.customer_id}?contract=${id}`}>Estado de cuenta</LinkButton>}
          {can(ctx, "document.issue") && (
            <ActionForm action={issueContractDocAction} className="flex gap-2">
              <input type="hidden" name="contract" value={id} />
              <Submit variant="secondary" name="kind" value="payment_schedule">Calendario PDF</Submit>
              <Submit variant="secondary" name="kind" value="sales_contract">Contrato (borrador legal)</Submit>
              <Submit variant="ghost" name="kind" value="delivery_record">Acta de entrega</Submit>
            </ActionForm>
          )}
        </>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Obligaciones generadas" subtitle={`Versión contractual ${c.current_version} · generadas desde el plan validado (checksum ${String(d.version.plan_checksum ?? "—").slice(0, 12)}…)`}>
            {d.installments.length === 0 ? <Empty title="Sin obligaciones visibles (requiere acceso a cuentas por cobrar)" /> : (
              <div className="max-h-[520px] overflow-auto"><table className="mh-table">
                <thead><tr><th>#</th><th>Concepto</th><th>Vence</th><th className="r">Capital</th><th className="r">Interés</th><th className="r">Exigible</th><th className="r">Cobrado</th><th className="r">Pendiente</th><th>Estado</th></tr></thead>
                <tbody>{d.installments.map((i) => (
                  <tr key={i.id}><td className="num text-faint">{i.seq}</td><td>{i.label}</td><td className="num">{date(i.due_date)}</td>
                    <td className="r"><Money value={i.principal_amount} currency={ccy} muted /></td><td className="r"><Money value={i.interest_amount} currency={ccy} muted /></td>
                    <td className="r"><Money value={i.total_due} currency={ccy} /></td><td className="r"><Money value={i.paid_confirmed} currency={ccy} /></td>
                    <td className="r"><Money value={i.outstanding} currency={ccy} /></td><td><StatusBadge map={INSTALLMENT_STATUS} value={i.payment_status} /></td></tr>
                ))}</tbody>
                {d.balance && <tfoot><tr><td colSpan={3}>Totales</td><td className="r"><Money value={d.balance.total_principal_scheduled} currency={ccy} /></td><td className="r"><Money value={d.balance.total_interest_scheduled} currency={ccy} /></td><td className="r"><Money value={d.balance.total_obligations} currency={ccy} /></td><td className="r"><Money value={d.balance.collected_confirmed} currency={ccy} /></td><td className="r"><Money value={d.balance.outstanding} currency={ccy} /></td><td></td></tr></tfoot>}
              </table></div>
            )}
            {d.balance && <p className="border-t border-line-soft px-4 py-2 text-xs text-muted">Control: principal programado {money(d.balance.total_principal_scheduled, ccy)} = entregas {money(c.upfront_total, ccy)} + capital financiado {money(c.financed_principal, ccy)} · diferencia {money(d.balance.schedule_discrepancy, ccy)}</p>}
          </Panel>
          <Panel title="Unidades del contrato">
            <table className="mh-table"><tbody>{d.units.map((u) => (
              <tr key={u.id}><td><Link href={`/inventory/${u.id}`} className="text-text hover:text-accent">{u.stock_number} · {u.make} {u.model} {u.version}</Link></td>
                <td className="r"><Money value={u.negotiated_price} currency={ccy} /></td><td>{label(COMMERCIAL, u.commercial_status)}</td><td className="text-xs text-muted">{u.delivered_on ? `Entregada ${date(u.delivered_on)}` : "Entrega desde la ficha de la unidad"}</td></tr>
            ))}</tbody></table>
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Condiciones formalizadas" subtitle={`Instantánea inmutable · ${dateTime(d.version.created_at)} · ${d.version.author ?? ""}`}>
            <div className="px-4 py-3">
              <Facts items={[
                ["Precio total", <Money key="p" value={c.total_price} currency={ccy} />], ["Entregas iniciales", <Money key="u" value={c.upfront_total} currency={ccy} />],
                ["Crédito trade-in", <Money key="t" value={econ?.trade_in_credit} currency={ccy} />], ["Capital financiado", <Money key="f" value={c.financed_principal} currency={ccy} />],
                ["Sistema", plan ? label(SYSTEM, plan.inputs.system) : "Contado"], ["Tasa", plan ? (plan.inputs.system === "zero_interest" ? "0 %" : `${num(Number(plan.inputs.rate) * 100, 2)} % ${label(RATE_TYPE, plan.inputs.rateType)}`) : "—"],
                ["Plazo", plan ? `${plan.inputs.termPeriods} cuotas · cada ${plan.inputs.monthsPerPeriod} mes(es)` : "—"], ["Motor", plan?.engine_version ?? "—"],
                ["Margen bruto al formalizar", can(ctx, "report.read") ? <Money key="m" value={econ?.gross_margin_estimated} currency={ccy} /> : "Sin acceso"],
                ["Interés total", plan ? <Money key="i" value={plan.summary.totalInterest} currency={ccy} /> : "—"],
              ]} />
            </div>
          </Panel>
          <Panel title="Documentos emitidos">
            {d.docs.length === 0 ? <Empty title="Sin documentos emitidos" /> : (
              <ul className="divide-y divide-line-soft">{d.docs.map((x) => (
                <li key={x.id}><Link href={`/documents/${x.id}`} className="flex justify-between px-4 py-2 text-[13px] hover:bg-raised"><span className="text-text">{x.number}</span><span className="text-xs text-muted">{dateTime(x.issued_at)} · {x.status === "issued" ? "vigente" : x.status}</span></Link></li>
              ))}</ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
