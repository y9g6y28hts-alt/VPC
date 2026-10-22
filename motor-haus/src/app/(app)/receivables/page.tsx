import Link from "next/link";
import { getContext, query, can } from "@/server/context";
import { resolveCurrency } from "@/server/filters";
import { PageHeader, Panel, Empty, Figure } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { BarChart, Meter } from "@/components/ui/Chart";
import { orderBy, SearchParams, SortTh, sp } from "@/components/ui/Table";
import { ACCOUNT_STATUS, OUTCOME, label } from "@/lib/labels";
import { date, monthLabel, num } from "@/lib/format";

export const metadata = { title: "Cuentas por cobrar" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "receivable.read", "receivable.read_own")) return <Panel><Empty title="Sin acceso a cuentas por cobrar" /></Panel>;
  const ccy = resolveCurrency(params, ctx.org.currency);
  const q = sp(params, "q")?.trim() ?? "";
  const state = sp(params, "state") ?? "open";
  const order = orderBy(params, { overdue: "overdue", dpd: "max_dpd", next: "next_due", customer: "customer", outstanding: "outstanding" }, "overdue desc, max_dpd desc");
  const pol = await query(ctx, (db) => db.one<R>("select collections_priority, aging_buckets, grace_days from public.org_policies where organization_id = $1", [ctx.org.id]));
  const prioritySql = { overdue_amount: "overdue desc, max_dpd desc", days_past_due: "max_dpd desc, overdue desc", next_due: "next_due asc nulls last" }[pol.collections_priority as string];

  const d = await query(ctx, async (db) => {
    const portfolio = await db.rows<R>(
      `with acc as (
         select cb.customer_id, cu.display_name customer, cu.owner_user_id,
           string_agg(distinct cb.number, ', ') contracts, count(*) n_contracts,
           string_agg(distinct (select string_agg(u.make || ' ' || u.model, ', ') from public.deal_items di join public.units u on u.id = di.unit_id
                                join public.sales_contracts sc on sc.deal_id = di.deal_id where sc.id = cb.contract_id), '; ') units,
           string_agg(distinct p.full_name, ', ') salesperson,
           sum(cb.total_obligations) contractual, sum(cb.collected_confirmed) collected, sum(cb.pending_reconciliation) pending_rec,
           sum(cb.outstanding) outstanding, sum(cb.overdue_amount) overdue, max(cb.max_days_past_due) max_dpd,
           min(cb.next_due_date) next_due, max(cb.last_payment_date) last_payment,
           case when sum(cb.overdue_amount) > 0 then 'overdue' when sum(cb.outstanding) > 0 then 'current' else 'settled' end account_status
         from public.contract_balances cb join public.customers cu on cu.id = cb.customer_id
         left join public.user_profiles p on p.id = cb.salesperson_id
         where cb.organization_id = $1 and cb.currency = $2 and cb.status <> 'cancelled'
         group by cb.customer_id, cu.display_name, cu.owner_user_id)
       select acc.*, (select pr.full_name from public.collection_actions ca join public.user_profiles pr on pr.id = ca.user_id
                      where ca.customer_id = acc.customer_id order by ca.contacted_at desc limit 1) follow_up,
              ow.full_name owner_name
         from acc left join public.user_profiles ow on ow.id = acc.owner_user_id
        where ($3 = 'all' or ($3 = 'open' and outstanding > 0) or ($3 = 'overdue' and overdue > 0))
          and ($4 = '' or customer ilike '%' || $4 || '%' or contracts ilike '%' || $4 || '%' or coalesce(units, '') ilike '%' || $4 || '%')
        order by ${order}`, [ctx.org.id, ccy, state, q]);
    const tray = await db.rows<R>(
      `select * from (
         select cb.customer_id, cu.display_name customer, sum(cb.overdue_amount) overdue, max(cb.max_days_past_due) max_dpd,
                min(cb.next_due_date) next_due,
                (select ca.next_action from public.collection_actions ca where ca.customer_id = cb.customer_id order by ca.contacted_at desc limit 1) next_action,
                (select ca.next_action_date from public.collection_actions ca where ca.customer_id = cb.customer_id order by ca.contacted_at desc limit 1) next_action_date,
                (select cp.promise_status from public.collection_promises cp where cp.customer_id = cb.customer_id and cp.outcome = 'promise' order by cp.contacted_at desc limit 1) promise_status,
                (select cp.promise_date from public.collection_promises cp where cp.customer_id = cb.customer_id and cp.outcome = 'promise' order by cp.contacted_at desc limit 1) promise_date
           from public.contract_balances cb join public.customers cu on cu.id = cb.customer_id
          where cb.organization_id = $1 and cb.currency = $2 and cb.status <> 'cancelled'
          group by cb.customer_id, cu.display_name) t
        where overdue > 0 or (next_action_date is not null and next_action_date <= app.today()) or promise_status = 'broken'
           or (promise_status = 'pending' and promise_date <= app.today() + 2)
        order by ${prioritySql} limit 25`, [ctx.org.id, ccy]);
    const aging = await db.rows<R>("select * from public.receivables_aging($1, $2)", [ctx.org.id, ccy]);
    const kpi = await db.one<R>(
      `select
         (select coalesce(sum(outstanding), 0) from public.contract_balances where organization_id = $1 and currency = $2 and status <> 'cancelled') outstanding,
         (select coalesce(sum(overdue_amount), 0) from public.contract_balances where organization_id = $1 and currency = $2 and status <> 'cancelled') overdue,
         (select count(distinct customer_id) from public.contract_balances where organization_id = $1 and currency = $2 and overdue_amount > 0) accounts_overdue,
         (select coalesce(sum(pending_reconciliation), 0) from public.contract_balances where organization_id = $1 and currency = $2) pending_rec,
         (select count(*) from public.collection_promises where organization_id = $1 and promise_currency = $2 and promise_status = 'pending') promises_pending,
         (select coalesce(sum(promise_amount - paid_since_promise), 0) from public.collection_promises where organization_id = $1 and promise_currency = $2 and promise_status = 'pending') promises_amount,
         (select coalesce(sum(pa.amount), 0) from public.payment_allocations pa join public.customer_payments cp on cp.id = pa.payment_id
            join public.receivable_installments i on i.id = pa.installment_id
           where cp.organization_id = $1 and cp.currency = $2 and cp.status = 'confirmed'
             and cp.effective_date >= date_trunc('month', app.today()) and cp.effective_date > app.exigible_date(i.organization_id, i.due_date) + $3::int) recovered_month,
         (select coalesce(sum(s.total_due), 0) from public.installment_status s where s.organization_id = $1 and s.currency = $2
             and s.due_date between date_trunc('month', app.today())::date and app.today()) exigible_month,
         (select coalesce(sum(least(s.paid_confirmed, s.total_due)), 0) from public.installment_status s where s.organization_id = $1 and s.currency = $2
             and s.due_date between date_trunc('month', app.today())::date and app.today()) collected_on_exigible_month`,
      [ctx.org.id, ccy, pol.grace_days]);
    const trend = await db.rows<R>(
      `select to_char(m, 'YYYY-MM') as month,
         coalesce((select sum(greatest(i.amount_due
              + coalesce((select sum(a.amount) from public.installment_adjustments a where a.installment_id = i.id and a.effective_date <= m), 0)
              - coalesce((select sum(pa.amount) from public.payment_allocations pa join public.customer_payments cp on cp.id = pa.payment_id
                          where pa.installment_id = i.id and cp.status = 'confirmed' and cp.effective_date <= m), 0), 0))
           from public.receivable_installments i join public.sales_contracts c on c.id = i.contract_id
          where i.organization_id = $1 and i.currency = $2 and i.status = 'open' and c.status <> 'cancelled'
            and app.exigible_date(i.organization_id, i.due_date) + $3::int < m), 0) as overdue
       from (select least((date_trunc('month', app.today()) + make_interval(months => g + 1) - interval '1 day')::date, app.today()) m
               from generate_series(-5, 0) g) months order by m`, [ctx.org.id, ccy, pol.grace_days]);
    return { portfolio, tray, aging, kpi, trend };
  });
  const k = d.kpi;
  const agingMax = Math.max(1, ...d.aging.map((a) => Number(a.amount)));
  const base = "/receivables";
  return (
    <>
      <PageHeader title="Cuentas por cobrar" subtitle={`Cartera en ${ccy}: quién debe, cuánto, por qué y desde cuándo. Solo los pagos confirmados cuentan como cobrados.`} />
      <FilterBar base={base} filters={[
        { name: "q", label: "Buscar", type: "search", value: q, placeholder: "Cliente, contrato, unidad" },
        { name: "state", label: "Cuentas", value: state, options: [["open", "Con saldo"], ["overdue", "En mora"], ["all", "Todas"]] },
        { name: "ccy", label: "Moneda", value: ccy, options: [["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]] },
      ]} />
      <Panel className="mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-b [&>*]:border-r [&>*]:border-line-soft">
          <Figure label="Saldo pendiente" value={<Money value={k.outstanding} currency={ccy} />} note="Σ obligaciones + ajustes − cobros confirmados" />
          <Figure label="Total vencido" tone="risk" value={<Money value={k.overdue} currency={ccy} />} note={`Exigible + ${pol.grace_days} días de gracia, impago`} />
          <Figure label="% cartera vencida" value={Number(k.outstanding) > 0 ? `${num((Number(k.overdue) / Number(k.outstanding)) * 100, 1)} %` : "—"} note="Vencido ÷ saldo pendiente" />
          <Figure label="Cuentas en mora" value={num(k.accounts_overdue)} note="Clientes con al menos una cuota vencida" />
          <Figure label="Cobranza efectiva (mes)" value={Number(k.exigible_month) > 0 ? `${num((Number(k.collected_on_exigible_month) / Number(k.exigible_month)) * 100, 1)} %` : "—"}
            note={<>Cobrado confirmado ÷ exigible del mes (<Money value={k.exigible_month} currency={ccy} />)</>} />
          <Figure label="Recuperación de deuda (mes)" value={<Money value={k.recovered_month} currency={ccy} />} note="Cobros confirmados aplicados a cuotas ya vencidas" />
          <Figure label="Promesas pendientes" value={num(k.promises_pending)} note={<>Por <Money value={k.promises_amount} currency={ccy} /> · no son pagos</>} />
          <Figure label="Pagos sin conciliar" value={<Money value={k.pending_rec} currency={ccy} />} note="Asignados, no cuentan como cobrados" href="/payments?status=pending_reconciliation" />
        </div>
      </Panel>

      <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Bandeja diaria de seguimiento" subtitle={`Prioridad: ${{ overdue_amount: "mayor deuda vencida", days_past_due: "mayor atraso", next_due: "próximo vencimiento" }[pol.collections_priority as string]} (configurable)`}>
          {d.tray.length === 0 ? <Empty title="Sin cuentas que requieran acción hoy" /> : (
            <table className="mh-table">
              <thead><tr><th>Cliente</th><th className="r">Vencido</th><th className="r">Atraso</th><th>Compromiso</th><th>Próxima acción</th></tr></thead>
              <tbody>
                {d.tray.map((t) => (
                  <tr key={t.customer_id}>
                    <td><Link href={`${base}/${t.customer_id}`} className="text-text hover:text-accent">{t.customer}</Link></td>
                    <td className="r"><Money value={t.overdue} currency={ccy} /></td>
                    <td className="r num">{t.max_dpd ? `${t.max_dpd} d` : "—"}</td>
                    <td>{t.promise_status ? <Badge tone={t.promise_status === "broken" ? "risk" : t.promise_status === "kept" ? "good" : "warn"}>{{ broken: "Incumplido", kept: "Cumplido", pending: `Para ${date(t.promise_date)}` }[t.promise_status as string]}</Badge> : <span className="text-faint">—</span>}</td>
                    <td className="text-xs text-text-2">{t.next_action ? `${t.next_action} · ${date(t.next_action_date)}` : "Sin gestión registrada"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <div className="grid gap-4">
          <Panel title="Antigüedad de deuda" subtitle={`Tramos configurables: ${(pol.aging_buckets as number[]).join(" / ")} días`}>
            <table className="mh-table"><tbody>
              {d.aging.map((b) => (
                <tr key={b.bucket_order}><td className="w-36 text-text-2">{b.bucket_label}</td>
                  <td><Meter value={Number(b.amount)} max={agingMax} tone={b.bucket_order === 0 ? "muted" : b.bucket_order >= 3 ? "risk" : "warn"} /></td>
                  <td className="r"><Money value={b.amount} currency={ccy} /></td><td className="r text-xs text-muted">{num(b.contracts)} ctos.</td></tr>
              ))}
            </tbody></table>
          </Panel>
          <Panel title="Evolución de la morosidad" subtitle="Saldo vencido al cierre de cada mes (pagos confirmados a esa fecha)">
            <div className="px-4 py-3">
              <BarChart currency={ccy} width={460} height={160} ariaLabel="Saldo vencido por mes" series={["Saldo vencido"]}
                data={d.trend.map((t) => ({ label: monthLabel(t.month), values: [Number(t.overdue)] }))} />
            </div>
          </Panel>
        </div>
      </div>

      <Panel title="Cartera por cliente" subtitle="Una fila por cliente; el detalle por contrato y obligación está en su estado de cuenta">
        {d.portfolio.length === 0 ? <Empty title="Sin cuentas con estos filtros" /> : (
          <div className="overflow-x-auto">
            <table className="mh-table">
              <thead><tr>
                <SortTh label="Cliente" field="customer" base={base} params={params} defaultDir="asc" />
                <th>Contratos</th><th>Unidad(es)</th><th>Vendedor</th>
                <th className="r">Contractual</th><th className="r">Cobrado</th>
                <SortTh label="Pendiente" field="outstanding" base={base} params={params} right />
                <SortTh label="Vencido" field="overdue" base={base} params={params} right />
                <SortTh label="Próx. venc." field="next" base={base} params={params} defaultDir="asc" />
                <SortTh label="Atraso" field="dpd" base={base} params={params} right />
                <th>Último pago</th><th>Estado</th><th>Seguimiento</th>
              </tr></thead>
              <tbody>
                {d.portfolio.map((r) => (
                  <tr key={r.customer_id}>
                    <td><Link href={`${base}/${r.customer_id}`} className="text-text hover:text-accent">{r.customer}</Link></td>
                    <td className="text-xs text-text-2">{r.contracts}</td>
                    <td className="max-w-48 truncate text-xs text-text-2" title={r.units}>{r.units}</td>
                    <td className="text-xs text-text-2">{r.salesperson}</td>
                    <td className="r"><Money value={r.contractual} currency={ccy} muted /></td>
                    <td className="r"><Money value={r.collected} currency={ccy} />{Number(r.pending_rec) > 0 && <div className="text-xs text-warn">+<Money value={r.pending_rec} currency={ccy} /> s/conciliar</div>}</td>
                    <td className="r"><Money value={r.outstanding} currency={ccy} /></td>
                    <td className="r">{Number(r.overdue) > 0 ? <Money value={r.overdue} currency={ccy} className="text-risk" /> : <span className="text-faint">—</span>}</td>
                    <td className="num text-text-2">{date(r.next_due)}</td>
                    <td className="r num">{r.max_dpd > 0 ? `${r.max_dpd} d` : "—"}</td>
                    <td className="num text-text-2">{date(r.last_payment)}</td>
                    <td><StatusBadge map={ACCOUNT_STATUS} value={r.account_status} /></td>
                    <td className="text-xs text-text-2">{r.follow_up ?? r.owner_name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <p className="mt-3 text-xs text-faint">Una cuota se considera vencida cuando la fecha actual supera su fecha exigible más el período de gracia ({pol.grace_days} días). Los días de atraso se cuentan desde la fecha exigible. {label(OUTCOME, "promise")}s no se suman como cobros.</p>
    </>
  );
}
