import Link from "next/link";
import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { StatusPill, type StatusTone } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { isIsoDate } from "@/domain/dates";
import { formatDateTime } from "@/lib/format";
import { hrefWith, param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";

export const metadata: Metadata = { title: "Auditoría" };

const PAGE = 100;

const ENTITY: Record<string, { label: string; href?: (id: string) => string }> = {
  vehicles: { label: "Unidad", href: (id) => `/inventario/${id}` },
  vehicle_costs: { label: "Coste de unidad" },
  documents: { label: "Documento" },
  customers: { label: "Cliente", href: (id) => `/clientes/${id}` },
  deals: { label: "Operación", href: (id) => `/ventas/${id}` },
  reservations: { label: "Reserva" },
  approvals: { label: "Aprobación" },
  trade_in_appraisals: { label: "Tasación", href: (id) => `/tradein/${id}` },
  contracts: { label: "Contrato", href: (id) => `/financiaciones/${id}` },
  customer_payments: { label: "Pago de cliente" },
  cash_movements: { label: "Movimiento de caja" },
  reconciliations: { label: "Conciliación" },
  supplier_invoices: { label: "Factura de proveedor", href: (id) => `/compras/facturas/${id}` },
  supplier_payments: { label: "Pago a proveedor" },
  expenses: { label: "Gasto" },
  memberships: { label: "Usuario y rol" },
  membership: { label: "Usuario y rol" },
  org_settings: { label: "Configuración" },
  organizations: { label: "Organización" },
  aging_buckets: { label: "Tramo de mora" },
  exchange_rates: { label: "Tipo de cambio" },
  cash_accounts: { label: "Cuenta de caja" },
  brands: { label: "Marca" },
  branches: { label: "Sucursal" },
  report: { label: "Reporte" },
};

const ACTION: Record<string, { label: string; tone: StatusTone }> = {
  insert: { label: "Alta", tone: "neutral" },
  update: { label: "Modificación", tone: "info" },
  delete: { label: "Eliminación", tone: "critical" },
};

function actionInfo(a: string): { label: string; tone: StatusTone } {
  if (ACTION[a]) return ACTION[a];
  const label = a.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  const tone: StatusTone = /revers|anula|rechaz/.test(a) ? "critical" : /export/.test(a) ? "warning" : /aprob|confirm|formaliz|entreg|adquir|concili/.test(a) ? "positive" : "neutral";
  return { label, tone };
}

/** Campos que cambiaron entre la versión anterior y la nueva. */
function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const skip = new Set(["updated_at", "row_version", "org_id"]);
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const out: Array<{ key: string; from: unknown; to: unknown }> = [];
  for (const k of keys) {
    if (skip.has(k)) continue;
    const a = before?.[k];
    const b = after?.[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ key: k, from: a, to: b });
  }
  return out;
}

function show(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("audit.view");
  const sp = await searchParams;
  const entity = param(sp, "entidad");
  const actor = param(sp, "usuario");
  const action = param(sp, "accion");
  const q = param(sp, "q")?.trim();
  const from = param(sp, "desde");
  const to = param(sp, "hasta");
  const before = Number(param(sp, "antes")) || null;

  const [rows, actors, types] = await Promise.all([
    ctx.db((tx) => tx<{ id: string; occurred_at: string; actor: string | null; action: string; entity_type: string; entity_id: string | null; summary: string | null; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null }[]>`
      select e.id::text, e.occurred_at, u.full_name as actor, e.action, e.entity_type, e.entity_id, e.summary, e.before_data, e.after_data
      from public.audit_events e left join public.user_profiles u on u.id = e.actor_id
      where e.org_id = ${ctx.org.id}
        ${entity ? tx`and e.entity_type = ${entity}` : tx``}
        ${actor === "sistema" ? tx`and e.actor_id is null` : actor && /^[0-9a-f-]{36}$/i.test(actor) ? tx`and e.actor_id = ${actor}` : tx``}
        ${action === "negocio" ? tx`and e.action not in ('insert','update','delete')` : action ? tx`and e.action = ${action}` : tx``}
        ${q ? tx`and (e.entity_id = ${q} or e.summary ilike ${"%" + q + "%"} or e.after_data::text ilike ${"%" + q + "%"})` : tx``}
        ${from && isIsoDate(from) ? tx`and e.occurred_at >= (${from}::date)::timestamp at time zone ${ctx.org.timezone}` : tx``}
        ${to && isIsoDate(to) ? tx`and e.occurred_at < (${to}::date + 1)::timestamp at time zone ${ctx.org.timezone}` : tx``}
        ${before ? tx`and e.id < ${before}` : tx``}
      order by e.id desc limit ${PAGE + 1}`),
    ctx.db((tx) => tx<{ id: string; full_name: string }[]>`
      select u.id, u.full_name from public.memberships m join public.user_profiles u on u.id = m.user_id where m.org_id = ${ctx.org.id} order by u.full_name`),
    ctx.db((tx) => tx<{ entity_type: string }[]>`select distinct entity_type from public.audit_events where org_id = ${ctx.org.id} order by 1`),
  ]);
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);

  return (
    <>
      <PageHeader
        title="Auditoría"
        description="Registro inalterable de las acciones sensibles: altas, modificaciones con su valor anterior y nuevo, confirmaciones, reversiones, aprobaciones y exportaciones. Nadie puede editarlo ni borrarlo."
      />
      <FilterForm>
        <SearchInput defaultValue={q} placeholder="Buscar por ID, número o texto…" />
        <FilterSelect name="entidad" label="Entidad" defaultValue={entity} allLabel="Todas" options={types.map((t) => ({ value: t.entity_type, label: ENTITY[t.entity_type]?.label ?? t.entity_type }))} />
        <FilterSelect name="usuario" label="Usuario" defaultValue={actor} options={[{ value: "sistema", label: "Sistema / proceso" }, ...actors.map((a) => ({ value: a.id, label: a.full_name }))]} />
        <FilterSelect name="accion" label="Acción" defaultValue={action} allLabel="Todas" options={[{ value: "negocio", label: "Acciones de negocio" }, { value: "insert", label: "Altas" }, { value: "update", label: "Modificaciones" }, { value: "delete", label: "Eliminaciones" }]} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Desde</span>
          <input type="date" name="desde" defaultValue={from} className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-faint">Hasta</span>
          <input type="date" name="hasta" defaultValue={to} className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2" />
        </label>
        <button type="submit" className="h-9 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-elevated">Aplicar</button>
      </FilterForm>

      {page.length === 0 ? (
        <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin eventos para los filtros seleccionados" /></div>
      ) : (
        <TableWrap>
          <Table>
            <THead><Th>Fecha y hora</Th><Th>Usuario</Th><Th>Acción</Th><Th>Entidad</Th><Th>Detalle</Th></THead>
            <tbody>
              {page.map((e) => {
                const ent = ENTITY[e.entity_type];
                const a = actionInfo(e.action);
                const changes = e.action === "update" ? diff(e.before_data, e.after_data) : [];
                const snapshot = e.action === "insert" ? e.after_data : e.action === "delete" ? e.before_data : null;
                return (
                  <Tr key={e.id} className="align-top">
                    <Td className="num whitespace-nowrap" muted>{formatDateTime(e.occurred_at)}</Td>
                    <Td className="whitespace-nowrap">{e.actor ?? <span className="text-faint">Sistema</span>}</Td>
                    <Td><StatusPill tone={a.tone}>{a.label}</StatusPill></Td>
                    <Td className="whitespace-nowrap">
                      <span className="text-ink-2">{ent?.label ?? e.entity_type}</span>
                      {e.entity_id ? (
                        ent?.href && e.action !== "delete" ? (
                          <Link href={ent.href(e.entity_id)} className="block font-mono text-[11px] text-faint hover:text-ink-2">{e.entity_id.slice(0, 8)}</Link>
                        ) : <span className="block font-mono text-[11px] text-faint">{e.entity_id.slice(0, 8)}</span>
                      ) : null}
                    </Td>
                    <Td className="min-w-80 max-w-[640px]">
                      {e.summary ? <p className="text-ink-2">{e.summary}</p> : null}
                      {changes.length ? (
                        <ul className="space-y-0.5 text-[12px]">
                          {changes.slice(0, 6).map((c) => (
                            <li key={c.key} className="break-words"><span className="font-mono text-faint">{c.key}</span>: <span className="text-muted line-through decoration-faint">{show(c.from)}</span> → <span className="text-ink-2">{show(c.to)}</span></li>
                          ))}
                          {changes.length > 6 ? <li className="text-faint">y {changes.length - 6} campos más</li> : null}
                        </ul>
                      ) : null}
                      {snapshot ? (
                        <details className="text-[12px]">
                          <summary className="cursor-pointer text-faint hover:text-ink-2">{e.action === "insert" ? "Ver datos registrados" : "Ver datos eliminados"}</summary>
                          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-elevated p-2 font-mono text-[11px] text-muted">{JSON.stringify(snapshot, null, 2)}</pre>
                        </details>
                      ) : null}
                      {e.action === "reporte_exportado" && e.after_data ? <p className="text-[12px] text-faint">Filtros: {show(e.after_data)}</p> : null}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <div className="mt-3 flex items-center justify-between text-[12px] text-faint">
        <span>Se muestran {page.length} eventos, del más reciente al más antiguo.</span>
        <div className="flex gap-2">
          {before ? <ButtonLink href={hrefWith("/auditoria", sp, { antes: null })} size="sm" variant="ghost">Volver al inicio</ButtonLink> : null}
          {more ? <ButtonLink href={hrefWith("/auditoria", sp, { antes: page[page.length - 1]!.id })} size="sm" variant="outline">Eventos anteriores</ButtonLink> : null}
        </div>
      </div>
    </>
  );
}
