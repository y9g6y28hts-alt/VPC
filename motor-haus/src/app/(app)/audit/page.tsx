import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { SearchParams, sp, hrefWith } from "@/components/ui/Table";
import { dateTime } from "@/lib/format";
import Link from "next/link";

export const metadata = { title: "Auditoría" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function AuditPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "audit.read")) return <Panel><Empty title="Se requiere el permiso audit.read" /></Panel>;
  const entity = sp(params, "entity") ?? "";
  const action = sp(params, "action") ?? "";
  const actor = sp(params, "actor") ?? "";
  const page = Math.max(0, Number(sp(params, "page") ?? 0) || 0);
  const d = await query(ctx, async (db) => ({
    rows: await db.rows<R>(
      `select a.*, p.full_name actor from public.audit_events a left join public.user_profiles p on p.id = a.actor_id
        where a.organization_id = $1 and ($2 = '' or a.entity_type = $2) and ($3 = '' or a.action = $3) and ($4 = '' or a.actor_id::text = $4)
        order by a.id desc limit 101 offset $5`, [ctx.org.id, entity, action, actor, page * 100]),
    entities: await db.rows<R>("select distinct entity_type from public.audit_events where organization_id = $1 order by 1", [ctx.org.id]),
    actions: await db.rows<R>("select distinct action from public.audit_events where organization_id = $1 order by 1", [ctx.org.id]),
    actors: await db.rows<R>("select distinct p.id, p.full_name from public.audit_events a join public.user_profiles p on p.id = a.actor_id where a.organization_id = $1 order by 2", [ctx.org.id]),
  }));
  return (
    <>
      <PageHeader title="Registro de auditoría" subtitle="Inmutable: actor, entidad, acción, identificador de operación y valores anteriores/posteriores. No contiene documentos de identidad completos." />
      <FilterBar base="/audit" filters={[
        { name: "entity", label: "Entidad", value: entity, all: "Todas", options: d.entities.map((e) => [e.entity_type, e.entity_type]) },
        { name: "action", label: "Acción", value: action, all: "Todas", options: d.actions.map((e) => [e.action, e.action]) },
        { name: "actor", label: "Usuario", value: actor, all: "Todos", options: d.actors.map((e) => [e.id, e.full_name]) },
      ]} />
      <Panel>
        {d.rows.length === 0 ? <Empty title="Sin eventos" /> : (
          <table className="mh-table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Cambios</th><th>Operación</th></tr></thead>
            <tbody>{d.rows.slice(0, 100).map((e) => (
              <tr key={e.id} className="align-top">
                <td className="num whitespace-nowrap text-text-2">{dateTime(e.occurred_at)}</td>
                <td className="text-text-2">{e.actor ?? "sistema"}</td>
                <td><span className="text-text">{e.action}</span></td>
                <td className="text-xs text-text-2">{e.entity_type}<div className="text-faint">{e.entity_id?.slice(0, 8)}</div></td>
                <td className="max-w-xl text-xs">
                  {e.changed_fields?.length ? e.changed_fields.map((f: string) => (
                    <div key={f} className="truncate"><span className="text-muted">{f}:</span> <span className="text-risk/80">{JSON.stringify(e.before_data?.[f])}</span> → <span className="text-good">{JSON.stringify(e.after_data?.[f])}</span></div>
                  )) : <span className="line-clamp-2 break-all text-faint">{JSON.stringify(e.after_data ?? e.context ?? e.before_data)?.slice(0, 220)}</span>}
                </td>
                <td className="text-xs text-faint"><Link href={hrefWith("/audit", {}, {})} title={e.op_id}>{String(e.op_id).slice(0, 8)}</Link></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <div className="flex justify-between px-4 py-2 text-xs">
          {page > 0 ? <Link href={hrefWith("/audit", params, { page: String(page - 1) })} className="text-muted hover:text-text">← Más recientes</Link> : <span />}
          {d.rows.length > 100 && <Link href={hrefWith("/audit", params, { page: String(page + 1) })} className="text-muted hover:text-text">Anteriores →</Link>}
        </div>
      </Panel>
    </>
  );
}
