import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty, Figure } from "@/components/ui/Layout";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Money } from "@/components/ui/Money";
import { LinkButton } from "@/components/ui/Button";
import { ActionForm, ConfirmSubmit, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { SearchParams, sp, hrefWith } from "@/components/ui/Table";
import { ACCOUNT_STATUS, CHANNEL, INSTALLMENT_STATUS, OUTCOME, PAYMENT_METHOD, PAYMENT_STATUS, PROMISE_STATUS, label } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";
import { adjustmentAction, issueContractDocAction, logCollectionAction, notifyIntentAction } from "../actions";

export const metadata = { title: "Estado de cuenta" };

/* eslint-disable @typescript-eslint/no-explicit-any */
type R = Record<string, any>;

export default async function AccountPage({ params, searchParams }: { params: Promise<{ customerId: string }>; searchParams: Promise<SearchParams> }) {
  const { customerId } = await params;
  const sparams = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) notFound();
  const ctx = await getContext();
  const d = await query(ctx, async (db) => {
    const customer = await db.maybe<R>("select id, display_name, kind, email, phone, owner_user_id from public.customers where id = $1", [customerId]);
    if (!customer) return null;
    const contracts = await db.rows<R>("select * from public.contract_balances where customer_id = $1 order by contract_date desc", [customerId]);
    const selectedId = sp(sparams, "contract") && contracts.some((c) => c.contract_id === sp(sparams, "contract")) ? sp(sparams, "contract")! : contracts[0]?.contract_id;
    const sel = contracts.find((c) => c.contract_id === selectedId);
    const from = sp(sparams, "from") ?? sel?.contract_date ?? ctx.today;
    const to = sp(sparams, "to") ?? ctx.today;
    const installments = sel ? await db.rows<R>("select * from public.installment_status where contract_id = $1 order by seq", [selectedId]) : [];
    const statement = sel ? await db.rows<R>("select * from public.contract_statement($1, $2, $3) order by entry_order", [selectedId, from, to]) : [];
    const payments = can(ctx, "payment.read", "receivable.read")
      ? await db.rows<R>("select * from public.payment_status where customer_id = $1 order by effective_date desc, recorded_at desc", [customerId]) : [];
    const actions = await db.rows<R>(
      "select cp.*, p.full_name usr from public.collection_promises cp join public.user_profiles p on p.id = cp.user_id where cp.customer_id = $1 order by cp.contacted_at desc", [customerId]);
    const notices = await db.rows<R>("select * from public.notification_events where customer_id = $1 order by created_at desc limit 5", [customerId]);
    const adjustments = sel ? await db.rows<R>(
      "select a.*, i.label inst, p.full_name usr from public.installment_adjustments a join public.receivable_installments i on i.id = a.installment_id left join public.user_profiles p on p.id = a.created_by where i.contract_id = $1 order by a.created_at desc", [selectedId]) : [];
    return { customer, contracts, sel, installments, statement, payments, actions, notices, adjustments, from, to };
  });
  if (!d) notFound();
  const { customer, sel } = d;
  const ccy = sel?.currency ?? ctx.org.currency;
  const closing = d.statement.at(-1)?.balance;
  const reconciled = sel && d.to >= ctx.today ? Number(closing) === Number(sel.outstanding) : null;
  const base = `/receivables/${customerId}`;

  return (
    <>
      <PageHeader crumbs={[["/receivables", "Cuentas por cobrar"]]} title={customer.display_name}
        subtitle={<>{customer.email ?? "sin correo"} · {customer.phone ?? "sin teléfono"} · <Link href={`/customers/${customerId}`} className="text-accent">Expediente 360°</Link></>}
        actions={can(ctx, "payment.create") && sel && <LinkButton variant="primary" href={`/payments/new?customer=${customerId}&contract=${sel.contract_id}`}>Registrar pago</LinkButton>} />

      {d.contracts.length === 0 ? <Panel><Empty title="El cliente no tiene contratos visibles" /></Panel> : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {d.contracts.map((c) => (
              <Link key={c.contract_id} href={hrefWith(base, {}, { contract: c.contract_id })}
                className={`rounded-sm border px-3 py-2 text-xs ${c.contract_id === sel?.contract_id ? "border-accent/60 bg-raised" : "border-line hover:border-faint"}`}>
                <div className="text-[13px] text-text">{c.number}</div>
                <div className="text-muted">{date(c.contract_date)} · <Money value={c.outstanding} currency={c.currency} /> · {label(Object.fromEntries(Object.entries(ACCOUNT_STATUS).map(([k, v]) => [k, v[0]])), c.account_status)}</div>
              </Link>
            ))}
          </div>

          {sel && (
            <>
              <Panel className="mb-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-r [&>*]:border-line-soft">
                  <Figure label="Importe contractual" value={<Money value={sel.total_obligations} currency={ccy} />} note={<>Precio <Money value={sel.total_price} currency={ccy} /> · financiado <Money value={sel.financed_principal} currency={ccy} /></>} />
                  <Figure label="Cobrado y confirmado" value={<Money value={sel.collected_confirmed} currency={ccy} />} note={Number(sel.pending_reconciliation) > 0 ? <>+ <Money value={sel.pending_reconciliation} currency={ccy} /> sin conciliar</> : "Sin pagos pendientes de conciliar"} />
                  <Figure label="Saldo pendiente" value={<Money value={sel.outstanding} currency={ccy} />} note={<>Futuro <Money value={sel.future_amount} currency={ccy} /></>} />
                  <Figure label="Saldo vencido" tone={Number(sel.overdue_amount) > 0 ? "risk" : undefined} value={<Money value={sel.overdue_amount} currency={ccy} />} note={`${sel.overdue_count} cuota(s) · atraso máx. ${sel.max_days_past_due} d`} />
                  <Figure label="Próximo vencimiento" value={date(sel.next_due_date)} note={<Money value={sel.next_due_amount} currency={ccy} />} />
                  <Figure label="Último pago" value={date(sel.last_payment_date)} note={<StatusBadge map={ACCOUNT_STATUS} value={sel.account_status} />} />
                </div>
                {Number(sel.schedule_discrepancy) !== 0 && <p className="border-t border-risk/30 px-4 py-2 text-xs text-risk">Discrepancia: el principal programado no reconcilia con el contrato ({money(sel.schedule_discrepancy, ccy)}).</p>}
              </Panel>

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-4">
                  <Panel title="Obligaciones" subtitle={`Contrato ${sel.number} · versión vigente`}
                    actions={<Link href={`/contracts/${sel.contract_id}`} className="text-xs text-muted hover:text-text">Contrato →</Link>}>
                    <div className="max-h-[440px] overflow-auto">
                      <table className="mh-table">
                        <thead><tr><th>#</th><th>Concepto</th><th>Vence</th><th className="r">Capital</th><th className="r">Interés</th><th className="r">Ajustes</th><th className="r">Exigible</th><th className="r">Cobrado</th><th className="r">Pendiente</th><th>Estado</th></tr></thead>
                        <tbody>
                          {d.installments.map((i) => (
                            <tr key={i.id}>
                              <td className="num text-faint">{i.seq}</td>
                              <td className="text-text-2">{i.label}</td>
                              <td className="num text-text-2">{date(i.due_date)}{i.days_past_due > 0 && <div className="text-xs text-risk">{i.days_past_due} d atraso</div>}</td>
                              <td className="r"><Money value={i.principal_amount} currency={ccy} muted /></td>
                              <td className="r"><Money value={i.interest_amount} currency={ccy} muted /></td>
                              <td className="r">{Number(i.adjustments_total) ? <Money value={i.adjustments_total} currency={ccy} sign /> : "—"}</td>
                              <td className="r"><Money value={i.total_due} currency={ccy} /></td>
                              <td className="r"><Money value={i.paid_confirmed} currency={ccy} />{Number(i.pending_allocated) > 0 && <div className="text-xs text-warn">+{money(i.pending_allocated, ccy)} s/conc.</div>}</td>
                              <td className="r"><Money value={i.outstanding} currency={ccy} /></td>
                              <td><StatusBadge map={INSTALLMENT_STATUS} value={i.payment_status} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Panel>

                  <Panel title="Estado de cuenta" subtitle="Saldo inicial, obligaciones, ajustes, pagos y reversiones con saldo acumulado">
                    <form method="get" action={base} className="flex flex-wrap items-end gap-2 border-b border-line-soft px-4 py-2.5">
                      <input type="hidden" name="contract" value={sel.contract_id} />
                      <label className="text-xs text-muted">Desde <input type="date" name="from" defaultValue={d.from} className="ml-1 h-7 rounded-sm border border-line bg-ink px-2 text-text" /></label>
                      <label className="text-xs text-muted">Hasta <input type="date" name="to" defaultValue={d.to} className="ml-1 h-7 rounded-sm border border-line bg-ink px-2 text-text" /></label>
                      <button className="h-7 rounded-sm border border-line px-2 text-xs text-text">Ver</button>
                      {reconciled !== null && <span className="ml-auto">{reconciled ? <Badge tone="good">Saldo final reconcilia con obligaciones</Badge> : <Badge tone="risk">No reconcilia</Badge>}</span>}
                    </form>
                    <table className="mh-table">
                      <thead><tr><th>Fecha</th><th>Movimiento</th><th>Referencia</th><th className="r">Débito</th><th className="r">Crédito</th><th className="r">Saldo</th></tr></thead>
                      <tbody>
                        {d.statement.map((s) => (
                          <tr key={s.entry_order} className={s.entry_type === "opening" ? "text-muted" : ""}>
                            <td className="num">{date(s.entry_date)}</td>
                            <td className={s.entry_type === "reversal" ? "text-risk" : ""}>{s.description}</td>
                            <td className="text-xs text-faint">{s.reference ?? ""}</td>
                            <td className="r">{s.debit ? <Money value={s.debit} currency={ccy} /> : ""}</td>
                            <td className="r">{s.credit ? <Money value={s.credit} currency={ccy} /> : ""}</td>
                            <td className="r"><Money value={s.balance} currency={ccy} /></td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><td colSpan={5}>Saldo final al {date(d.to)}</td><td className="r"><Money value={closing} currency={ccy} /></td></tr></tfoot>
                    </table>
                    {can(ctx, "document.issue") && (
                      <ActionForm action={issueContractDocAction} className="flex flex-wrap gap-2 border-t border-line-soft px-4 py-3">
                        <input type="hidden" name="contract" value={sel.contract_id} /><input type="hidden" name="from" value={d.from} /><input type="hidden" name="to" value={d.to} />
                        <Submit variant="secondary" name="kind" value="account_statement">Emitir estado de cuenta PDF</Submit>
                        <Submit variant="ghost" name="kind" value="payment_schedule">Emitir calendario de pagos</Submit>
                      </ActionForm>
                    )}
                  </Panel>

                  {d.payments.length > 0 && (
                    <Panel title="Pagos del cliente">
                      <table className="mh-table">
                        <thead><tr><th>Número</th><th>Fecha</th><th>Medio</th><th>Referencia</th><th className="r">Importe</th><th className="r">Sin asignar</th><th>Estado</th></tr></thead>
                        <tbody>{d.payments.map((p) => (
                          <tr key={p.id}>
                            <td><Link href={`/payments?focus=${p.id}`} className="text-text hover:text-accent">{p.number}</Link></td>
                            <td className="num">{date(p.effective_date)}</td><td>{label(PAYMENT_METHOD, p.method)}</td>
                            <td className="text-xs text-text-2">{p.reference ?? "—"}</td>
                            <td className="r"><Money value={p.amount} currency={p.currency} /></td>
                            <td className="r">{Number(p.unallocated_amount) ? <Money value={p.unallocated_amount} currency={p.currency} className="text-warn" /> : "—"}</td>
                            <td><StatusBadge map={PAYMENT_STATUS} value={p.status} /></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </Panel>
                  )}
                </div>

                <div className="min-w-0 space-y-4">
                  {can(ctx, "collections.write") && (
                    <Panel title="Registrar gestión de cobranza">
                      <ActionForm action={logCollectionAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3">
                        <input type="hidden" name="customer" value={customerId} /><input type="hidden" name="contract" value={sel.contract_id} />
                        <input type="hidden" name="promise_currency" value={ccy} />
                        <Field label="Canal" name="channel"><Select name="channel" options={Object.entries(CHANNEL).filter(([k]) => ["phone", "whatsapp", "email", "in_person", "letter", "other"].includes(k))} /></Field>
                        <Field label="Resultado" name="outcome"><Select name="outcome" options={Object.entries(OUTCOME)} /></Field>
                        <Field label={`Importe prometido (${ccy})`} name="promise_amount" hint="Solo si el resultado es compromiso"><Input name="promise_amount" inputMode="decimal" /></Field>
                        <Field label="Fecha prometida" name="promise_date"><Input type="date" name="promise_date" min={ctx.today} /></Field>
                        <Field label="Próxima acción" name="next_action"><Input name="next_action" /></Field>
                        <Field label="Fecha próxima acción" name="next_action_date"><Input type="date" name="next_action_date" min={ctx.today} /></Field>
                        <Field label="Observaciones" name="notes" className="col-span-2"><Textarea name="notes" rows={2} /></Field>
                        <div className="col-span-2"><Submit variant="secondary">Registrar gestión</Submit></div>
                      </ActionForm>
                    </Panel>
                  )}
                  <Panel title="Historial de gestiones">
                    {d.actions.length === 0 ? <Empty title="Sin gestiones registradas" /> : (
                      <ul className="max-h-96 divide-y divide-line-soft overflow-y-auto">
                        {d.actions.map((a) => (
                          <li key={a.id} className="px-4 py-2 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[13px] text-text">{label(OUTCOME, a.outcome)} · {label(CHANNEL, a.channel)}</span>
                              {a.promise_status && <StatusBadge map={PROMISE_STATUS} value={a.promise_status} />}
                            </div>
                            {a.outcome === "promise" && <div className="text-text-2">Prometió {money(a.promise_amount, a.promise_currency)} para el {date(a.promise_date)} · pagado desde entonces {money(a.paid_since_promise, a.promise_currency)}</div>}
                            {a.notes && <div className="text-muted">{a.notes}</div>}
                            <div className="text-faint">{dateTime(a.contacted_at)} · {a.usr}{a.next_action && ` · próxima: ${a.next_action} (${date(a.next_action_date)})`}</div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Panel>
                  {can(ctx, "collections.write") && (
                    <Panel title="Recordatorio al cliente" subtitle="Requiere plantilla aprobada y canal integrado">
                      <div className="px-4 py-3 text-xs text-muted">
                        <p className="mb-2">No hay integración de mensajería configurada. Puede registrar la intención para trazabilidad; el sistema no afirmará que el mensaje fue enviado.</p>
                        <ActionForm action={notifyIntentAction} className="flex items-end gap-2">
                          <input type="hidden" name="customer" value={customerId} /><input type="hidden" name="contract" value={sel.contract_id} />
                          <Field label="Canal" name="channel"><Select name="channel" options={[["whatsapp", "WhatsApp"], ["email", "Correo"], ["sms", "SMS"]]} /></Field>
                          <Submit variant="ghost">Registrar intención</Submit>
                        </ActionForm>
                        {d.notices.map((n) => <p key={n.id} className="mt-1 text-faint">{dateTime(n.created_at)} · {n.channel} · {n.status === "not_sent_no_channel" ? "no enviado (sin canal)" : n.status}</p>)}
                      </div>
                    </Panel>
                  )}
                  {can(ctx, "receivable.adjust") && (
                    <Panel title="Ajustes auditables" subtitle="El saldo nunca se edita: se registran notas de crédito, recargos o castigos">
                      <ActionForm action={adjustmentAction} resetOnSuccess className="grid grid-cols-2 gap-2 px-4 py-3">
                        <input type="hidden" name="customer" value={customerId} />
                        <Field label="Cuota" name="installment" className="col-span-2"><Select name="installment" options={d.installments.map((i) => [i.id, `${i.label} · vence ${date(i.due_date)} · pendiente ${money(i.outstanding, ccy)}`])} /></Field>
                        <Field label="Tipo" name="kind"><Select name="kind" options={[["late_fee", "Recargo por mora"], ["interest", "Interés moratorio"], ["credit_note", "Nota de crédito"], ["discount", "Descuento"], ["write_off", "Castigo"]]} /></Field>
                        <Field label="Importe" name="amount"><Input name="amount" inputMode="decimal" /></Field>
                        <Field label="Fundamento" name="reason" className="col-span-2"><Input name="reason" /></Field>
                        <div className="col-span-2"><ConfirmSubmit label="Revisar ajuste" confirmLabel="Registrar ajuste" fields={[{ name: "kind", label: "Tipo" }, { name: "amount", label: "Importe" }, { name: "reason", label: "Fundamento" }]} /></div>
                      </ActionForm>
                      {d.adjustments.length > 0 && <ul className="border-t border-line-soft px-4 py-2 text-xs text-muted">{d.adjustments.map((a) => <li key={a.id}>{date(a.effective_date)} · {a.inst} · {a.kind} {money(a.amount, ccy, { sign: true })} · {a.reason} · {a.usr}</li>)}</ul>}
                    </Panel>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
