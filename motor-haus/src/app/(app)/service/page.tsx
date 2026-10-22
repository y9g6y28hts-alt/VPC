import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Meter } from "@/components/ui/Chart";
import { ActionForm, Submit } from "@/components/ui/Form";
import { DISPLAY_STATUS } from "@/lib/labels";
import { date } from "@/lib/format";
import { taskAction } from "../inventory/actions";

export const metadata = { title: "Preparación y servicio" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ServicePage() {
  const ctx = await getContext();
  const units = await query(ctx, (db) => db.rows<R>(
    `select u.id, u.stock_number, u.make, u.model, u.display_status, u.received_on, u.days_in_stock, u.location_name, u.required_docs_pending, u.commercial_status,
            (select json_agg(json_build_object('id', t.id, 'title', t.title, 'mandatory', t.mandatory, 'status', t.status) order by t.sort_order)
               from public.preparation_tasks t where t.unit_id = u.id) tasks
       from public.unit_overview u
      where u.organization_id = $1 and u.logistics_status = 'received'
        and (u.preparation_status in ('in_preparation','in_service') or u.required_docs_pending > 0 or u.mandatory_tasks_pending > 0)
        and u.commercial_status not in ('delivered','retired')
      order by u.received_on`, [ctx.org.id]));
  return (
    <>
      <PageHeader title="Preparación y servicio" subtitle="Una unidad no queda lista ni se entrega con tareas obligatorias o documentación pendiente." />
      {units.length === 0 ? <Panel><Empty title="No hay unidades en preparación" /></Panel> : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {units.map((u) => {
            const tasks: R[] = u.tasks ?? [];
            const done = tasks.filter((t) => t.status !== "pending").length;
            return (
              <Panel key={u.id} title={<Link href={`/inventory/${u.id}`} className="hover:text-accent">{u.stock_number} · {u.make} {u.model}</Link>}
                subtitle={`Recibida ${date(u.received_on)} · ${u.location_name ?? "—"}`} actions={<StatusBadge map={DISPLAY_STATUS} value={u.display_status} />}>
                <div className="px-4 pt-3"><Meter value={done} max={Math.max(1, tasks.length)} tone="accent" /><p className="mt-1 text-xs text-muted">{done}/{tasks.length} tareas · {u.required_docs_pending} documento(s) obligatorio(s) pendiente(s)</p></div>
                <ul className="mt-2 divide-y divide-line-soft">
                  {tasks.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 px-4 py-1.5 text-[13px]">
                      <span className={t.status === "pending" ? "text-text" : "text-muted line-through decoration-faint"}>{t.title}{!t.mandatory && <span className="ml-1 text-xs text-faint">(opcional)</span>}</span>
                      {t.status === "pending" && can(ctx, "service.write") ? (
                        <ActionForm action={taskAction} hideMessage><input type="hidden" name="unit" value={u.id} /><input type="hidden" name="task" value={t.id} /><input type="hidden" name="status" value="done" /><Submit size="sm" variant="secondary">Completar</Submit></ActionForm>
                      ) : <Badge tone={t.status === "pending" ? "warn" : "good"}>{t.status === "pending" ? "Pendiente" : t.status === "waived" ? "Exenta" : "Hecha"}</Badge>}
                    </li>
                  ))}
                </ul>
                <p className="px-4 py-2 text-xs text-faint">Para marcar como lista, use «Cambio de estado» en la ficha de la unidad.</p>
              </Panel>
            );
          })}
        </div>
      )}
    </>
  );
}
