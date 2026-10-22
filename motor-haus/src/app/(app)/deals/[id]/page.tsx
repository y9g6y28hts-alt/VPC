import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { getDealEconomics } from "@/server/services/financing";
import { PageHeader, Panel, Empty, Facts } from "@/components/ui/Layout";
import { Badge, StatusBadge, Basis } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { APPROVAL_STATUS, DEAL_STATUS, RATE_TYPE, RULE, SYSTEM, label } from "@/lib/labels";
import { date, dateTime, money, num } from "@/lib/format";
import { ScenarioBuilder } from "../ScenarioBuilder";
import {
  addUnitAction, attachTradeInAction, cancelDealAction, detachTradeInAction, formalizeAction, issueProposalAction,
  removeUnitAction, reserveForDealAction, selectPlanAction, submitDealAction, updateTermsAction,
} from "../actions";

export const metadata = { title: "Mesa de negociación" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function DealDeskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const data = await query(ctx, async (db) => {
    const deal = await db.maybe<R>(
      `select d.*, c.display_name customer, c.email customer_email, c.phone customer_phone, p.full_name salesperson
         from public.deals d join public.customers c on c.id = d.customer_id join public.user_profiles p on p.id = d.salesperson_id where d.id = $1`, [id]);
    if (!deal) return null;
    const e = await getDealEconomics(db, id);
    const policy = await db.one<R>("select * from public.org_policies where organization_id = $1", [ctx.org.id]);
    const plans = await db.rows<R>(
      `select p.id, p.label, p.status, v.version, v.inputs, v.summary, v.schedule, v.engine_version, v.checksum, v.created_at
         from public.financing_plans p join public.financing_plan_versions v on v.plan_id = p.id and v.version = p.current_version
        where p.deal_id = $1 order by p.created_at`, [id]);
    const approvals = await db.rows<R>(
      `select a.*, r.full_name requester, x.full_name decider from public.approvals a
         left join public.user_profiles r on r.id = a.requested_by left join public.user_profiles x on x.id = a.decided_by
        where a.entity_type = 'deal' and a.entity_id = $1 order by a.requested_at desc`, [id]);
    const appraisals = await db.rows<R>(
      "select id, number, make, model, year_built, status, max_authorized_price, currency from public.trade_in_appraisals where customer_id = $1 and status = 'approved' and (deal_id is null or deal_id = $2)",
      [deal.customer_id, id]);
    const availableUnits = await db.rows<R>(
      "select id, stock_number, make, model, list_price from public.units where organization_id = $1 and commercial_status = 'available' and currency = $2 order by make", [ctx.org.id, deal.currency]);
    const reservations = await db.rows<R>("select r.*, u.stock_number from public.reservations r join public.units u on u.id = r.unit_id where r.deal_id = $1 and r.status = 'active'", [id]);
    const unitStatus = await db.rows<R>("select u.id, u.commercial_status from public.units u join public.deal_items i on i.unit_id = u.id where i.deal_id = $1", [id]);
    const docs = await db.rows<R>("select id, number, kind, status, issued_at from public.documents where entity_type = 'deal' and entity_id = $1 order by issued_at desc", [id]);
    const contract = await db.maybe<R>("select id, number from public.sales_contracts where deal_id = $1", [id]);
    return { deal, e, policy, plans, approvals, appraisals, availableUnits, reservations, unitStatus, docs, contract };
  });
  if (!data) notFound();
  const { deal, e, policy, plans, approvals } = data;
  const ccy = deal.currency as string;
  const editable = !["formalized", "cancelled"].includes(deal.status) && can(ctx, "deal.write");
  const principal = Number(e.financed_principal);
  const selected = plans.find((p) => p.id === deal.selected_plan_id);
  const planStale = selected && Number(selected.inputs.principal) !== principal;

  // Vista previa de reglas (la evaluación vinculante ocurre en submit_deal en el servidor)
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [
    ...e.items.map((it) => ({ label: `Precio mínimo ${it.stock_number}`, ok: Number(it.negotiated_price) >= Number(it.minimum_price),
      detail: `${money(it.negotiated_price, ccy)} vs mínimo ${money(it.minimum_price, ccy)}` })),
    { label: "Descuento", ok: Number(e.discount_pct) <= Number(policy.max_discount_pct), detail: `${num(e.discount_pct, 2)} % (límite ${num(policy.max_discount_pct, 2)} %)` },
    { label: "Margen bruto estimado", ok: e.gross_margin_pct !== null && Number(e.gross_margin_pct) >= Number(policy.min_margin_pct),
      detail: e.units_missing_purchase_cost > 0 ? "Falta precio de compra: no calculable" : `${num(e.gross_margin_pct, 2)} % (mínimo ${num(policy.min_margin_pct, 2)} %)` },
    ...e.trade_ins.map((t) => ({ label: `Trade-in ${t.number}`, ok: Number(t.accepted_value) <= Number(t.max_authorized ?? 0),
      detail: `Aceptado ${money(t.accepted_value, ccy)} vs máximo ${money(t.max_authorized, ccy)}` })),
    ...(selected ? [
      { label: "Plazo", ok: selected.inputs.termPeriods * selected.inputs.monthsPerPeriod <= policy.max_financing_months,
        detail: `${selected.inputs.termPeriods * selected.inputs.monthsPerPeriod} meses (máximo ${policy.max_financing_months})` },
      { label: "Tasa", ok: Number(selected.summary.effectiveAnnualRate) >= Number(policy.min_effective_annual_rate),
        detail: `TEA ${num(Number(selected.summary.effectiveAnnualRate) * 100, 2)} % (mínimo ${num(Number(policy.min_effective_annual_rate) * 100, 2)} %)` },
    ] : []),
  ];
  const pendingApprovals = approvals.filter((a) => a.status === "pending");

  return (
    <>
      <PageHeader crumbs={[["/deals", "Mesa de negociación"]]}
        title={<span className="flex flex-wrap items-center gap-2">{deal.number} <StatusBadge map={DEAL_STATUS} value={deal.status} /></span>}
        subtitle={<><Link href={`/customers/${deal.customer_id}`} className="text-text-2 hover:text-accent">{deal.customer}</Link> · vendedor {deal.salesperson} · propuesta válida hasta {date(deal.proposal_valid_until)}</>}
        actions={<>
          {data.contract && <Link href={`/contracts/${data.contract.id}`} className="text-sm text-accent">Contrato {data.contract.number} →</Link>}
          {editable && ["draft", "rejected"].includes(deal.status) && (
            <ActionForm action={submitDealAction} hideMessage={false}><input type="hidden" name="deal" value={id} /><Submit>Enviar a aprobación</Submit></ActionForm>
          )}
          {deal.status === "approved" && can(ctx, "deal.formalize") && (
            <ActionForm action={formalizeAction}>
              <input type="hidden" name="deal" value={id} />
              <ConfirmSubmit label="Formalizar operación" confirmLabel="Formalizar y generar obligaciones" fields={[]}
                warning={`Se creará el contrato, se marcará la unidad como vendida y se emitirán ${selected ? selected.inputs.termPeriods : 0} cuota(s) más las entregas iniciales. La disponibilidad se verifica nuevamente al confirmar.`} />
            </ActionForm>
          )}
        </>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Unidades y precio" subtitle="El precio negociado se valida contra el mínimo autorizado de cada unidad">
            <ActionForm action={updateTermsAction} className="">
              <input type="hidden" name="deal" value={id} /><input type="hidden" name="version" value={deal.row_version} />
              <div className="overflow-x-auto">
                <table className="mh-table">
                  <thead><tr><th>Unidad</th><th className="r">Lista</th><th className="r">Mínimo</th><th className="r">Negociado</th><th className="r">Descuento</th></tr></thead>
                  <tbody>
                    {e.items.map((it) => (
                      <tr key={it.unit_id}>
                        <td><Link href={`/inventory/${it.unit_id}`} className="text-text hover:text-accent">{it.title}</Link><div className="text-xs text-muted">{it.stock_number} · {it.year}</div></td>
                        <td className="r"><Money value={it.list_price} currency={ccy} /></td>
                        <td className="r"><Money value={it.minimum_price} currency={ccy} muted /></td>
                        <td className="r w-40">{editable ? <Input name={`price_${it.unit_id}`} inputMode="decimal" defaultValue={Number(it.negotiated_price).toFixed(2)} /> : <Money value={it.negotiated_price} currency={ccy} />}</td>
                        <td className="r"><Money value={it.discount} currency={ccy} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {editable && (
                <div className="grid grid-cols-2 gap-2 border-t border-line-soft px-4 py-3 md:grid-cols-4">
                  <Field label="Entrega en efectivo" name="cash_down"><Input name="cash_down" inputMode="decimal" defaultValue={Number(deal.cash_down_payment).toFixed(2)} /></Field>
                  <Field label="Otros créditos iniciales" name="other_credits"><Input name="other_credits" inputMode="decimal" defaultValue={Number(deal.other_credits).toFixed(2)} /></Field>
                  <Field label="Concepto de otros créditos" name="other_credits_note"><Input name="other_credits_note" defaultValue={deal.other_credits_note ?? ""} placeholder="Obligatorio si hay importe" /></Field>
                  <Field label="Vigencia de propuesta" name="valid_until"><Input type="date" name="valid_until" min={ctx.today} defaultValue={deal.proposal_valid_until ?? ""} /></Field>
                  <Field label="Cargos financiados" name="financed_charges" hint="Se suman al capital solo si se cargan aquí"><Input name="financed_charges" inputMode="decimal" defaultValue={Number(deal.financed_charges).toFixed(2)} /></Field>
                  <Field label="Concepto de cargos" name="financed_charges_note"><Input name="financed_charges_note" defaultValue={deal.financed_charges_note ?? ""} /></Field>
                  <Field label="Notas internas" name="notes" className="col-span-2"><Input name="notes" defaultValue={deal.notes ?? ""} /></Field>
                  <div className="col-span-2 md:col-span-4"><Submit variant="secondary">Guardar términos</Submit></div>
                </div>
              )}
            </ActionForm>
            {editable && e.items.length > 1 && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Quitar una unidad</summary>
                <ActionForm action={removeUnitAction} className="mt-2 flex items-end gap-2">
                  <input type="hidden" name="deal" value={id} />
                  <Field label="Unidad" name="unit" className="flex-1"><Select name="unit" options={e.items.map((it) => [it.unit_id, `${it.stock_number} · ${it.title}`])} /></Field>
                  <Submit variant="ghost">Quitar</Submit>
                </ActionForm>
              </details>
            )}
            {editable && data.availableUnits.length > 0 && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Agregar otra unidad a la operación</summary>
                <ActionForm action={addUnitAction} className="mt-2 flex items-end gap-2">
                  <input type="hidden" name="deal" value={id} />
                  <Field label="Unidad disponible" name="unit" className="flex-1"><Select name="unit" options={data.availableUnits.map((u) => [u.id, `${u.stock_number} · ${u.make} ${u.model} · ${money(u.list_price, ccy)}`])} /></Field>
                  <Submit variant="secondary">Agregar</Submit>
                </ActionForm>
              </details>
            )}
          </Panel>

          <Panel title="Vehículos recibidos como parte de pago" subtitle="Solo se incorporan tasaciones aprobadas del mismo cliente; su margen se informa por separado">
            {e.trade_ins.length === 0 ? <Empty title="Sin trade-in en esta operación" /> : (
              <table className="mh-table">
                <thead><tr><th>Tasación</th><th className="r">Valor aceptado</th><th className="r">Máx. autorizado</th><th className="r">Cancelación prenda</th><th className="r">Crédito neto</th><th className="r">Margen reventa est.</th><th></th></tr></thead>
                <tbody>
                  {e.trade_ins.map((t) => (
                    <tr key={t.appraisal_id}>
                      <td><Link href={`/appraisals/${t.appraisal_id}`} className="text-text hover:text-accent">{t.title}</Link><div className="text-xs text-muted">{t.number}</div></td>
                      <td className="r"><Money value={t.accepted_value} currency={ccy} /></td>
                      <td className="r"><Money value={t.max_authorized} currency={ccy} muted /></td>
                      <td className="r"><Money value={t.lien_payoff} currency={ccy} /></td>
                      <td className="r"><Money value={t.net_credit} currency={ccy} /></td>
                      <td className="r"><Money value={t.estimated_margin} currency={ccy} /></td>
                      <td>{editable && <ActionForm action={detachTradeInAction} hideMessage><input type="hidden" name="deal" value={id} /><input type="hidden" name="appraisal" value={t.appraisal_id} /><Submit size="sm" variant="ghost">Quitar</Submit></ActionForm>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {editable && (data.appraisals.filter((a) => !e.trade_ins.some((t) => t.appraisal_id === a.id)).length > 0 ? (
              <ActionForm action={attachTradeInAction} className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
                <input type="hidden" name="deal" value={id} />
                <Field label="Tasación aprobada" name="appraisal" className="min-w-64 flex-1"><Select name="appraisal" options={data.appraisals.filter((a) => !e.trade_ins.some((t) => t.appraisal_id === a.id)).map((a) => [a.id, `${a.number} · ${a.make} ${a.model} ${a.year_built ?? ""} · máx. ${money(a.max_authorized_price, a.currency)}`])} /></Field>
                <Field label="Valor aceptado" name="accepted"><Input name="accepted" inputMode="decimal" /></Field>
                <Submit variant="secondary">Incorporar</Submit>
              </ActionForm>
            ) : <p className="border-t border-line-soft px-4 py-2.5 text-xs text-muted">No hay tasaciones aprobadas disponibles para este cliente. <Link href={`/appraisals/new?customer=${deal.customer_id}&deal=${id}`} className="text-accent">Iniciar tasación →</Link></p>)}
          </Panel>

          <Panel title="Escenarios de financiación" subtitle={`Capital a financiar ${money(principal, ccy)} · fórmula del capital en el panel de economía`}>
            {plans.length === 0 ? <Empty title="Sin escenarios guardados" hint={principal > 0 ? "Configure y guarde uno o más escenarios para compararlos." : undefined} /> : (
              <div className="overflow-x-auto">
                <table className="mh-table">
                  <thead><tr><th>Escenario</th><th>Sistema</th><th>Tasa</th><th className="r">Plazo</th><th className="r">Cuota</th><th className="r">Refuerzos</th><th className="r">Interés total</th><th className="r">Total financiado</th><th></th></tr></thead>
                  <tbody>
                    {plans.map((p) => {
                      const stale = Number(p.inputs.principal) !== principal;
                      return (
                        <tr key={p.id} className={p.status === "discarded" ? "opacity-50" : ""}>
                          <td><div className="text-text">{p.label}</div><div className="text-xs text-faint">v{p.version} · {p.engine_version}{stale && <span className="text-warn"> · capital desactualizado</span>}</div></td>
                          <td className="text-text-2">{label(SYSTEM, p.inputs.system)}</td>
                          <td className="text-text-2">{p.inputs.system === "zero_interest" ? "0 %" : `${num(Number(p.inputs.rate) * 100, 2)} % ${label(RATE_TYPE, p.inputs.rateType).split(" ")[0]}`}</td>
                          <td className="r num">{p.inputs.termPeriods} × {p.inputs.monthsPerPeriod}m</td>
                          <td className="r"><Money value={p.summary.installmentAmount} currency={ccy} /></td>
                          <td className="r"><Money value={p.summary.totalBalloons} currency={ccy} /></td>
                          <td className="r"><Money value={p.summary.totalInterest} currency={ccy} /></td>
                          <td className="r"><Money value={p.summary.totalPayments} currency={ccy} /></td>
                          <td className="whitespace-nowrap">
                            {p.id === deal.selected_plan_id ? <Badge tone="accent">Seleccionado</Badge> : editable && !stale && (
                              <ActionForm action={selectPlanAction} hideMessage><input type="hidden" name="deal" value={id} /><input type="hidden" name="plan" value={p.id} /><Submit size="sm" variant="secondary">Seleccionar</Submit></ActionForm>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {selected && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Calendario del escenario seleccionado ({selected.schedule.length} cuotas) · checksum {String(selected.checksum).slice(0, 12)}…</summary>
                <div className="mt-2 max-h-80 overflow-y-auto">
                  <table className="mh-table">
                    <thead><tr><th>#</th><th>Vencimiento</th><th className="r">Saldo inicial</th><th className="r">Interés</th><th className="r">Amortización</th><th className="r">Refuerzo</th><th className="r">Cuota</th><th className="r">Saldo final</th></tr></thead>
                    <tbody>{selected.schedule.map((r: R) => (
                      <tr key={r.period}><td className="num">{r.period}</td><td className="num">{date(r.dueDate)}</td><td className="r"><Money value={r.openingBalance} currency={ccy} /></td>
                        <td className="r"><Money value={r.interest} currency={ccy} /></td><td className="r"><Money value={r.principal} currency={ccy} /></td>
                        <td className="r">{Number(r.balloon) ? <Money value={r.balloon} currency={ccy} /> : "—"}</td><td className="r"><Money value={r.payment} currency={ccy} /></td>
                        <td className="r"><Money value={r.closingBalance} currency={ccy} /></td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </details>
            )}
            {editable && <div className="border-t border-line-soft"><ScenarioBuilder dealId={id} principal={String(principal)} currency={ccy} today={ctx.today} nextLabel={`Escenario ${String.fromCharCode(65 + plans.length)}`} /></div>}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4 xl:sticky xl:top-4 xl:self-start">
          <Panel title="Economía de la operación" subtitle="Calculada en el servidor con los costes registrados">
            <table className="mh-table">
              <tbody>
                <Row k="Precio de lista" v={<Money value={e.total_list} currency={ccy} />} />
                <Row k="Descuento" v={<><Money value={e.discount_amount} currency={ccy} /> · <Pct value={e.discount_pct} digits={2} /></>} />
                <Row k="Precio negociado" v={<Money value={e.total_negotiated} currency={ccy} />} strong />
                <Row k={<>Coste real de la unidad <Basis kind="real" /></>} v={<Money value={e.cost_actual} currency={ccy} />} />
                <Row k={<>Costes estimados pendientes <Basis kind="estimado" /></>} v={<Money value={e.cost_estimated_pending} currency={ccy} />} />
                <Row k="Margen bruto estimado (unidad vendida)" v={<><Money value={e.gross_margin_estimated} currency={ccy} /> · <Pct value={e.gross_margin_pct} digits={2} /></>} strong />
                <Row k="Margen solo con costes reales" v={<Money value={e.gross_margin_actual_costs_only} currency={ccy} muted />} />
              </tbody>
            </table>
            <div className="border-t border-line-soft px-4 pb-1 pt-3 text-[11px] uppercase tracking-wider text-faint">Capital a financiar</div>
            <table className="mh-table">
              <tbody>
                <Row k="Precio negociado" v={<Money value={e.total_negotiated} currency={ccy} />} />
                <Row k="+ Cargos financiados" v={<Money value={e.financed_charges} currency={ccy} />} />
                <Row k="− Crédito neto trade-in" v={<Money value={e.trade_in_credit} currency={ccy} />} />
                <Row k="− Entrega en efectivo" v={<Money value={e.cash_down_payment} currency={ccy} />} />
                <Row k="− Otros créditos" v={<Money value={e.other_credits} currency={ccy} />} />
                <Row k="= Capital financiado" v={<Money value={e.financed_principal} currency={ccy} />} strong />
              </tbody>
            </table>
            {e.trade_ins.length > 0 && (
              <p className="border-t border-line-soft px-4 py-2.5 text-xs text-muted">
                Margen estimado de reventa del trade-in: <Money value={e.trade_in_estimated_margin} currency={ccy} /> <Basis kind="estimado" /> — no realizado, no se suma al margen de la venta.
              </p>
            )}
            {selected && (
              <p className="border-t border-line-soft px-4 py-2.5 text-xs text-muted">
                Plan seleccionado «{selected.label}»: {selected.inputs.termPeriods} cuotas de <Money value={selected.summary.installmentAmount} currency={ccy} />, interés total <Money value={selected.summary.totalInterest} currency={ccy} />.
                {planStale && <span className="block text-warn">El capital cambió: recalcule el plan antes de enviar.</span>}
              </p>
            )}
          </Panel>

          <Panel title="Políticas y autorizaciones" subtitle="Vista previa; la evaluación vinculante ocurre en el servidor al enviar">
            <ul className="divide-y divide-line-soft">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]">
                  <span><span className="text-text">{c.label}</span><span className="block text-xs text-muted">{c.detail}</span></span>
                  {c.ok ? <Badge tone="good">Dentro de política</Badge> : <Badge tone="warn">Requiere autorización</Badge>}
                </li>
              ))}
            </ul>
            {approvals.length > 0 && (
              <div className="border-t border-line-soft">
                <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-wider text-faint">Solicitudes</div>
                <ul className="divide-y divide-line-soft">
                  {approvals.map((a) => (
                    <li key={a.id} className="px-4 py-2 text-xs">
                      <div className="flex items-center justify-between gap-2"><span className="text-text">{label(RULE, a.rule)}: {a.message}</span><StatusBadge map={APPROVAL_STATUS} value={a.status} /></div>
                      <div className="text-faint">Solicitó {a.requester} · {dateTime(a.requested_at)}{a.decider && ` · decidió ${a.decider}: ${a.decision_note}`}</div>
                    </li>
                  ))}
                </ul>
                {pendingApprovals.length > 0 && can(ctx, "deal.approve") && <Link href="/approvals" className="block px-4 py-2 text-xs text-accent">Ir a la bandeja de aprobaciones →</Link>}
              </div>
            )}
          </Panel>

          <Panel title="Propuesta y reserva">
            <div className="space-y-3 px-4 py-3">
              {can(ctx, "document.issue") && !["formalized", "cancelled"].includes(deal.status) && (
                <ActionForm action={issueProposalAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="deal" value={id} />
                  {principal > 0 && <Field label="Plan a incluir" name="plan" className="min-w-48 flex-1"><Select name="plan" defaultValue={deal.selected_plan_id ?? ""} options={plans.filter((p) => Number(p.inputs.principal) === principal).map((p) => [p.id, p.label])} /></Field>}
                  <Submit variant="secondary">Emitir propuesta PDF</Submit>
                </ActionForm>
              )}
              <p className="text-xs text-faint">La propuesta indica su estado de aprobación; no es contrato ni aprobación de crédito.</p>
              {data.docs.length > 0 && (
                <ul className="text-xs">{data.docs.map((d) => (
                  <li key={d.id}><Link href={`/documents/${d.id}`} className="text-text-2 hover:text-accent">{d.number}</Link> <span className="text-faint">· {dateTime(d.issued_at)} · {d.status === "issued" ? "vigente" : "reemplazada"}</span></li>
                ))}</ul>
              )}
              {data.reservations.length > 0 ? data.reservations.map((r) => (
                <p key={r.id} className="text-xs text-muted">Reserva activa {r.stock_number} hasta {dateTime(r.expires_at)}</p>
              )) : editable && can(ctx, "reservation.write") && data.unitStatus.some((u) => u.commercial_status === "available") && (
                <ActionForm action={reserveForDealAction} className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="deal" value={id} /><input type="hidden" name="customer" value={deal.customer_id} />
                  <Field label="Reservar unidad" name="unit"><Select name="unit" options={e.items.filter((it) => data.unitStatus.find((u) => u.id === it.unit_id)?.commercial_status === "available").map((it) => [it.unit_id, it.stock_number])} /></Field>
                  <Field label="Horas" name="hours"><Input name="hours" type="number" defaultValue={policy.reservation_default_hours} /></Field>
                  <Field label="Condiciones" name="conditions" className="col-span-2"><Textarea name="conditions" rows={2} /></Field>
                  <div className="col-span-2"><Submit variant="secondary">Reservar</Submit></div>
                </ActionForm>
              )}
            </div>
          </Panel>

          {!["formalized", "cancelled"].includes(deal.status) && (can(ctx, "deal.cancel") || deal.status === "draft") && (
            <details className="rounded-md border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-risk">Cancelar operación</summary>
              <ActionForm action={cancelDealAction} className="mt-2 flex items-end gap-2">
                <input type="hidden" name="deal" value={id} />
                <Field label="Motivo" name="reason" className="flex-1"><Input name="reason" /></Field>
                <Submit variant="danger">Cancelar</Submit>
              </ActionForm>
            </details>
          )}
          <Panel title="Cliente">
            <div className="px-4 py-3"><Facts items={[["Nombre", deal.customer], ["Correo", deal.customer_email], ["Teléfono", deal.customer_phone], ["Moneda", ccy]]} /></div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Row({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <tr>
      <td className={strong ? "text-text" : "text-text-2"}><span className="flex items-center gap-1.5">{k}</span></td>
      <td className={`r ${strong ? "font-semibold text-text" : ""}`}>{v}</td>
    </tr>
  );
}

