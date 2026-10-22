import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Tabs } from "@/components/ui/Layout";
import { StatusBadge, Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ActionForm, Input, Submit } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { APPROVAL_STATUS, PAYABLE_CATEGORY, RULE, label } from "@/lib/labels";
import { date, dateTime } from "@/lib/format";
import { decideAction, decidePayableAction } from "./actions";

export const metadata = { title: "Aprobaciones" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

function describe(v: R): string {
  return Object.entries(v ?? {}).map(([k, x]) => `${k.replaceAll("_", " ")}: ${typeof x === "number" ? x.toLocaleString("es-PY") : String(x)}`).join(" · ");
}

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  const tab = sp(params, "tab") ?? "pending";
  const d = await query(ctx, async (db) => ({
    approvals: await db.rows<R>(
      `select a.*, r.full_name requester, x.full_name decider,
              coalesce(d.number, t.number) entity_number, coalesce(d.currency, t.currency) currency,
              coalesce(cd.display_name, ct.display_name) customer, d.salesperson_id
         from public.approvals a
         left join public.user_profiles r on r.id = a.requested_by left join public.user_profiles x on x.id = a.decided_by
         left join public.deals d on a.entity_type = 'deal' and d.id = a.entity_id left join public.customers cd on cd.id = d.customer_id
         left join public.trade_in_appraisals t on a.entity_type = 'trade_in_appraisal' and t.id = a.entity_id left join public.customers ct on ct.id = t.customer_id
        where a.organization_id = $1 and (($2 = 'pending' and a.status = 'pending') or ($2 = 'history' and a.status <> 'pending'))
        order by a.requested_at desc limit 200`, [ctx.org.id, tab]),
    payables: can(ctx, "payable.approve") && tab === "pending" ? await db.rows<R>(
      "select * from public.payable_status where organization_id = $1 and approval_status = 'pending' and not cancelled order by due_date", [ctx.org.id]) : [],
  }));
  const href = (a: R) => (a.entity_type === "deal" ? `/deals/${a.entity_id}` : `/appraisals/${a.entity_id}`);
  return (
    <>
      <PageHeader title="Aprobaciones" subtitle="Excepciones comerciales, tasaciones y facturas. Se registra el valor original, el solicitado, la decisión y quién la tomó. Quien solicita no puede aprobar." />
      <Tabs current={tab} tabs={[{ key: "pending", label: "Pendientes", href: "/approvals", count: d.approvals.length + d.payables.length }, { key: "history", label: "Historial", href: "/approvals?tab=history" }]} />
      <Panel title="Excepciones comerciales y tasaciones" className="mb-4">
        {d.approvals.length === 0 ? <Empty title={tab === "pending" ? "No hay solicitudes pendientes" : "Sin historial"} /> : (
          <ul className="divide-y divide-line-soft">
            {d.approvals.map((a) => {
              const canDecide = a.status === "pending" && ctx.perms.has(a.required_permission) && a.requested_by !== ctx.user.id && a.salesperson_id !== ctx.user.id;
              return (
                <li key={a.id} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[1.4fr_1fr]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="info">{label(RULE, a.rule)}</Badge>
                      <Link href={href(a)} className="text-[13px] text-text hover:text-accent">{a.entity_type === "deal" ? "Operación" : "Tasación"} {a.entity_number}</Link>
                      <span className="text-xs text-muted">· {a.customer}</span>
                      <StatusBadge map={APPROVAL_STATUS} value={a.status} />
                    </div>
                    <p className="mt-1 text-[13px] text-text-2">{a.message}</p>
                    <p className="text-xs text-muted">Límite: {describe(a.limit_value)} · Solicitado: {describe(a.requested_value)}</p>
                    <p className="text-xs text-faint">Solicitó {a.requester} · {dateTime(a.requested_at)} · requiere {a.required_permission}
                      {a.decider && <> · decidió {a.decider} el {dateTime(a.decided_at)}: “{a.decision_note}”</>}{!a.decider && a.status === "void" && <> · {a.decision_note}</>}</p>
                  </div>
                  {canDecide ? (
                    <ActionForm action={decideAction} className="flex items-start gap-2">
                      <input type="hidden" name="approval" value={a.id} />
                      <Input name="note" placeholder="Fundamento de la decisión" />
                      <Submit name="decision" value="approved">Aprobar</Submit>
                      <Submit name="decision" value="rejected" variant="danger">Rechazar</Submit>
                    </ActionForm>
                  ) : a.status === "pending" ? <p className="text-xs text-faint">{a.requested_by === ctx.user.id ? "Usted solicitó esta excepción: no puede aprobarla." : "No tiene la facultad requerida para decidir."}</p> : <div />}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
      {d.payables.length > 0 && (
        <Panel title="Facturas de proveedores pendientes de aprobación">
          <table className="mh-table">
            <thead><tr><th>Proveedor</th><th>Documento</th><th>Concepto</th><th>Categoría</th><th>Vence</th><th className="r">Importe</th><th></th></tr></thead>
            <tbody>{d.payables.map((p) => (
              <tr key={p.id}>
                <td>{p.supplier_name}</td><td className="text-text-2">{p.document_number}</td><td className="text-text-2">{p.concept}</td>
                <td className="text-text-2">{label(PAYABLE_CATEGORY, p.category)}</td><td className="num">{date(p.due_date)}</td>
                <td className="r"><Money value={p.amount} currency={p.currency} /></td>
                <td>{p.created_by === ctx.user.id ? <span className="text-xs text-faint">Registrada por usted</span> : (
                  <ActionForm action={decidePayableAction} className="flex gap-1"><input type="hidden" name="payable" value={p.id} />
                    <Submit size="sm" name="decision" value="approved">Aprobar</Submit><Submit size="sm" variant="danger" name="decision" value="rejected">Rechazar</Submit></ActionForm>
                )}</td>
              </tr>
            ))}</tbody>
          </table>
        </Panel>
      )}
    </>
  );
}
