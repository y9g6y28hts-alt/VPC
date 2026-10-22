import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Facts, Empty } from "@/components/ui/Layout";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money, Pct } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import {
  ACQUISITION, CATEGORY, COMMERCIAL, COST_NATURE, DEAL_STATUS, DIMENSION, DISPLAY_STATUS, LOGISTICS, PREPARATION, label,
} from "@/lib/labels";
import { date, dateTime, money, num } from "@/lib/format";
import {
  addCostAction, changeStatusAction, setCoverAction, uploadMediaAction, countAction, deliverAction, documentStatusAction, moveUnitAction, receiveUnitAction,
  releaseReservationAction, reserveAction, setPriceAction, taskAction, updateDetailsAction, voidCostAction,
} from "../actions";

export const metadata = { title: "Unidad" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const u = await db.maybe<R>("select * from public.unit_overview where id = $1", [id]);
    if (!u) return null;
    const identifiers = await db.rows<R>("select * from public.unit_identifiers where unit_id = $1 order by kind", [id]);
    const costs = await db.rows<R>(`select c.*, cc.label concept_label, cc.include_in_inventory_cost from public.unit_costs c
                   join public.cost_concepts cc on cc.organization_id = c.organization_id and cc.code = c.concept_code
                  where c.unit_id = $1 order by c.incurred_on, c.created_at`, [id]);
    const concepts = await db.rows<R>("select code, label, include_in_inventory_cost from public.cost_concepts where organization_id = $1 order by sort_order", [ctx.org.id]);
    const docs = await db.rows<R>("select * from public.unit_documents where unit_id = $1 order by required_for_sale desc, label", [id]);
    const tasks = await db.rows<R>("select t.*, p.full_name done_by_name from public.preparation_tasks t left join public.user_profiles p on p.id = t.done_by where t.unit_id = $1 order by t.sort_order, t.created_at", [id]);
    const events = await db.rows<R>("select e.*, p.full_name actor from public.unit_status_events e left join public.user_profiles p on p.id = e.actor_id where e.unit_id = $1", [id]);
    const prices = await db.rows<R>("select h.*, p.full_name actor from public.unit_price_history h left join public.user_profiles p on p.id = h.actor_id where h.unit_id = $1", [id]);
    const moves = await db.rows<R>("select m.*, l.name location, p.full_name actor from public.unit_locations m join public.locations l on l.id = m.location_id left join public.user_profiles p on p.id = m.moved_by where m.unit_id = $1", [id]);
    const transitions = await db.rows<R>("select dimension, from_status, to_status, label from public.status_transitions where organization_id = $1 and not via_function", [ctx.org.id]);
    const blockers = await db.one<{ b: string[] }>("select app.unit_listing_blockers($1) b", [id]);
    const locations = await db.rows<R>("select id, name from public.locations where organization_id = $1 and active order by name", [ctx.org.id]);
    const deals = await db.rows<R>(`select d.id, d.number, d.status, d.created_at, c.display_name customer, di.negotiated_price, d.currency
                    from public.deal_items di join public.deals d on d.id = di.deal_id join public.customers c on c.id = d.customer_id
                   where di.unit_id = $1 order by d.created_at desc`, [id]);
    const alerts = await db.rows<R>("select * from public.management_alerts($1) where entity_id = $2", [ctx.org.id, id]);
    const media = await db.rows<R>("select id, caption, is_cover from public.unit_media where unit_id = $1 order by is_cover desc, sort_order, created_at", [id]);
    const counts = await db.rows<R>("select pc.*, l.name observed from public.physical_counts pc left join public.locations l on l.id = pc.observed_location_id where pc.unit_id = $1 order by counted_on desc, created_at desc limit 3", [id]);
    const customers = can(ctx, "reservation.write")
      ? await db.rows<R>("select id, display_name from public.customers where organization_id = $1 and status <> 'inactive' order by display_name", [ctx.org.id]) : [];
    const reservation = u.reservation_id ? await db.maybe<R>(
      "select r.*, c.display_name customer, p.full_name responsible from public.reservations r join public.customers c on c.id = r.customer_id join public.user_profiles p on p.id = r.responsible_user_id where r.id = $1", [u.reservation_id]) : null;
    return { u, media, identifiers, costs, concepts, docs, tasks, events, prices, moves, transitions, blockers: blockers.b, locations, deals, alerts, counts, customers, reservation };
  });
  if (!d) notFound();
  const { u } = d;
  const ccy = u.currency as string;
  const current: Record<string, string> = { acquisition: u.acquisition_status, logistics: u.logistics_status, preparation: u.preparation_status, commercial: u.commercial_status };
  const options = d.transitions.filter((t) => current[t.dimension] === t.from_status)
    .filter((t) => t.dimension === "logistics" ? can(ctx, "import.write", "inventory.status.write") : can(ctx, "inventory.status.write"))
    .map((t) => [`${t.dimension}:${t.to_status}`, `${DIMENSION[t.dimension]}: ${t.label}`] as [string, string]);
  const timeline = [
    ...d.events.map((e) => ({ at: e.occurred_at, text: `${DIMENSION[e.dimension]}: ${e.from_status ? statusLabel(e.dimension, e.from_status) + " → " : ""}${statusLabel(e.dimension, e.to_status)}`, note: e.reason, actor: e.actor })),
    ...d.prices.map((p) => ({ at: p.changed_at, text: `${{ list_price: "Precio de lista", minimum_price: "Precio mínimo", offer_price: "Precio de oferta" }[p.field as string]}: ${money(p.old_value, ccy)} → ${money(p.new_value, ccy)}`, note: p.reason, actor: p.actor })),
    ...d.moves.map((m) => ({ at: m.moved_at, text: `Ubicación: ${m.location}`, note: m.note, actor: m.actor })),
  ].sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const sellable = ["available", "reserved"].includes(u.commercial_status);
  const totals = d.costs.filter((c) => c.status === "active").reduce((acc, c) => {
    const k = c.include_in_inventory_cost ? c.nature : "excluded";
    acc[k] = (acc[k] ?? 0) + Number(c.amount_unit_currency);
    return acc;
  }, {} as Record<string, number>);
  const estimates = d.costs.filter((c) => c.status === "active" && c.nature === "estimated");

  return (
    <>
      <PageHeader crumbs={[["/inventory", "Inventario"]]}
        title={<span className="flex flex-wrap items-center gap-2">{u.make} {u.model} <span className="font-normal text-muted">{u.version}</span> <StatusBadge map={DISPLAY_STATUS} value={u.display_status} /></span>}
        subtitle={<>{u.stock_number} · {label(CATEGORY, u.category)} · {u.model_year ?? "—"} · {num(u.usage_value)} {u.usage_unit}{u.primary_identifier && <> · {u.primary_identifier}</>}</>}
        actions={<>
          {sellable && can(ctx, "deal.write") && <LinkButton href={`/deals/new?unit=${u.id}`} variant="primary">Iniciar negociación</LinkButton>}
        </>} />

      {d.alerts.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {d.alerts.map((a) => (
            <div key={a.alert_key} className="flex flex-wrap items-center gap-2 rounded-sm border border-warn/25 bg-warn-bg px-3 py-2 text-[13px]">
              <Badge tone={a.severity === "critical" ? "risk" : a.severity === "warning" ? "warn" : "info"}>{a.severity === "critical" ? "Crítica" : "Alerta"}</Badge>
              <span className="text-text">{a.title}</span><span className="text-muted">· {a.detail} · {a.action}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Estados" subtitle="Adquisición, logística, preparación y comercialización se gestionan por separado">
            <div className="grid grid-cols-2 gap-px bg-line-soft sm:grid-cols-4">
              {[["acquisition", ACQUISITION], ["logistics", LOGISTICS], ["preparation", PREPARATION], ["commercial", COMMERCIAL]].map(([dim, map]) => (
                <div key={dim as string} className="bg-surface px-4 py-3">
                  <div className="text-[10px] uppercase tracking-wider text-faint">{DIMENSION[dim as string]}</div>
                  <div className="mt-1 text-[13px] text-text">{label(map as Record<string, string>, current[dim as string])}</div>
                </div>
              ))}
            </div>
            {u.commercial_status === "not_listed" && d.blockers.length > 0 && (
              <div className="border-t border-line-soft px-4 py-2.5 text-xs text-warn">
                Para habilitar la venta falta: {d.blockers.join(" · ")}
              </div>
            )}
            {options.length > 0 && (
              <ActionForm action={changeStatusAction} className="grid grid-cols-1 items-end gap-2 border-t border-line-soft px-4 py-3 sm:grid-cols-[1.3fr_1.5fr_0.8fr_auto]">
                <input type="hidden" name="unit" value={u.id} />
                <Field label="Cambio de estado" name="transition"><Select name="transition" options={options} /></Field>
                <Field label="Motivo" name="reason"><Input name="reason" placeholder="Motivo obligatorio" /></Field>
                <Field label="Fecha efectiva" name="effective_date"><Input type="date" name="effective_date" max={ctx.today} defaultValue={ctx.today} /></Field>
                <Submit variant="secondary">Aplicar</Submit>
              </ActionForm>
            )}
            {u.logistics_status !== "received" && ["approved", "acquired"].includes(u.acquisition_status) && can(ctx, "import.write", "inventory.status.write") && (
              <ActionForm action={receiveUnitAction} className="grid grid-cols-1 items-end gap-2 border-t border-line-soft px-4 py-3 sm:grid-cols-[1fr_0.8fr_1.4fr_auto]">
                <input type="hidden" name="unit" value={u.id} />
                <Field label="Recepción física · ubicación" name="location"><Select name="location" options={d.locations.map((l) => [l.id, l.name])} /></Field>
                <Field label="Fecha" name="received_on"><Input type="date" name="received_on" defaultValue={ctx.today} max={ctx.today} /></Field>
                <Field label="Observaciones" name="notes"><Input name="notes" placeholder="Estado al ingreso" /></Field>
                <Submit variant="secondary">Registrar recepción</Submit>
              </ActionForm>
            )}
          </Panel>

          <Panel id="costs" title="Costes de adquisición y preparación"
            subtitle={u.cost_actual === null ? "Sin permiso para ver costes" : "Reales y estimados se registran y suman por separado; la política de inclusión se configura por concepto"}>
            {u.cost_actual === null ? <Empty title="Los costes requieren el permiso inventory.cost.read" /> : (
              <>
                {d.costs.length === 0 ? <Empty title="Sin costes registrados" /> : (
                  <div className="overflow-x-auto">
                    <table className="mh-table">
                      <thead><tr><th>Fecha</th><th>Concepto</th><th>Naturaleza</th><th>Descripción</th><th className="r">Importe original</th><th className="r">En {ccy}</th><th>Estado</th><th></th></tr></thead>
                      <tbody>
                        {d.costs.map((c) => (
                          <tr key={c.id} className={c.status !== "active" ? "opacity-55" : ""}>
                            <td className="num text-text-2">{date(c.incurred_on)}</td>
                            <td>{c.concept_label}{!c.include_in_inventory_cost && <span className="ml-1 text-xs text-faint">(excluido)</span>}</td>
                            <td><StatusBadge map={COST_NATURE} value={c.nature} /></td>
                            <td className="max-w-56 truncate text-text-2" title={c.description ?? ""}>{c.description ?? "—"}{c.fx_rate && <div className="text-xs text-faint">Cotización {c.fx_rate} · {date(c.fx_date)} · {c.fx_source}</div>}</td>
                            <td className="r"><Money value={c.amount} currency={c.currency} /></td>
                            <td className="r"><Money value={c.amount_unit_currency} currency={ccy} /></td>
                            <td className="text-xs text-muted">{c.status === "active" ? "Activo" : c.status === "settled" ? "Liquidado" : `Anulado: ${c.void_reason}`}</td>
                            <td>
                              {c.status === "active" && can(ctx, "inventory.cost.write") && (
                                <details className="text-xs"><summary className="cursor-pointer text-muted hover:text-text">Anular</summary>
                                  <ActionForm action={voidCostAction} className="mt-1 flex gap-1">
                                    <input type="hidden" name="unit" value={u.id} /><input type="hidden" name="cost" value={c.id} />
                                    <Input name="reason" placeholder="Motivo" className="w-32" /><Submit size="sm" variant="danger">Anular</Submit>
                                  </ActionForm>
                                </details>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr><td colSpan={5}>Coste real reconocido</td><td className="r"><Money value={totals.actual ?? 0} currency={ccy} /></td><td colSpan={2}></td></tr>
                        <tr><td colSpan={5} className="text-warn">Estimado pendiente (no incluido en el real)</td><td className="r text-warn"><Money value={totals.estimated ?? 0} currency={ccy} /></td><td colSpan={2}></td></tr>
                        {totals.excluded ? <tr><td colSpan={5} className="text-faint">Conceptos excluidos por política</td><td className="r"><Money value={totals.excluded} currency={ccy} muted /></td><td colSpan={2}></td></tr> : null}
                      </tfoot>
                    </table>
                  </div>
                )}
                {can(ctx, "inventory.cost.write") && u.commercial_status !== "retired" && (
                  <details className="border-t border-line-soft px-4 py-3">
                    <summary className="cursor-pointer text-xs text-muted hover:text-text">Registrar coste</summary>
                    <ActionForm action={addCostAction} resetOnSuccess className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                      <input type="hidden" name="unit" value={u.id} />
                      <Field label="Concepto" name="concept"><Select name="concept" options={d.concepts.map((c) => [c.code, c.label])} /></Field>
                      <Field label="Naturaleza" name="nature"><Select name="nature" options={[["actual", "Real (factura)"], ["estimated", "Estimado"]]} /></Field>
                      <Field label="Importe" name="amount"><Input name="amount" inputMode="decimal" placeholder="0.00" /></Field>
                      <Field label="Moneda" name="currency"><Select name="currency" defaultValue={ccy} options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"], ["BRL", "BRL"]]} /></Field>
                      <Field label="Fecha" name="incurred_on"><Input type="date" name="incurred_on" defaultValue={ctx.today} /></Field>
                      <Field label="Liquida estimación" name="settles"><Select name="settles" placeholder="—" options={estimates.map((e) => [e.id, `${e.concept_label} ${money(e.amount, e.currency)}`])} /></Field>
                      <Field label="Descripción" name="description" className="col-span-2"><Input name="description" /></Field>
                      <Field label="Cotización (si otra moneda)" name="fx_rate" hint={`${ccy} por unidad de la moneda del coste`}><Input name="fx_rate" inputMode="decimal" /></Field>
                      <Field label="Fecha cotización" name="fx_date"><Input type="date" name="fx_date" /></Field>
                      <Field label="Fuente cotización" name="fx_source" className="col-span-2"><Input name="fx_source" placeholder="Ej.: BCP, banco, despachante" /></Field>
                      <div className="col-span-2 flex items-end md:col-span-4"><Submit>Registrar coste</Submit></div>
                    </ActionForm>
                  </details>
                )}
              </>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Panel id="documents" title="Documentación" subtitle="Los documentos obligatorios pendientes bloquean la venta y la entrega">
              {d.docs.length === 0 ? <Empty title="Sin requisitos documentales" /> : (
                <ul className="divide-y divide-line-soft">
                  {d.docs.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] text-text">{doc.label}</div>
                        <div className="text-xs text-faint">{doc.required_for_sale ? "Obligatorio" : "Opcional"}{doc.received_on && ` · recibido ${date(doc.received_on)}`}</div>
                      </div>
                      {can(ctx, "inventory.write") ? (
                        <ActionForm action={documentStatusAction} hideMessage className="flex items-center gap-1">
                          <input type="hidden" name="unit" value={u.id} /><input type="hidden" name="doc" value={doc.id} />
                          <Select name="status" defaultValue={doc.status} className="w-32" options={[["pending", "Pendiente"], ["received", "Recibido"], ["verified", "Verificado"], ["not_applicable", "No aplica"]]} />
                          <Input name="notes" placeholder="Nota" className="w-24" />
                          <Submit size="sm" variant="secondary">Guardar</Submit>
                        </ActionForm>
                      ) : <Badge tone={doc.status === "pending" ? "warn" : "good"}>{doc.status}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Preparación" subtitle={`${d.tasks.filter((t) => t.status === "pending").length} tareas pendientes`}>
              {d.tasks.length === 0 ? <Empty title="Las tareas se crean al recibir la unidad" /> : (
                <ul className="divide-y divide-line-soft">
                  {d.tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-2">
                      <div className="min-w-0">
                        <div className={`truncate text-[13px] ${t.status === "pending" ? "text-text" : "text-muted line-through decoration-faint"}`}>{t.title}</div>
                        <div className="text-xs text-faint">{t.mandatory ? "Obligatoria" : "Opcional"}{t.done_by_name && ` · ${t.status === "waived" ? "exenta" : "hecha"} por ${t.done_by_name}`}</div>
                      </div>
                      {can(ctx, "service.write") && (
                        <ActionForm action={taskAction} hideMessage>
                          <input type="hidden" name="unit" value={u.id} /><input type="hidden" name="task" value={t.id} />
                          <input type="hidden" name="status" value={t.status === "pending" ? "done" : "pending"} />
                          <Submit size="sm" variant={t.status === "pending" ? "secondary" : "ghost"}>{t.status === "pending" ? "Completar" : "Reabrir"}</Submit>
                        </ActionForm>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Historial de la unidad" subtitle="Estados, precios y ubicaciones">
            {timeline.length === 0 ? <Empty title="Sin movimientos" /> : (
              <ol className="max-h-96 divide-y divide-line-soft overflow-y-auto">
                {timeline.map((e, i) => (
                  <li key={i} className="grid grid-cols-[132px_1fr] gap-3 px-4 py-2 text-[13px]">
                    <span className="num text-xs text-faint">{dateTime(e.at)}</span>
                    <span><span className="text-text">{e.text}</span>{e.note && <span className="text-muted"> · {e.note}</span>}{e.actor && <span className="text-faint"> · {e.actor}</span>}</span>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Fotografías" subtitle="Almacenamiento privado; se muestran solo a usuarios con acceso al inventario">
            {d.media.length === 0 ? <Empty title="Sin fotografías" /> : (
              <div className="grid grid-cols-3 gap-1 p-2">
                {d.media.map((m, idx) => (
                  <figure key={m.id} className={`relative ${idx === 0 ? "col-span-3" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/media/${m.id}`} alt={m.caption ?? `${u.make} ${u.model}`} className={`w-full rounded-sm object-cover ${idx === 0 ? "aspect-[16/9]" : "aspect-square"}`} />
                    {!m.is_cover && can(ctx, "inventory.write") && (
                      <ActionForm action={setCoverAction} hideMessage className="absolute bottom-1 right-1"><input type="hidden" name="unit" value={u.id} /><input type="hidden" name="media" value={m.id} /><Submit size="sm" variant="secondary">Portada</Submit></ActionForm>
                    )}
                  </figure>
                ))}
              </div>
            )}
            {can(ctx, "inventory.write") && (
              <ActionForm action={uploadMediaAction} resetOnSuccess className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3">
                <input type="hidden" name="unit" value={u.id} />
                <Field label="Imagen (JPG, PNG o WebP · máx. 8 MB)" name="file" className="flex-1"><input type="file" name="file" accept="image/jpeg,image/png,image/webp" className="block w-full text-xs text-text-2 file:mr-2 file:rounded-sm file:border file:border-line file:bg-raised file:px-2 file:py-1 file:text-text" /></Field>
                <Field label="Leyenda" name="caption"><Input name="caption" /></Field>
                <Submit variant="secondary">Cargar</Submit>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Comercialización">
            <div className="px-4 py-3">
              <Facts cols={2} items={[
                ["Precio de lista", <Money key="l" value={u.list_price} currency={ccy} />],
                ["Precio mínimo autorizado", <Money key="m" value={u.minimum_price} currency={ccy} />],
                ["Precio de oferta", <Money key="o" value={u.offer_price} currency={ccy} />],
                ["Margen bruto potencial", u.potential_margin === null ? "Sin acceso" : <span key="pm"><Money value={u.potential_margin} currency={ccy} /> · <Pct value={u.potential_margin_pct} /></span>],
                ["Antigüedad en stock", u.days_in_stock !== null ? `${u.days_in_stock} días` : "No recibida"],
                ["Habilitada desde", date(u.listed_on)],
              ]} />
            </div>
            {can(ctx, "inventory.price.write") && !["sold_pending_delivery", "delivered", "retired"].includes(u.commercial_status) && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Modificar precios</summary>
                <ActionForm action={setPriceAction} className="mt-3 grid grid-cols-3 gap-2">
                  <input type="hidden" name="unit" value={u.id} /><input type="hidden" name="version" value={u.row_version} />
                  <Field label="Lista" name="list"><Input name="list" inputMode="decimal" defaultValue={u.list_price ?? ""} /></Field>
                  <Field label="Mínimo" name="minimum"><Input name="minimum" inputMode="decimal" defaultValue={u.minimum_price ?? ""} /></Field>
                  <Field label="Oferta" name="offer"><Input name="offer" inputMode="decimal" defaultValue={u.offer_price ?? ""} /></Field>
                  <Field label="Motivo del cambio" name="reason" className="col-span-3"><Input name="reason" /></Field>
                  <div className="col-span-3"><ConfirmSubmit label="Revisar cambio" confirmLabel="Confirmar precios"
                    fields={[{ name: "list", label: "Lista" }, { name: "minimum", label: "Mínimo" }, { name: "offer", label: "Oferta" }, { name: "reason", label: "Motivo" }]} /></div>
                </ActionForm>
              </details>
            )}
          </Panel>

          <Panel title="Reserva">
            {d.reservation ? (
              <div className="px-4 py-3">
                <Facts cols={2} items={[
                  ["Cliente", d.reservation.customer], ["Responsable", d.reservation.responsible],
                  ["Vence", dateTime(d.reservation.expires_at)], ["Seña", Number(d.reservation.deposit_amount) ? money(d.reservation.deposit_amount, d.reservation.deposit_currency) : "Sin seña"],
                ]} />
                <p className="mt-2 text-xs text-muted">{d.reservation.conditions}</p>
                {can(ctx, "reservation.write") && (
                  <ActionForm action={releaseReservationAction} className="mt-3 flex items-end gap-2">
                    <input type="hidden" name="unit" value={u.id} /><input type="hidden" name="reservation" value={d.reservation.id} />
                    <Field label="Motivo de liberación" name="reason" className="flex-1"><Input name="reason" /></Field>
                    <Submit variant="danger">Liberar</Submit>
                  </ActionForm>
                )}
              </div>
            ) : u.commercial_status === "available" && can(ctx, "reservation.write") ? (
              <ActionForm action={reserveAction} className="grid grid-cols-2 gap-2 px-4 py-3">
                <input type="hidden" name="unit" value={u.id} />
                <Field label="Cliente" name="customer" className="col-span-2"><Select name="customer" placeholder="Seleccione…" options={d.customers.map((c) => [c.id, c.display_name])} /></Field>
                <Field label="Duración (horas)" name="hours"><Input name="hours" type="number" defaultValue={72} min={1} /></Field>
                <Field label="Seña comprometida" name="deposit" hint="Se considera recibida solo al confirmar su pago"><Input name="deposit" inputMode="decimal" placeholder="0" /></Field>
                <Field label="Condiciones" name="conditions" className="col-span-2"><Textarea name="conditions" rows={2} /></Field>
                <div className="col-span-2"><Submit variant="secondary">Reservar unidad</Submit></div>
              </ActionForm>
            ) : <Empty title={`Sin reserva activa · ${label(COMMERCIAL, u.commercial_status)}`} />}
          </Panel>

          {u.commercial_status === "sold_pending_delivery" && can(ctx, "deal.deliver") && (
            <Panel title="Entrega" subtitle="Se valida preparación, documentación y cobro de la entrega inicial según política">
              <ActionForm action={deliverAction} className="grid grid-cols-2 gap-2 px-4 py-3">
                <input type="hidden" name="unit" value={u.id} />
                <Field label="Fecha de entrega" name="delivered_on"><Input type="date" name="delivered_on" defaultValue={ctx.today} max={ctx.today} /></Field>
                <Field label="Notas" name="notes"><Input name="notes" /></Field>
                <div className="col-span-2"><ConfirmSubmit label="Registrar entrega" fields={[{ name: "delivered_on", label: "Fecha" }, { name: "notes", label: "Notas" }]} /></div>
              </ActionForm>
            </Panel>
          )}

          <Panel title="Operaciones">
            {d.deals.length === 0 ? <Empty title="Sin negociaciones visibles para esta unidad" /> : (
              <ul className="divide-y divide-line-soft">
                {d.deals.map((x) => (
                  <li key={x.id}><Link href={`/deals/${x.id}`} className="flex items-center justify-between gap-2 px-4 py-2 hover:bg-raised">
                    <span><span className="text-[13px] text-text">{x.number}</span><span className="block text-xs text-muted">{x.customer} · {date(x.created_at)}</span></span>
                    <span className="text-right"><StatusBadge map={DEAL_STATUS} value={x.status} /><span className="block text-xs"><Money value={x.negotiated_price} currency={x.currency} /></span></span>
                  </Link></li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Ficha técnica y ubicación">
            <div className="px-4 py-3">
              <Facts cols={2} items={[
                ...d.identifiers.map((i) => [i.kind.toUpperCase(), <span key={i.id} className="num">{i.value}{i.allow_duplicate && " (excepción)"}</span>] as [string, React.ReactNode]),
                ["Procedencia", `${label({ import: "Importación", local_purchase: "Compra local", trade_in: "Parte de pago", consignment: "Consignación" }, u.origin)}${u.origin_country ? ` · ${u.origin_country}` : ""}`],
                ["Ubicación", u.location_name ?? "—"],
                ["Color exterior", u.exterior_color], ["Interior", u.interior_color],
                ["Adquirida", date(u.acquired_on)], ["Recibida", date(u.received_on)],
                ["Responsable", u.responsible_name],
              ]} />
              {u.equipment?.length > 0 && <p className="mt-3 text-xs text-muted">Equipamiento: {u.equipment.join(" · ")}</p>}
              {u.description && <p className="mt-2 text-xs text-muted">{u.description}</p>}
              {d.counts.length > 0 && (
                <p className="mt-2 text-xs text-faint">Último conteo físico {date(d.counts[0].counted_on)}: {d.counts[0].found ? `encontrada en ${d.counts[0].observed ?? "—"}` : "NO encontrada"}</p>
              )}
            </div>
            {can(ctx, "inventory.write") && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Editar ficha</summary>
                <ActionForm action={updateDetailsAction} className="mt-3 grid grid-cols-2 gap-2">
                  <input type="hidden" name="unit" value={u.id} />
                  <Field label="Color exterior" name="exterior_color"><Input name="exterior_color" defaultValue={u.exterior_color ?? ""} /></Field>
                  <Field label="Interior" name="interior_color"><Input name="interior_color" defaultValue={u.interior_color ?? ""} /></Field>
                  <Field label={`Uso (${u.usage_unit})`} name="usage_value"><Input name="usage_value" inputMode="decimal" defaultValue={u.usage_value ?? ""} /></Field>
                  <Field label="Descripción" name="description" className="col-span-2"><Textarea name="description" defaultValue={u.description ?? ""} /></Field>
                  <div className="col-span-2"><Submit variant="secondary">Guardar ficha</Submit></div>
                </ActionForm>
              </details>
            )}
            {can(ctx, "inventory.write") && u.logistics_status === "received" && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Mover de ubicación</summary>
                <ActionForm action={moveUnitAction} className="mt-3 flex items-end gap-2">
                  <input type="hidden" name="unit" value={u.id} />
                  <Field label="Nueva ubicación" name="location" className="flex-1"><Select name="location" options={d.locations.map((l) => [l.id, l.name])} /></Field>
                  <Field label="Nota" name="note" className="flex-1"><Input name="note" /></Field>
                  <Submit variant="secondary">Mover</Submit>
                </ActionForm>
              </details>
            )}
            {can(ctx, "inventory.count") && (
              <details className="border-t border-line-soft px-4 py-3">
                <summary className="cursor-pointer text-xs text-muted hover:text-text">Registrar conteo físico</summary>
                <ActionForm action={countAction} className="mt-3 grid grid-cols-2 gap-2">
                  <input type="hidden" name="unit" value={u.id} />
                  <Field label="Resultado" name="found"><Select name="found" options={[["true", "Encontrada"], ["false", "No encontrada"]]} /></Field>
                  <Field label="Ubicación observada" name="location"><Select name="location" placeholder="—" options={d.locations.map((l) => [l.id, l.name])} /></Field>
                  <Field label="Notas" name="notes" className="col-span-2"><Input name="notes" /></Field>
                  <div className="col-span-2"><Submit variant="secondary">Registrar conteo</Submit></div>
                </ActionForm>
              </details>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function statusLabel(dimension: string, value: string) {
  const map = { acquisition: ACQUISITION, logistics: LOGISTICS, preparation: PREPARATION, commercial: COMMERCIAL }[dimension] as Record<string, string>;
  return map?.[value] ?? value;
}
