import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Facts } from "@/components/ui/Layout";
import { Badge, Basis, StatusBadge } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { APPRAISAL_STATUS, APPROVAL_STATUS, CATEGORY, RULE, label } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";
import {
  acquireAction, addCostAction, closeAppraisalAction, inspectionAction, removeCostAction, reportAction, submitAppraisalAction, valueAction,
} from "../actions";

export const metadata = { title: "Tasación" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;
const ITEMS = ["Motor y transmisión", "Frenos y suspensión", "Carrocería", "Interior", "Neumáticos", "Electrónica", "Historial de servicio", "Documentación"];
const CONDITIONS: Array<[string, string]> = [["excellent", "Excelente"], ["good", "Bueno"], ["fair", "Regular"], ["poor", "Malo"]];

export default async function AppraisalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const a = await db.maybe<R>(
      `select a.*, c.display_name customer, p.full_name appraiser, dl.number deal_number
         from public.trade_in_appraisals a join public.customers c on c.id = a.customer_id left join public.user_profiles p on p.id = a.appraiser_id
         left join public.deals dl on dl.id = a.deal_id where a.id = $1`, [id]);
    if (!a) return null;
    return {
      a,
      inspection: await db.rows<R>("select * from public.appraisal_inspections where appraisal_id = $1", [id]),
      costs: await db.rows<R>("select * from public.appraisal_costs where appraisal_id = $1 order by created_at", [id]),
      approvals: await db.rows<R>("select a.*, x.full_name decider from public.approvals a left join public.user_profiles x on x.id = a.decided_by where entity_type = 'trade_in_appraisal' and entity_id = $1 order by requested_at desc", [id]),
      locations: await db.rows<R>("select id, name from public.locations where organization_id = $1 and active order by name", [ctx.org.id]),
      policy: await db.one<R>("select min_margin_pct from public.org_policies where organization_id = $1", [ctx.org.id]),
    };
  });
  if (!d) notFound();
  const { a } = d;
  const ccy = a.currency;
  const recon = d.costs.reduce((s, c) => s + Number(c.amount), 0);
  const totalCost = a.proposed_acquisition_price !== null ? Number(a.proposed_acquisition_price) + recon : null;
  const margin = totalCost !== null && a.expected_resale_price !== null ? Number(a.expected_resale_price) - totalCost : null;
  const marginPct = margin !== null && Number(a.expected_resale_price) > 0 ? (margin / Number(a.expected_resale_price)) * 100 : null;
  const editable = ["draft", "inspected", "valued"].includes(a.status) && can(ctx, "tradein.write");
  const insp = new Map(d.inspection.map((i) => [i.item, i]));
  return (
    <>
      <PageHeader crumbs={[["/appraisals", "Tasaciones"]]}
        title={<span className="flex items-center gap-2">{a.make} {a.model} {a.version ?? ""} {a.year_built ?? ""} <StatusBadge map={APPRAISAL_STATUS} value={a.status} /></span>}
        subtitle={<>{a.number} · <Link href={`/customers/${a.customer_id}`} className="text-text-2 hover:text-accent">{a.customer}</Link> · tasador {a.appraiser}{a.deal_number && <> · <Link href={`/deals/${a.deal_id}`} className="text-accent">operación {a.deal_number}</Link></>}</>}
        actions={<>
          {a.status === "valued" && can(ctx, "tradein.write") && <ActionForm action={submitAppraisalAction}><input type="hidden" name="id" value={id} /><Submit>Enviar a autorización</Submit></ActionForm>}
          {can(ctx, "document.issue") && a.status !== "draft" && <ActionForm action={reportAction}><input type="hidden" name="id" value={id} /><Submit variant="secondary">Informe PDF</Submit></ActionForm>}
        </>} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Inspección" subtitle="Checklist técnico y estado documental">
            {editable ? (
              <ActionForm action={inspectionAction} className="px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <table className="mh-table"><thead><tr><th>Ítem</th><th>Resultado</th><th>Observaciones</th></tr></thead>
                  <tbody>{ITEMS.map((it) => (
                    <tr key={it}><td className="text-text-2">{it}</td>
                      <td className="w-40"><Select name={`res_${it}`} defaultValue={insp.get(it)?.result ?? ""} placeholder="—" options={[["ok", "Correcto"], ["attention", "Atención"], ["fail", "Falla"], ["not_checked", "No verificado"]]} /></td>
                      <td><Input name={`note_${it}`} defaultValue={insp.get(it)?.notes ?? ""} /></td></tr>
                  ))}</tbody></table>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Field label="Carrocería" name="body_condition"><Select name="body_condition" defaultValue={a.body_condition ?? ""} placeholder="—" options={CONDITIONS} /></Field>
                  <Field label="Interior" name="interior_condition"><Select name="interior_condition" defaultValue={a.interior_condition ?? ""} placeholder="—" options={CONDITIONS} /></Field>
                  <Field label="Neumáticos" name="tires_condition"><Select name="tires_condition" defaultValue={a.tires_condition ?? ""} placeholder="—" options={CONDITIONS} /></Field>
                  <Field label="Mecánica" name="mechanical_condition"><Select name="mechanical_condition" defaultValue={a.mechanical_condition ?? ""} placeholder="—" options={CONDITIONS} /></Field>
                  <Field label="Documentación" name="documentation_status"><Select name="documentation_status" defaultValue={a.documentation_status} options={[["pending", "Pendiente"], ["incomplete", "Incompleta"], ["complete", "Completa"], ["issues", "Con observaciones"]]} /></Field>
                  <Field label="Informe del perito" name="inspector_report" className="col-span-2 md:col-span-5"><Textarea name="inspector_report" rows={2} defaultValue={a.inspector_report ?? ""} /></Field>
                </div>
                <div className="mt-3"><Submit variant="secondary">Guardar inspección</Submit></div>
              </ActionForm>
            ) : d.inspection.length === 0 ? <Empty title="Sin inspección registrada" /> : (
              <table className="mh-table"><tbody>{d.inspection.map((i) => <tr key={i.id}><td>{i.item}</td><td><Badge tone={i.result === "ok" ? "good" : i.result === "fail" ? "risk" : "warn"}>{i.result}</Badge></td><td className="text-text-2">{i.notes}</td></tr>)}</tbody></table>
            )}
          </Panel>
          <Panel title="Costes de reacondicionamiento estimados">
            {d.costs.length === 0 ? <Empty title="Sin costes estimados" /> : (
              <table className="mh-table"><tbody>{d.costs.map((c) => (
                <tr key={c.id}><td className="text-text-2">{c.concept}</td><td>{c.description}</td><td className="r"><Money value={c.amount} currency={ccy} /></td>
                  <td className="w-16">{editable && <ActionForm action={removeCostAction} hideMessage><input type="hidden" name="id" value={id} /><input type="hidden" name="cost" value={c.id} /><Submit size="sm" variant="ghost">Quitar</Submit></ActionForm>}</td></tr>
              ))}</tbody><tfoot><tr><td colSpan={2}>Total estimado</td><td className="r"><Money value={recon} currency={ccy} /></td><td /></tr></tfoot></table>
            )}
            {editable && (
              <ActionForm action={addCostAction} resetOnSuccess className="grid grid-cols-2 gap-2 border-t border-line-soft px-4 py-3 md:grid-cols-4">
                <input type="hidden" name="id" value={id} />
                <Field label="Concepto" name="concept"><Select name="concept" options={[["reconditioning", "Reacondicionamiento"], ["repairs", "Reparaciones"], ["tires", "Neumáticos"], ["documentation", "Documentación"], ["transport", "Traslado"], ["preparation", "Preparación"], ["other", "Otro"]]} /></Field>
                <Field label="Importe" name="amount"><Input name="amount" inputMode="decimal" /></Field>
                <Field label="Descripción" name="description"><Input name="description" /></Field>
                <div className="flex items-end"><Submit variant="secondary">Agregar</Submit></div>
              </ActionForm>
            )}
          </Panel>
          {editable && a.status !== "draft" && (
            <Panel title="Valoración económica" subtitle="El valor de mercado es una estimación del tasador: siempre con fuente y fecha. No se infiere de marca, año y kilometraje.">
              <ActionForm action={valueAction} className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4">
                <input type="hidden" name="id" value={id} />
                <Field label="Valor de mercado estimado" name="market_value"><Input name="market_value" inputMode="decimal" defaultValue={a.market_value_estimate ?? ""} /></Field>
                <Field label="Fuente" name="market_source" className="md:col-span-2"><Input name="market_source" defaultValue={a.market_value_source ?? ""} placeholder="Comparables, cotización de mayorista…" /></Field>
                <Field label="Fecha de referencia" name="market_date"><Input type="date" name="market_date" max={ctx.today} defaultValue={a.market_value_date ?? ctx.today} /></Field>
                <Field label="Precio de adquisición propuesto" name="proposed"><Input name="proposed" inputMode="decimal" defaultValue={a.proposed_acquisition_price ?? ""} /></Field>
                <Field label="Precio de reventa esperado" name="resale"><Input name="resale" inputMode="decimal" defaultValue={a.expected_resale_price ?? ""} /></Field>
                <Field label="Incertidumbre" name="uncertainty"><Select name="uncertainty" defaultValue={a.uncertainty ?? "medium"} options={[["low", "Baja"], ["medium", "Media"], ["high", "Alta"]]} /></Field>
                <Field label="Prenda a cancelar" name="lien"><Input name="lien" inputMode="decimal" defaultValue={a.lien_payoff_amount ?? "0"} /></Field>
                <div className="col-span-2 md:col-span-4"><Submit variant="secondary">Registrar valoración</Submit></div>
              </ActionForm>
            </Panel>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Resultado económico estimado" subtitle="Coste total = adquisición propuesta + reacondicionamiento; margen = reventa − coste total">
            <table className="mh-table"><tbody>
              <tr><td>Valor de mercado <Basis kind="estimado" /></td><td className="r"><Money value={a.market_value_estimate} currency={ccy} /><div className="text-xs text-faint">{a.market_value_source ?? "—"} · {date(a.market_value_date)}</div></td></tr>
              <tr><td>Precio de adquisición propuesto</td><td className="r"><Money value={a.proposed_acquisition_price} currency={ccy} /></td></tr>
              <tr><td>Reacondicionamiento estimado</td><td className="r"><Money value={recon} currency={ccy} /></td></tr>
              <tr><td className="text-text">Coste total estimado</td><td className="r font-semibold"><Money value={totalCost} currency={ccy} /></td></tr>
              <tr><td>Precio de reventa esperado</td><td className="r"><Money value={a.expected_resale_price} currency={ccy} /></td></tr>
              <tr><td className="text-text">Margen bruto estimado</td><td className="r font-semibold"><Money value={margin} currency={ccy} /> · {marginPct === null ? "no calculable" : <Pct value={marginPct} digits={2} />}</td></tr>
              <tr><td>Margen mínimo de política</td><td className="r"><Pct value={d.policy.min_margin_pct} digits={2} /></td></tr>
              <tr><td>Incertidumbre</td><td className="r">{{ low: "Baja", medium: "Media", high: "Alta" }[a.uncertainty as string] ?? "—"}</td></tr>
              <tr><td>Máximo autorizado de aceptación</td><td className="r"><Money value={a.max_authorized_price} currency={ccy} /></td></tr>
              <tr><td>Prenda a cancelar</td><td className="r"><Money value={a.lien_payoff_amount} currency={ccy} /></td></tr>
              {a.accepted_value && <tr><td className="text-text">Valor aceptado en contrato</td><td className="r font-semibold"><Money value={a.accepted_value} currency={ccy} /></td></tr>}
            </tbody></table>
          </Panel>
          <Panel title="Unidad ofrecida">
            <div className="px-4 py-3"><Facts items={[["Categoría", label(CATEGORY, a.category)], ["Uso", `${a.usage_value ?? "—"} ${a.usage_unit}`], ["Identificador", a.identifier_value ? `${a.identifier_kind?.toUpperCase()} ${a.identifier_value}` : "—"], ["Documentación", a.documentation_status], ["Creada", dateTime(a.created_at)], ["Historial", a.history_notes]]} /></div>
          </Panel>
          {d.approvals.length > 0 && (
            <Panel title="Autorizaciones">
              <ul className="divide-y divide-line-soft">{d.approvals.map((x) => (
                <li key={x.id} className="px-4 py-2 text-xs"><div className="flex justify-between"><span className="text-text">{label(RULE, x.rule)}: {x.message}</span><StatusBadge map={APPROVAL_STATUS} value={x.status} /></div>
                  {x.decider && <div className="text-faint">{x.decider}: {x.decision_note}</div>}</li>
              ))}</ul>
            </Panel>
          )}
          {a.status === "accepted" && can(ctx, "tradein.acquire") && (
            <Panel title="Incorporar al inventario" subtitle="Crea la unidad con coste real = valor aceptado y los reacondicionamientos como estimados">
              <ActionForm action={acquireAction} className="grid grid-cols-2 gap-2 px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Ubicación" name="location"><Select name="location" options={d.locations.map((l) => [l.id, l.name])} /></Field>
                <Field label="Fecha de recepción" name="received_on"><Input type="date" name="received_on" defaultValue={ctx.today} max={ctx.today} /></Field>
                <div className="col-span-2"><ConfirmSubmit label="Incorporar unidad" fields={[{ name: "received_on", label: "Recepción" }]} warning={`Se registrará un coste real de ${money(a.accepted_value, ccy)}.`} /></div>
              </ActionForm>
            </Panel>
          )}
          {a.acquired_unit_id && <Link href={`/inventory/${a.acquired_unit_id}`} className="block text-sm text-accent">Ver unidad incorporada →</Link>}
          {["draft", "inspected", "valued", "pending_approval", "approved"].includes(a.status) && !a.deal_id && (can(ctx, "tradein.write") || can(ctx, "tradein.approve")) && (
            <details className="rounded-md border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-risk">Cerrar tasación</summary>
              <ActionForm action={closeAppraisalAction} className="mt-2 flex items-end gap-2">
                <input type="hidden" name="id" value={id} />
                <Field label="Resultado" name="status"><Select name="status" options={[["withdrawn", "Retirada por el cliente"], ...(can(ctx, "tradein.approve") ? [["rejected", "Rechazada"] as [string, string]] : [])]} /></Field>
                <Field label="Motivo" name="note" className="flex-1"><Input name="note" /></Field>
                <Submit variant="danger">Cerrar</Submit>
              </ActionForm>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
