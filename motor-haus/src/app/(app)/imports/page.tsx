import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ActionForm, Field, Input, Select, Submit } from "@/components/ui/Form";
import { SHIPMENT_STATUS } from "@/lib/labels";
import { date } from "@/lib/format";
import { createShipmentAction } from "./actions";

export const metadata = { title: "Importaciones" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ImportsPage() {
  const ctx = await getContext();
  const d = await query(ctx, async (db) => ({
    rows: await db.rows<R>(
      `select s.*, sup.name carrier, p.full_name responsible, op.import_delay_alert_days,
              (select string_agg(u.stock_number || ' ' || u.make || ' ' || u.model, ', ') from public.shipment_units su join public.units u on u.id = su.unit_id where su.shipment_id = s.id) units,
              (select count(*) from public.import_events e where e.shipment_id = s.id and e.event_type = 'incident' and not e.resolved) open_incidents,
              (select json_agg(json_build_object('ccy', x.currency, 'est', x.est, 'act', x.act)) from (
                 select c.unit_currency currency, sum(c.amount_unit_currency) filter (where c.nature = 'estimated' and c.status <> 'voided') est,
                        sum(c.amount_unit_currency) filter (where c.nature = 'actual' and c.status = 'active' and c.concept_code <> 'purchase_price') act
                   from public.unit_costs c join public.shipment_units su on su.unit_id = c.unit_id where su.shipment_id = s.id group by c.unit_currency) x) costs
         from public.shipments s left join public.suppliers sup on sup.id = s.carrier_supplier_id left join public.user_profiles p on p.id = s.responsible_user_id
         join public.org_policies op on op.organization_id = s.organization_id
        where s.organization_id = $1 order by s.status in ('delivered','cancelled'), s.eta`, [ctx.org.id]),
    units: can(ctx, "import.write") ? await db.rows<R>("select id, stock_number, make, model from public.units where organization_id = $1 and logistics_status <> 'received' and acquisition_status in ('approved','acquired') order by stock_number", [ctx.org.id]) : [],
    carriers: can(ctx, "import.write") ? await db.rows<R>("select id, name from public.suppliers where organization_id = $1 and kind in ('logistics','customs_broker') order by name", [ctx.org.id]) : [],
  }));
  return (
    <>
      <PageHeader title="Importaciones y logística" subtitle="Unidades compradas que aún no están en el salón. Las fechas de llegada son estimaciones, no garantías." />
      <Panel className="mb-4">
        {d.rows.length === 0 ? <Empty title="Sin embarques" /> : (
          <div className="overflow-x-auto"><table className="mh-table">
            <thead><tr><th>Embarque</th><th>Unidades</th><th>Origen</th><th>Transporte</th><th>Salida</th><th>ETA</th><th className="r">Demora</th><th>Costes (est. / real)</th><th>Incidencias</th><th>Estado</th><th>Responsable</th></tr></thead>
            <tbody>{d.rows.map((s) => {
              const delay = s.eta && !["delivered", "cancelled"].includes(s.status) ? Math.round((Date.parse(ctx.today) - Date.parse(s.eta)) / 86400000) : null;
              return (
                <tr key={s.id}>
                  <td><Link href={`/imports/${s.id}`} className="text-text hover:text-accent">{s.reference}</Link><div className="text-xs text-faint">{s.carrier ?? ""}</div></td>
                  <td className="max-w-56 truncate text-xs text-text-2" title={s.units}>{s.units ?? "—"}</td>
                  <td className="text-text-2">{s.origin_country}{s.origin_port && ` · ${s.origin_port}`}</td>
                  <td className="text-text-2">{{ sea: "Marítimo", air: "Aéreo", land: "Terrestre", other: "Otro" }[s.transport_mode as string]}</td>
                  <td className="num text-text-2">{date(s.departed_on)}</td>
                  <td className="num">{date(s.eta)}{s.eta_original && s.eta_original !== s.eta && <div className="text-xs text-faint">orig. {date(s.eta_original)}</div>}</td>
                  <td className="r">{delay !== null && delay > 0 ? <Badge tone={delay > s.import_delay_alert_days ? "risk" : "warn"}>{delay} d</Badge> : "—"}</td>
                  <td className="text-xs">{(s.costs ?? []).map((c: R) => <div key={c.ccy}><Money value={c.est ?? 0} currency={c.ccy} className="text-warn" /> / <Money value={c.act ?? 0} currency={c.ccy} /></div>)}</td>
                  <td>{Number(s.open_incidents) > 0 ? <Badge tone="warn">{s.open_incidents} abierta(s)</Badge> : "—"}</td>
                  <td><StatusBadge map={SHIPMENT_STATUS} value={s.status} /></td>
                  <td className="text-text-2">{s.responsible}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>
      {can(ctx, "import.write") && (
        <Panel title="Registrar embarque">
          <ActionForm action={createShipmentAction} className="grid grid-cols-2 gap-2 px-4 py-3 md:grid-cols-4">
            <Field label="Referencia" name="reference"><Input name="reference" /></Field>
            <Field label="País de origen" name="origin_country"><Input name="origin_country" /></Field>
            <Field label="Puerto / aeropuerto" name="origin_port"><Input name="origin_port" /></Field>
            <Field label="Transporte" name="transport_mode"><Select name="transport_mode" options={[["sea", "Marítimo"], ["air", "Aéreo"], ["land", "Terrestre"], ["other", "Otro"]]} /></Field>
            <Field label="Fecha de salida" name="departed_on"><Input type="date" name="departed_on" /></Field>
            <Field label="ETA (estimada)" name="eta"><Input type="date" name="eta" /></Field>
            <Field label="Transportista" name="carrier"><Select name="carrier" placeholder="—" options={d.carriers.map((c) => [c.id, c.name])} /></Field>
            <Field label="Tracking" name="tracking"><Input name="tracking" /></Field>
            <Field label="Unidades (Ctrl/Cmd para varias)" name="units" className="col-span-2 md:col-span-4">
              <select name="units" multiple className="h-24 w-full rounded-sm border border-line bg-ink px-2 text-[13px]">
                {d.units.map((u) => <option key={u.id} value={u.id}>{u.stock_number} · {u.make} {u.model}</option>)}
              </select>
            </Field>
            <div><Submit variant="secondary">Registrar embarque</Submit></div>
          </ActionForm>
        </Panel>
      )}
    </>
  );
}
