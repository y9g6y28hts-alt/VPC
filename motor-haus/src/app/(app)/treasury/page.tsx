import { getContext, query, can } from "@/server/context";
import { resolveCurrency } from "@/server/filters";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { FilterBar } from "@/components/ui/FilterBar";
import { Badge, Basis } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { BarChart } from "@/components/ui/Chart";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { CASH_CATEGORY, label } from "@/lib/labels";
import { date, monthLabel } from "@/lib/format";
import { uuidOrNull } from "@/server/filters";
import { createAccountAction, movementAction, postMovementAction, reconcileAction, reverseMovementAction } from "./actions";

export const metadata = { title: "Tesorería" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function TreasuryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "treasury.read")) return <Panel><Empty title="Se requiere el permiso treasury.read" /></Panel>;
  const ccy = resolveCurrency(params, ctx.org.currency);
  const d = await query(ctx, async (db) => {
    const accounts = await db.rows<R>("select * from public.cash_account_balances where organization_id = $1 order by currency, name", [ctx.org.id]);
    const account = uuidOrNull(sp(params, "account")) ?? accounts.find((a) => a.currency === ccy)?.cash_account_id ?? accounts[0]?.cash_account_id;
    return {
      accounts, account,
      movements: account ? await db.rows<R>("select m.*, p.full_name actor, (select 1 from public.cash_movements r where r.reverses_movement_id = m.id) reversed from public.cash_movements m left join public.user_profiles p on p.id = m.created_by where m.cash_account_id = $1 order by m.movement_date desc, m.created_at desc limit 200", [account]) : [],
      projection: can(ctx, "receivable.read") && can(ctx, "payable.read") ? await db.rows<R>("select * from public.cash_projection($1, $2, 6)", [ctx.org.id, ccy]) : [],
      recs: account ? await db.rows<R>("select r.*, p.full_name usr from public.bank_reconciliations r left join public.user_profiles p on p.id = r.reconciled_by where r.cash_account_id = $1 order by statement_date desc limit 5", [account]) : [],
    };
  });
  const acc = d.accounts.find((a) => a.cash_account_id === d.account);
  const unreconciled = d.movements.filter((m) => m.status === "posted" && m.reconciliation_status === "unreconciled");
  return (
    <>
      <PageHeader title="Tesorería" subtitle="Caja y bancos. Sin integración bancaria: todos los saldos son registrados manualmente y deben conciliarse con los extractos." />
      <FilterBar base="/treasury" filters={[
        { name: "account", label: "Cuenta", value: d.account ?? "", options: d.accounts.map((a) => [a.cash_account_id, `${a.name} (${a.currency})`]) },
        { name: "ccy", label: "Proyección en", value: ccy, options: [["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]] },
      ]} />
      <Panel className="mb-4" title="Cuentas financieras" actions={<Basis kind="manual" />}>
        <table className="mh-table">
          <thead><tr><th>Cuenta</th><th>Tipo</th><th>Moneda</th><th className="r">Saldo contabilizado</th><th className="r">Movimientos pendientes</th><th className="r">Sin conciliar</th><th>Último movimiento</th><th>Última conciliación</th></tr></thead>
          <tbody>{d.accounts.map((a) => (
            <tr key={a.cash_account_id} className={a.cash_account_id === d.account ? "bg-raised" : ""}>
              <td>{a.name}</td><td className="text-text-2">{{ bank: "Banco", cash: "Caja", card_processor: "Procesador de tarjetas", other: "Otra" }[a.kind as string]}</td><td>{a.currency}</td>
              <td className="r"><Money value={a.posted_balance} currency={a.currency} /></td><td className="r"><Money value={a.pending_amount} currency={a.currency} muted /></td>
              <td className="r num">{a.unreconciled_count}</td><td className="num text-text-2">{date(a.last_movement_date)}</td><td className="num text-text-2">{date(a.last_reconciled_on)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Panel>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <Panel title={`Movimientos · ${acc?.name ?? ""}`} subtitle="Los movimientos contabilizados no se editan: se corrigen con contrapartidas">
            {d.movements.length === 0 ? <Empty title="Sin movimientos" /> : (
              <div className="max-h-[560px] overflow-auto"><table className="mh-table">
                <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Contraparte / ref.</th><th className="r">Importe</th><th>Estado</th><th></th></tr></thead>
                <tbody>{d.movements.map((m) => (
                  <tr key={m.id}>
                    <td className="num">{date(m.movement_date)}</td><td className="text-text-2">{label(CASH_CATEGORY, m.category)}</td>
                    <td className="max-w-64 truncate" title={m.description}>{m.description}</td>
                    <td className="text-xs text-text-2">{m.counterparty ?? "—"}<div className="text-faint">{m.reference ?? ""}</div></td>
                    <td className="r"><Money value={m.amount} currency={m.currency} /></td>
                    <td>{m.status === "pending" ? <Badge tone="warn">Pendiente</Badge> : m.reconciliation_status === "reconciled" ? <Badge tone="good">Conciliado</Badge> : <Badge tone="neutral">Sin conciliar</Badge>}</td>
                    <td className="whitespace-nowrap">
                      {m.status === "pending" && can(ctx, "treasury.write") && <ActionForm action={postMovementAction} hideMessage><input type="hidden" name="movement" value={m.id} /><Submit size="sm" variant="ghost">Contabilizar</Submit></ActionForm>}
                      {m.status === "posted" && m.source_type === "manual" && !m.reversed && can(ctx, "treasury.write") && (
                        <details><summary className="cursor-pointer text-xs text-muted">Revertir</summary>
                          <ActionForm action={reverseMovementAction} className="mt-1 flex gap-1"><input type="hidden" name="movement" value={m.id} /><Input name="reason" placeholder="Motivo" /><Submit size="sm" variant="danger">OK</Submit></ActionForm>
                        </details>)}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </Panel>
          {can(ctx, "treasury.reconcile") && acc && (
            <Panel title="Conciliación bancaria" subtitle="Marque los movimientos que figuran en el extracto e ingrese su saldo; se calcula la diferencia">
              <ActionForm action={reconcileAction} className="px-4 py-3">
                <input type="hidden" name="account" value={acc.cash_account_id} />
                <div className="mb-2 max-h-48 overflow-auto rounded-sm border border-line-soft">
                  {unreconciled.length === 0 ? <p className="p-3 text-xs text-muted">No hay movimientos sin conciliar.</p> : unreconciled.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 border-b border-line-soft px-3 py-1.5 text-xs">
                      <input type="checkbox" name="movement" value={m.id} defaultChecked /> <span className="num">{date(m.movement_date)}</span> <span className="flex-1 truncate">{m.description}</span> <Money value={m.amount} currency={m.currency} />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Fecha del extracto" name="statement_date"><Input type="date" name="statement_date" defaultValue={ctx.today} max={ctx.today} /></Field>
                  <Field label="Saldo según extracto" name="statement_balance"><Input name="statement_balance" inputMode="decimal" /></Field>
                  <Field label="Notas" name="notes"><Input name="notes" /></Field>
                </div>
                <div className="mt-2"><Submit variant="secondary">Registrar conciliación</Submit></div>
              </ActionForm>
              {d.recs.length > 0 && <ul className="border-t border-line-soft px-4 py-2 text-xs text-muted">{d.recs.map((r) => <li key={r.id}>{date(r.statement_date)} · extracto <Money value={r.statement_balance} currency={acc.currency} /> · libros <Money value={r.book_balance} currency={acc.currency} /> · diferencia <Money value={r.difference} currency={acc.currency} /> · {r.usr}</li>)}</ul>}
            </Panel>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Panel title="Proyección contractual de caja" subtitle={`${ccy} · cuotas por cobrar y facturas por pagar a vencer; no son movimientos realizados`}>
            <div className="px-4 py-3">
              {d.projection.length === 0 ? <Empty title="Requiere acceso a cobranzas y pagos" /> : (
                <>
                  <BarChart currency={ccy} width={460} height={180} ariaLabel="Proyección mensual" series={["Entradas previstas", "Salidas previstas"]}
                    data={d.projection.map((p) => ({ label: monthLabel(p.month.slice(0, 7)), values: [Number(p.expected_inflows), Number(p.expected_outflows)] }))} />
                  <table className="mh-table mt-2"><thead><tr><th>Mes</th><th className="r">Entradas</th><th className="r">Salidas</th><th className="r">Pendientes</th><th className="r">Neto</th></tr></thead>
                    <tbody>{d.projection.map((p) => <tr key={p.month}><td>{monthLabel(p.month.slice(0, 7))}</td><td className="r"><Money value={p.expected_inflows} currency={ccy} /></td><td className="r"><Money value={p.expected_outflows} currency={ccy} /></td><td className="r"><Money value={p.pending_movements} currency={ccy} /></td><td className="r"><Money value={p.net} currency={ccy} /></td></tr>)}</tbody></table>
                </>
              )}
            </div>
          </Panel>
          {can(ctx, "treasury.write") && acc && (
            <Panel title="Registrar movimiento manual" subtitle="Cobros de clientes y pagos a proveedores se registran desde sus módulos">
              <ActionForm action={movementAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3">
                <input type="hidden" name="account" value={acc.cash_account_id} />
                <Field label="Fecha" name="date"><Input type="date" name="date" defaultValue={ctx.today} /></Field>
                <Field label="Sentido" name="direction"><Select name="direction" options={[["out", "Egreso"], ["in", "Ingreso"]]} /></Field>
                <Field label={`Importe (${acc.currency})`} name="amount"><Input name="amount" inputMode="decimal" /></Field>
                <Field label="Categoría" name="category"><Select name="category" options={Object.entries(CASH_CATEGORY).filter(([k]) => !["customer_payment", "customer_payment_reversal", "supplier_payment", "supplier_payment_reversal"].includes(k))} /></Field>
                <Field label="Descripción" name="description" className="col-span-2"><Input name="description" /></Field>
                <Field label="Contraparte" name="counterparty"><Input name="counterparty" /></Field>
                <Field label="Referencia" name="reference"><Input name="reference" /></Field>
                <Field label="Estado" name="status"><Select name="status" options={[["posted", "Contabilizado"], ["pending", "Pendiente / programado"]]} /></Field>
                <div className="col-span-2"><ConfirmSubmit label="Revisar movimiento" confirmLabel="Registrar" fields={[{ name: "date", label: "Fecha" }, { name: "direction", label: "Sentido", options: { in: "Ingreso", out: "Egreso" } }, { name: "amount", label: "Importe" }, { name: "category", label: "Categoría", options: CASH_CATEGORY }]} /></div>
              </ActionForm>
            </Panel>
          )}
          {can(ctx, "treasury.reconcile") && (
            <details className="rounded-md border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer text-xs text-muted hover:text-text">Nueva cuenta financiera</summary>
              <ActionForm action={createAccountAction} className="mt-2 grid grid-cols-2 gap-2">
                <Field label="Nombre" name="name"><Input name="name" /></Field>
                <Field label="Tipo" name="kind"><Select name="kind" options={[["bank", "Banco"], ["cash", "Caja"], ["card_processor", "Procesador"], ["other", "Otra"]]} /></Field>
                <Field label="Moneda" name="currency"><Select name="currency" options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]]} /></Field>
                <Field label="Banco" name="bank_name"><Input name="bank_name" /></Field>
                <Field label="Saldo inicial" name="opening_balance"><Input name="opening_balance" inputMode="decimal" defaultValue="0" /></Field>
                <Field label="Fecha saldo inicial" name="opening_date"><Input type="date" name="opening_date" defaultValue={ctx.today} /></Field>
                <div className="col-span-2"><Submit variant="secondary">Crear cuenta</Submit></div>
              </ActionForm>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
