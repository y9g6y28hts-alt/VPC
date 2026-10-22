import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { Badge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { ActionForm, Field, Input, Select, Submit } from "@/components/ui/Form";
import { ROLE } from "@/lib/labels";
import { date } from "@/lib/format";
import { costConceptAction, holidayAction, membershipAction, policiesAction, targetAction } from "./actions";

export const metadata = { title: "Administración" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function AdminPage() {
  const ctx = await getContext();
  if (!can(ctx, "admin.users", "admin.policies")) return <Panel><Empty title="Sin acceso a administración" /></Panel>;
  const d = await query(ctx, async (db) => ({
    p: await db.one<R>("select * from public.org_policies where organization_id = $1", [ctx.org.id]),
    concepts: await db.rows<R>("select * from public.cost_concepts where organization_id = $1 order by sort_order", [ctx.org.id]),
    members: await db.rows<R>("select m.*, u.full_name, u.email, u.title from public.memberships m join public.user_profiles u on u.id = m.user_id where m.organization_id = $1 order by m.active desc, u.full_name", [ctx.org.id]),
    roles: await db.rows<R>("select r.code, r.name, r.description, (select count(*) from public.role_permissions rp where rp.role_code = r.code) perms from public.roles r order by sort_order"),
    holidays: await db.rows<R>("select * from public.org_holidays where organization_id = $1 order by holiday_date", [ctx.org.id]),
    targets: await db.rows<R>("select t.*, p.full_name from public.sales_targets t left join public.user_profiles p on p.id = t.salesperson_id where t.organization_id = $1 order by period_month desc limit 12", [ctx.org.id]),
  }));
  const p = d.p;
  const pol = can(ctx, "admin.policies");
  const n = (name: string, labelText: string, value: unknown, hint?: string) => (
    <Field label={labelText} name={name} hint={hint}><Input name={name} inputMode="decimal" defaultValue={String(value)} disabled={!pol} /></Field>
  );
  return (
    <>
      <PageHeader title="Administración" subtitle="Umbrales y reglas explícitas: ninguna alerta ni aprobación se dispara sin una regla configurada aquí. Todo cambio queda auditado." />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title="Políticas comerciales, financieras y de alertas">
            <ActionForm action={policiesAction} className="grid grid-cols-2 gap-3 px-4 py-3 md:grid-cols-4">
              {n("max_discount_pct", "Descuento máximo %", p.max_discount_pct)}
              {n("min_margin_pct", "Margen mínimo %", p.min_margin_pct)}
              {n("max_financing_months", "Plazo máximo (meses)", p.max_financing_months)}
              {n("min_effective_annual_rate_pct", "TEA mínima %", (Number(p.min_effective_annual_rate) * 100).toFixed(2), "Por debajo requiere aprobación")}
              {n("reservation_default_hours", "Reserva por defecto (h)", p.reservation_default_hours)}
              {n("reservation_max_days", "Reserva máxima (días)", p.reservation_max_days)}
              {n("reservation_expiry_alert_hours", "Alerta de reserva (h antes)", p.reservation_expiry_alert_hours)}
              {n("stale_inventory_days", "Inventario inmovilizado (días)", p.stale_inventory_days)}
              {n("import_delay_alert_days", "Demora de importación (días)", p.import_delay_alert_days)}
              {n("payment_reconciliation_alert_days", "Pago sin conciliar (días)", p.payment_reconciliation_alert_days)}
              {n("payable_due_soon_days", "Facturas por vencer (días)", p.payable_due_soon_days)}
              {n("installment_due_soon_days", "Cuotas próximas (días)", p.installment_due_soon_days)}
              {n("grace_days", "Gracia de mora (días)", p.grace_days)}
              <Field label="Vencimiento en día inhábil" name="due_date_roll"><Select name="due_date_roll" defaultValue={p.due_date_roll} disabled={!pol} options={[["none", "Sin traslado"], ["next_business_day", "Siguiente día hábil"]]} /></Field>
              <Field label="Tramos de mora (días)" name="aging_buckets"><Input name="aging_buckets" defaultValue={(p.aging_buckets as number[]).join(", ")} disabled={!pol} /></Field>
              <Field label="Prioridad de cobranza" name="collections_priority"><Select name="collections_priority" defaultValue={p.collections_priority} disabled={!pol} options={[["overdue_amount", "Mayor deuda vencida"], ["days_past_due", "Mayor atraso"], ["next_due", "Próximo vencimiento"]]} /></Field>
              <label className="col-span-2 flex items-center gap-2 text-xs text-text-2"><input type="checkbox" name="require_down_payment_before_delivery" defaultChecked={p.require_down_payment_before_delivery} disabled={!pol} /> Exigir entrega inicial cobrada antes de entregar</label>
              <label className="col-span-2 flex items-center gap-2 text-xs text-text-2"><input type="checkbox" name="require_full_payment_before_delivery" defaultChecked={p.require_full_payment_before_delivery} disabled={!pol} /> Exigir pago total antes de entregar</label>
              <label className="col-span-2 flex items-center gap-2 text-xs text-text-2"><input type="checkbox" name="approval_segregation" defaultChecked={p.approval_segregation} disabled={!pol} /> Segregación: quien solicita o registra no aprueba ni confirma</label>
              <div className="col-span-2 md:col-span-4">{pol ? <Submit>Guardar políticas</Submit> : <p className="text-xs text-faint">Solo lectura: requiere admin.policies.</p>}</div>
            </ActionForm>
          </Panel>
          <Panel title="Usuarios y roles" subtitle="La creación de usuarios se realiza en Supabase Auth (invitación); aquí se asignan roles y se activan o desactivan membresías.">
            <table className="mh-table">
              <thead><tr><th>Usuario</th><th>Correo</th><th>Rol</th><th>Estado</th><th></th></tr></thead>
              <tbody>{d.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.full_name}<div className="text-xs text-faint">{m.title}</div></td><td className="text-text-2">{m.email}</td>
                  <td colSpan={3}>
                    {can(ctx, "admin.users") && m.user_id !== ctx.user.id ? (
                      <ActionForm action={membershipAction} hideMessage className="flex items-center gap-2">
                        <input type="hidden" name="user" value={m.user_id} />
                        <Select name="role" defaultValue={m.role_code} className="w-56" options={d.roles.map((r) => [r.code, r.name])} />
                        <Select name="active" defaultValue={String(m.active)} className="w-28" options={[["true", "Activo"], ["false", "Inactivo"]]} />
                        <Submit size="sm" variant="secondary">Guardar</Submit>
                      </ActionForm>
                    ) : <span className="text-text-2">{ROLE[m.role_code]} {m.user_id === ctx.user.id && <Badge>usted</Badge>}</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </Panel>
          <Panel title="Roles del sistema">
            <table className="mh-table"><tbody>{d.roles.map((r) => <tr key={r.code}><td className="w-56 text-text">{r.name}</td><td className="text-text-2">{r.description}</td><td className="r text-xs text-muted">{r.perms} permisos</td></tr>)}</tbody></table>
          </Panel>
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Política de costes de inventario" subtitle="Qué conceptos integran el coste gerencial (definir con el asesor contable)">
            <ul className="divide-y divide-line-soft">{d.concepts.map((c) => (
              <li key={c.code} className="flex items-center justify-between px-4 py-2 text-[13px]">
                <span>{c.label}</span>
                {pol ? (
                  <ActionForm action={costConceptAction} hideMessage><input type="hidden" name="code" value={c.code} /><input type="hidden" name="include" value={String(!c.include_in_inventory_cost)} />
                    <Submit size="sm" variant={c.include_in_inventory_cost ? "secondary" : "ghost"}>{c.include_in_inventory_cost ? "Incluido" : "Excluido"}</Submit></ActionForm>
                ) : <Badge tone={c.include_in_inventory_cost ? "good" : "neutral"}>{c.include_in_inventory_cost ? "Incluido" : "Excluido"}</Badge>}
              </li>
            ))}</ul>
          </Panel>
          <Panel title="Objetivos comerciales">
            <ul className="divide-y divide-line-soft text-xs">{d.targets.map((t) => <li key={t.id} className="flex justify-between px-4 py-1.5"><span>{t.period_month.slice(0, 7)} · {t.full_name ?? "Empresa"}</span><span><Money value={t.target_revenue} currency={t.currency} /> · {t.target_units} u.</span></li>)}</ul>
            {pol && (
              <ActionForm action={targetAction} className="grid grid-cols-2 gap-2 border-t border-line-soft px-4 py-3">
                <Field label="Mes" name="month"><Input type="month" name="month" defaultValue={ctx.today.slice(0, 7)} /></Field>
                <Field label="Moneda" name="currency"><Select name="currency" options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]]} /></Field>
                <Field label="Ventas objetivo" name="revenue"><Input name="revenue" inputMode="decimal" /></Field>
                <Field label="Unidades" name="units"><Input name="units" type="number" min={0} /></Field>
                <input type="hidden" name="salesperson" value="" />
                <div className="col-span-2"><Submit variant="secondary">Guardar objetivo</Submit></div>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Feriados (vencimientos)">
            <ul className="px-4 py-2 text-xs text-text-2">{d.holidays.length === 0 ? <li className="text-faint">Sin feriados cargados</li> : d.holidays.map((h) => <li key={h.holiday_date}>{date(h.holiday_date)} · {h.label}</li>)}</ul>
            {pol && (
              <ActionForm action={holidayAction} resetOnSuccess className="flex items-end gap-2 border-t border-line-soft px-4 py-3">
                <Field label="Fecha" name="date"><Input type="date" name="date" /></Field>
                <Field label="Descripción" name="label" className="flex-1"><Input name="label" /></Field>
                <Submit size="sm" variant="secondary">Agregar</Submit>
              </ActionForm>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
