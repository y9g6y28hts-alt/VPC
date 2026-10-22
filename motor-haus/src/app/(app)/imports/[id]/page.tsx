import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Facts } from "@/components/ui/Layout";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ActionForm, Field, Input, Select, Submit } from "@/components/ui/Form";
import { DISPLAY_STATUS, SHIPMENT_STATUS } from "@/lib/labels";
import { date, dateTime } from "@/lib/format";
import { incidentAction, resolveIncidentAction, updateShipmentAction } from "../actions";

export const metadata = { title: "Embarque" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ShipmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const s = await db.maybe<R>("select s.*, sup.name carrier, p.full_name responsible, po.number po_number from public.shipments s left join public.suppliers sup on sup.id = s.carrier_supplier_id left join public.user_profiles p on p.id = s.responsible_user_id left join public.purchase_orders po on po.id = s.purchase_order_id where s.id = $1", [id]);
    if (!s) return null;
    return {
      s,
      units: await db.rows<R>("select u.* from public.unit_overview u join public.shipment_units su on su.unit_id = u.id where su.shipment_id = $1", [id]),
      costs: await db.rows<R>(
        `select u.stock_number, cc.label, c.nature, c.status, c.amount_unit_currency, c.unit_currency, c.description from public.unit_costs c
           join public.shipment_units su on su.unit_id = c.unit_id join public.units u on u.id = c.unit_id
           join public.cost_concepts cc on cc.organization_id = c.organization_id and cc.code = c.concept_code
          where su.shipment_id = $1 and c.concept_code <> 'purchase_price' order by u.stock_number, cc.sort_order`, [id]),
      events: await db.rows<R>("select e.*, p.full_name actor from public.import_events e left join public.user_profiles p on p.id = e.actor_id where e.shipment_id = $1 order by occurred_at desc", [id]),
    };
  });
  if (!d) notFound();
  const { s } = d;
  const totals = new Map<string, { est: number; act: number }>();
  d.costs.filter((c) => c.status !== "voided").forEach((c) => {
    const t = totals.get(c.label) ?? { est: 0, act: 0 };
    if (c.nature === "estimated") t.est += Number(c.amount_unit_currency); else t.act += Number(c.amount_unit_currency);
    totals.set(c.label, t);
  });
  const ccy = d.costs[0]?.unit_currency ?? ctx.org.currency;
  return (
    <>
      <PageHeader crumbs={[["/imports", "Importaciones"]]} title={<span className="flex items-center gap-2">{s.reference} <StatusBadge map={SHIPMENT_STATUS} value={s.status} /></span>}
        subtitle={`${s.origin_country}${s.origin_port ? ` · ${s.origin_port}` : ""} → ${s.destination ?? "destino"} · ${s.carrier ?? "sin transportista"}${s.po_number ? ` · OC ${s.po_number}` : ""}`} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Unidades del embarque" subtitle="La recepción física se registra en la ficha de cada unidad e inicia su preparación">
            <table className="mh-table"><tbody>{d.units.map((u) => (
              <tr key={u.id}><td><Link href={`/inventory/${u.id}`} className="text-text hover:text-accent">{u.stock_number} · {u.make} {u.model}</Link></td><td><StatusBadge map={DISPLAY_STATUS} value={u.display_status} /></td><td className="text-xs text-muted">{u.received_on ? `Recibida ${date(u.received_on)}` : "Pendiente de recepción"}</td></tr>
            ))}</tbody></table>
          </Panel>
          <Panel title="Costes previstos vs reales" subtitle={`Diferencia por concepto (${ccy}); el precio de compra se excluye`}>
            {totals.size === 0 ? <Empty title="Sin costes logísticos registrados" /> : (
              <table className="mh-table"><thead><tr><th>Concepto</th><th className="r">Estimado</th><th className="r">Real</th><th className="r">Diferencia</th></tr></thead>
                <tbody>{[...totals.entries()].map(([k, t]) => (
                  <tr key={k}><td>{k}</td><td className="r"><Money value={t.est} currency={ccy} className="text-warn" /></td><td className="r"><Money value={t.act} currency={ccy} /></td>
                    <td className="r">{t.est && t.act ? <Money value={t.act - t.est} currency={ccy} sign /> : <span className="text-xs text-faint">{t.act ? "sin estimación previa" : "pendiente de factura"}</span>}</td></tr>
                ))}</tbody></table>
            )}
            {d.costs.length > 0 && <ul className="border-t border-line-soft px-4 py-2 text-xs text-muted">{d.costs.map((c, i) => <li key={i}>{c.stock_number} · {c.label} · {c.nature === "estimated" ? "estimado" : "real"}{c.status === "settled" ? " (liquidado)" : ""} · {c.description ?? ""}</li>)}</ul>}
          </Panel>
          <Panel title="Historial e incidencias">
            {d.events.length === 0 ? <Empty title="Sin eventos" /> : (
              <ul className="divide-y divide-line-soft">{d.events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2 px-4 py-2 text-[13px]">
                  <div><span className="text-faint">{dateTime(e.occurred_at)}</span> · {e.event_type === "incident" && <Badge tone={e.resolved ? "neutral" : e.severity === "critical" ? "risk" : "warn"}>{e.resolved ? "Resuelta" : "Incidencia"}</Badge>} <span className="text-text">{e.description}</span>
                    {e.old_value && <span className="text-muted"> · {e.old_value} → {e.new_value}</span>}{e.actor && <span className="text-faint"> · {e.actor}</span>}</div>
                  {e.event_type === "incident" && !e.resolved && can(ctx, "import.write") && <ActionForm action={resolveIncidentAction} hideMessage><input type="hidden" name="id" value={id} /><input type="hidden" name="event" value={e.id} /><Submit size="sm" variant="ghost">Resolver</Submit></ActionForm>}
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Seguimiento">
            <div className="px-4 py-3"><Facts items={[["Salida", date(s.departed_on)], ["ETA vigente (estimada)", date(s.eta)], ["ETA original", date(s.eta_original)], ["Llegada real", date(s.arrived_on)], ["Liberación aduanera", date(s.customs_cleared_on)], ["Tracking", s.tracking], ["Responsable", s.responsible]]} /></div>
            {can(ctx, "import.write") && (
              <ActionForm action={updateShipmentAction} className="grid grid-cols-2 gap-2 border-t border-line-soft px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Estado" name="status"><Select name="status" defaultValue={s.status} options={Object.entries(SHIPMENT_STATUS).map(([k, [l]]) => [k, l])} /></Field>
                <Field label="ETA" name="eta"><Input type="date" name="eta" defaultValue={s.eta ?? ""} /></Field>
                <Field label="Liberación aduanera" name="customs_cleared_on"><Input type="date" name="customs_cleared_on" defaultValue={s.customs_cleared_on ?? ""} /></Field>
                <Field label="Tracking" name="tracking"><Input name="tracking" defaultValue={s.tracking ?? ""} /></Field>
                <div className="col-span-2"><Submit variant="secondary">Actualizar</Submit></div>
              </ActionForm>
            )}
          </Panel>
          {can(ctx, "import.write") && (
            <Panel title="Registrar incidencia">
              <ActionForm action={incidentAction} resetOnSuccess className="grid grid-cols-[auto_1fr] gap-2 px-4 py-3">
                <input type="hidden" name="id" value={id} />
                <Field label="Severidad" name="severity"><Select name="severity" options={[["info", "Informativa"], ["warning", "Atención"], ["critical", "Crítica"]]} /></Field>
                <Field label="Descripción" name="description"><Input name="description" /></Field>
                <div className="col-span-2"><Submit variant="secondary">Registrar</Submit></div>
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
