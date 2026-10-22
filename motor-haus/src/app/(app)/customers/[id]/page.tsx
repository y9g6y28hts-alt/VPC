import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Figure, Facts } from "@/components/ui/Layout";
import { StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { ActionForm, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { ACCOUNT_STATUS, APPRAISAL_STATUS, CHANNEL, CUSTOMER_KIND, DEAL_STATUS, OUTCOME, PAYMENT_STATUS, label } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";
import { addInteractionAction, revealPiiAction, updateCustomerAction } from "../actions";

export const metadata = { title: "Cliente" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

const KIND_TEXT: Record<string, string> = { inquiry: "Consulta", visit: "Visita", test_drive: "Prueba de manejo", follow_up: "Seguimiento", proposal: "Propuesta", complaint: "Reclamo", note: "Nota" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const c = await db.maybe<R>(
      `select c.id, c.kind, c.display_name, c.legal_name, c.document_type, c.email, c.phone, c.city, c.country, c.status, c.notes, c.preferences, c.created_at,
              p.full_name owner from public.customers c left join public.user_profiles p on p.id = c.owner_user_id where c.id = $1`, [id]);
    if (!c) return null;
    const contracts = await db.rows<R>(
      `select s.id, s.number, s.contract_date, s.currency, s.total_price, cb.outstanding, cb.overdue_amount, cb.collected_confirmed, cb.next_due_date, cb.next_due_amount, cb.account_status,
              (select string_agg(u.make || ' ' || u.model, ', ') from public.deal_items di join public.units u on u.id = di.unit_id where di.deal_id = s.deal_id) units
         from public.sales_contracts s left join public.contract_balances cb on cb.contract_id = s.id where s.customer_id = $1 order by s.contract_date desc`, [id]);
    const deals = await db.rows<R>(
      `select d.id, d.number, d.status, d.currency, d.created_at, sum(i.negotiated_price) total, string_agg(u.make || ' ' || u.model, ', ') units
         from public.deals d left join public.deal_items i on i.deal_id = d.id left join public.units u on u.id = i.unit_id
        where d.customer_id = $1 group by d.id order by d.created_at desc`, [id]);
    const appraisals = await db.rows<R>("select id, number, make, model, year_built, status, created_at from public.trade_in_appraisals where customer_id = $1 order by created_at desc", [id]);
    const reservations = await db.rows<R>("select r.*, u.stock_number, u.make, u.model from public.reservations r join public.units u on u.id = r.unit_id where r.customer_id = $1 and r.status = 'active'", [id]);
    const upcoming = await db.rows<R>("select s.* , c.number from public.installment_status s join public.sales_contracts c on c.id = s.contract_id where s.customer_id = $1 and s.outstanding > 0 order by s.due_date limit 6", [id]);
    const timeline = await db.rows<R>(
      `select * from (
         select i.occurred_at at, 'interaction' t, i.kind || ' · ' || i.channel k, i.summary txt, p.full_name who from public.customer_interactions i left join public.user_profiles p on p.id = i.user_id where i.customer_id = $1
         union all select d.created_at, 'deal', d.status, 'Operación ' || d.number, p.full_name from public.deals d join public.user_profiles p on p.id = d.salesperson_id where d.customer_id = $1
         union all select s.created_at, 'contract', '', 'Contrato ' || s.number || ' formalizado', p.full_name from public.sales_contracts s left join public.user_profiles p on p.id = s.created_by where s.customer_id = $1
         union all select cp.recorded_at, 'payment', cp.status, 'Pago ' || cp.number || ' · ' || cp.currency || ' ' || cp.amount, p.full_name from public.customer_payments cp left join public.user_profiles p on p.id = cp.recorded_by where cp.customer_id = $1
         union all select ca.contacted_at, 'collection', ca.outcome, coalesce(ca.notes, ''), p.full_name from public.collection_actions ca join public.user_profiles p on p.id = ca.user_id where ca.customer_id = $1
         union all select a.created_at, 'appraisal', a.status, 'Tasación ' || a.number || ' · ' || a.make || ' ' || a.model, p.full_name from public.trade_in_appraisals a left join public.user_profiles p on p.id = a.appraiser_id where a.customer_id = $1
       ) x order by at desc limit 60`, [id]);
    return { c, contracts, deals, appraisals, reservations, upcoming, timeline };
  });
  if (!d) notFound();
  const { c } = d;
  const byCcy = (key: string) => {
    const m = new Map<string, number>();
    d.contracts.forEach((x) => { if (x[key] !== null) m.set(x.currency, (m.get(x.currency) ?? 0) + Number(x[key])); });
    return [...m.entries()];
  };
  const showFin = can(ctx, "receivable.read", "receivable.read_own");
  const amounts = (key: string) => byCcy(key).length ? byCcy(key).map(([ccy, v]) => <div key={ccy}><Money value={v} currency={ccy} /></div>) : "—";
  return (
    <>
      <PageHeader crumbs={[["/customers", "Clientes"]]} title={c.display_name}
        subtitle={<>{label(CUSTOMER_KIND, c.kind)} · ejecutivo {c.owner ?? "—"} · cliente desde {date(c.created_at)}</>}
        actions={<>
          {showFin && d.contracts.length > 0 && <LinkButton href={`/receivables/${id}`}>Estado de cuenta</LinkButton>}
          {can(ctx, "tradein.write") && <LinkButton href={`/appraisals/new?customer=${id}`}>Nueva tasación</LinkButton>}
          {can(ctx, "deal.write") && <LinkButton href={`/deals/new?customer=${id}`} variant="primary">Nueva operación</LinkButton>}
        </>} />

      <Panel className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-r [&>*]:border-line-soft">
          <Figure label="Compras" value={d.contracts.length} note={d.contracts.map((x) => x.units).join(" · ") || "Sin compras"} />
          <Figure label="En negociación" value={d.deals.filter((x) => ["draft", "pending_approval", "approved"].includes(x.status)).length} note={`${d.reservations.length} reserva(s) activa(s)`} />
          <Figure label="Pagado (confirmado)" value={showFin ? amounts("collected_confirmed") : "Sin acceso"} />
          <Figure label="Saldo pendiente" value={showFin ? amounts("outstanding") : "Sin acceso"} />
          <Figure label="Vencido" tone={byCcy("overdue_amount").some(([, v]) => v > 0) ? "risk" : undefined} value={showFin ? amounts("overdue_amount") : "Sin acceso"} />
          <Figure label="Próximo pago" value={showFin && d.upcoming[0] ? date(d.upcoming[0].due_date) : "—"} note={showFin && d.upcoming[0] ? money(d.upcoming[0].outstanding, d.upcoming[0].currency) : undefined} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Contratos">
            {d.contracts.length === 0 ? <Empty title="Sin contratos" /> : (
              <table className="mh-table"><thead><tr><th>Contrato</th><th>Fecha</th><th>Unidades</th><th className="r">Precio</th>{showFin && <><th className="r">Pendiente</th><th className="r">Vencido</th><th>Estado</th></>}</tr></thead>
                <tbody>{d.contracts.map((x) => (
                  <tr key={x.id}><td><Link href={`/contracts/${x.id}`} className="text-text hover:text-accent">{x.number}</Link></td><td className="num">{date(x.contract_date)}</td>
                    <td className="text-text-2">{x.units}</td><td className="r"><Money value={x.total_price} currency={x.currency} /></td>
                    {showFin && <><td className="r"><Money value={x.outstanding} currency={x.currency} /></td><td className="r"><Money value={x.overdue_amount} currency={x.currency} /></td><td><StatusBadge map={ACCOUNT_STATUS} value={x.account_status} /></td></>}</tr>
                ))}</tbody></table>
            )}
          </Panel>
          {showFin && d.upcoming.length > 0 && (
            <Panel title="Próximas obligaciones y cuotas vencidas">
              <table className="mh-table"><tbody>{d.upcoming.map((i) => (
                <tr key={i.id}><td>{i.number} · {i.label}</td><td className="num">{date(i.due_date)}</td><td className="r"><Money value={i.outstanding} currency={i.currency} /></td>
                  <td><StatusBadge map={{ overdue: ["Vencida", "risk"], partial: ["Parcial", "warn"], due_soon: ["Próxima", "info"], upcoming: ["Futura", "neutral"], paid: ["Pagada", "good"] }} value={i.payment_status} /></td></tr>
              ))}</tbody></table>
            </Panel>
          )}
          <Panel title="Negociaciones y tasaciones">
            {d.deals.length === 0 && d.appraisals.length === 0 ? <Empty title="Sin negociaciones visibles" /> : (
              <ul className="divide-y divide-line-soft">
                {d.deals.map((x) => (
                  <li key={x.id}><Link href={`/deals/${x.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-raised">
                    <span className="text-[13px]">{x.number} · <span className="text-text-2">{x.units}</span></span>
                    <span className="flex items-center gap-2"><Money value={x.total} currency={x.currency} /><StatusBadge map={DEAL_STATUS} value={x.status} /></span></Link></li>
                ))}
                {d.appraisals.map((a) => (
                  <li key={a.id}><Link href={`/appraisals/${a.id}`} className="flex items-center justify-between px-4 py-2 hover:bg-raised">
                    <span className="text-[13px]">Tasación {a.number} · <span className="text-text-2">{a.make} {a.model} {a.year_built}</span></span>
                    <StatusBadge map={APPRAISAL_STATUS} value={a.status} /></Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Cronología unificada" subtitle="Interacciones, operaciones, pagos, cobranzas y tasaciones">
            {d.timeline.length === 0 ? <Empty title="Sin actividad" /> : (
              <ol className="max-h-[480px] divide-y divide-line-soft overflow-y-auto">
                {d.timeline.map((t, i) => (
                  <li key={i} className="grid grid-cols-[132px_1fr] gap-3 px-4 py-2 text-[13px]">
                    <span className="num text-xs text-faint">{dateTime(t.at)}</span>
                    <span><span className="text-xs uppercase tracking-wider text-muted">{{ interaction: "Interacción", deal: "Operación", contract: "Contrato", payment: "Pago", collection: "Cobranza", appraisal: "Tasación" }[t.t as string]}</span>{" "}
                      <span className="text-text">{t.t === "interaction" ? `${KIND_TEXT[t.k.split(" · ")[0]] ?? ""} (${label(CHANNEL, t.k.split(" · ")[1])})` : t.t === "deal" ? label(Object.fromEntries(Object.entries(DEAL_STATUS).map(([k, v]) => [k, v[0]])), t.k) : t.t === "payment" ? label(Object.fromEntries(Object.entries(PAYMENT_STATUS).map(([k, v]) => [k, v[0]])), t.k) : t.t === "collection" ? label(OUTCOME, t.k) : ""}</span>
                      <span className="text-text-2"> {t.txt}</span>{t.who && <span className="text-faint"> · {t.who}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Datos del cliente">
            <div className="px-4 py-3">
              <Facts items={[["Correo", c.email], ["Teléfono", c.phone], ["Ciudad", c.city], ["País", c.country], ["Razón social", c.legal_name], ["Tipo de documento", c.document_type ?? "—"]]} />
              {c.notes && <p className="mt-3 text-xs text-muted">{c.notes}</p>}
            </div>
            {can(ctx, "customer.pii.read") && (
              <ActionForm action={revealPiiAction} className="border-t border-line-soft px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <Submit variant="ghost" size="sm">Ver documento y dirección (auditado)</Submit>
              </ActionForm>
            )}
            {can(ctx, "customer.write") && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Editar expediente</summary>
                <ActionForm action={updateCustomerAction} className="mt-3 grid grid-cols-2 gap-2">
                  <input type="hidden" name="id" value={id} />
                  <Field label="Tipo" name="kind"><Select name="kind" defaultValue={c.kind} options={Object.entries(CUSTOMER_KIND)} /></Field>
                  <Field label="Estado" name="status"><Select name="status" defaultValue={c.status} options={[["active", "Activo"], ["prospect", "Prospecto"], ["inactive", "Inactivo"]]} /></Field>
                  <Field label="Nombre" name="display_name"><Input name="display_name" defaultValue={c.display_name} /></Field>
                  <Field label="Razón social" name="legal_name"><Input name="legal_name" defaultValue={c.legal_name ?? ""} /></Field>
                  <Field label="Correo" name="email"><Input name="email" defaultValue={c.email ?? ""} /></Field>
                  <Field label="Teléfono" name="phone"><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
                  <Field label="Ciudad" name="city"><Input name="city" defaultValue={c.city ?? ""} /></Field>
                  <Field label="País" name="country"><Input name="country" defaultValue={c.country ?? ""} /></Field>
                  <Field label="Notas" name="notes" className="col-span-2"><Textarea name="notes" defaultValue={c.notes ?? ""} /></Field>
                  <div className="col-span-2"><Submit variant="secondary">Guardar</Submit></div>
                </ActionForm>
              </details>
            )}
          </Panel>
          {can(ctx, "customer.write") && (
            <Panel title="Registrar interacción">
              <ActionForm action={addInteractionAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Tipo" name="kind"><Select name="kind" options={Object.entries(KIND_TEXT)} /></Field>
                <Field label="Canal" name="channel"><Select name="channel" options={Object.entries(CHANNEL).filter(([k]) => k !== "letter")} /></Field>
                <Field label="Resumen" name="summary" className="col-span-2"><Textarea name="summary" rows={3} /></Field>
                <div className="col-span-2"><Submit variant="secondary">Registrar</Submit></div>
              </ActionForm>
            </Panel>
          )}
          {d.reservations.length > 0 && (
            <Panel title="Reservas activas">
              <ul className="divide-y divide-line-soft">{d.reservations.map((r) => (
                <li key={r.id} className="px-4 py-2 text-[13px]"><Link href={`/inventory/${r.unit_id}`} className="text-text hover:text-accent">{r.stock_number} · {r.make} {r.model}</Link><div className="text-xs text-muted">Vence {dateTime(r.expires_at)}</div></li>
              ))}</ul>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
