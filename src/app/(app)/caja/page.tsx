import Link from "next/link";
import type { Metadata } from "next";
import { Scale } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { AccountDialog, MovementDialog, RateDialog, ReverseMovementButton, TransferDialog } from "@/components/finance/cash-forms";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { CASH_KIND, MOVEMENT_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getToday } from "@/server/queries/common";

export const metadata: Metadata = { title: "Caja y movimientos" };

export default async function CashPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("cash.view");
  const sp = await searchParams;
  const tab = param(sp, "vista") ?? "cuentas";
  const today = await getToday(ctx);
  const accounts = await ctx.db((tx) => tx<{ account_id: string; name: string; kind: string; currency: string; is_active: boolean; registered_balance: string; reconciled_balance: string; unreconciled_count: number; last_reconciled_on: string | null }[]>`
    select * from public.v_cash_account_balances where org_id = ${ctx.org.id} order by currency, name`);
  const accList = accounts.filter((a) => a.is_active).map((a) => ({ id: a.account_id, name: a.name, currency: a.currency }));
  const canRegister = ctx.perms.has("cash.register");

  return (
    <>
      <PageHeader title="Caja y movimientos" description="Saldos REGISTRADOS en el sistema. Sin integración bancaria: la conciliación contra extractos es manual."
        actions={<>
          {canRegister ? <TransferDialog accounts={accList} today={today} /> : null}
          {canRegister ? <MovementDialog accounts={accList} today={today} /> : null}
          {ctx.perms.has("cash.reconcile") ? <ButtonLink href="/caja/conciliar" variant="primary"><Scale aria-hidden /> Conciliar</ButtonLink> : null}
        </>} />
      <Tabs active={tab} items={[
        { key: "cuentas", label: "Cuentas", href: "/caja" },
        { key: "movimientos", label: "Movimientos", href: "/caja?vista=movimientos" },
        { key: "conciliaciones", label: "Conciliaciones", href: "/caja?vista=conciliaciones" },
        { key: "cambio", label: "Tipos de cambio", href: "/caja?vista=cambio" },
      ]} />
      {tab === "cuentas" ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <Notice>El saldo registrado refleja los movimientos cargados. Sólo el saldo conciliado fue verificado contra un extracto.</Notice>
            {ctx.perms.any("settings.manage", "cash.reconcile") ? <AccountDialog /> : null}
          </div>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {accounts.map((a) => (
              <li key={a.account_id} className="rounded-lg border border-line-soft bg-surface p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">{a.name}</p>
                  <StatusPill tone="neutral">{a.kind === "banco" ? "Banco" : a.kind === "caja" ? "Caja" : "Billetera"} · {a.currency}</StatusPill>
                </div>
                <p className="mt-3 text-[12px] text-faint">Saldo registrado (no verificado)</p>
                <Money value={a.registered_balance} currency={a.currency} className="display text-[22px] font-semibold text-ink" />
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line-soft pt-3 text-[12.5px]">
                  <div><p className="text-faint">Conciliado</p><Money value={a.reconciled_balance} currency={a.currency} className="text-ink-2" /></div>
                  <div><p className="text-faint">Sin conciliar</p><p className={a.unreconciled_count ? "text-warning" : "text-ink-2"}>{a.unreconciled_count} mov.</p></div>
                </div>
                <p className="mt-2 text-[12px] text-faint">Última conciliación: {formatDate(a.last_reconciled_on)}</p>
                <Link href={`/caja?vista=movimientos&cuenta=${a.account_id}`} className="mt-2 inline-block text-[12.5px] text-muted hover:text-ink">Ver movimientos →</Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {tab === "movimientos" ? <Movements ctx={ctx} sp={sp} accounts={accList} today={today} /> : null}
      {tab === "conciliaciones" ? <Reconciliations ctx={ctx} /> : null}
      {tab === "cambio" ? <Rates ctx={ctx} today={today} /> : null}
    </>
  );
}

async function Movements({ ctx, sp, accounts, today }: { ctx: AppContext; sp: SearchParams; accounts: Array<{ id: string; name: string; currency: string }>; today: string }) {
  const account = param(sp, "cuenta");
  const month = param(sp, "mes") ?? today.slice(0, 7);
  const rows = await ctx.db((tx) => tx<{ id: string; occurred_on: string; direction: string; kind: string; amount: string; currency: string; description: string; reference: string | null; counterparty: string | null; status: string; account: string; reverses_id: string | null; reversed: boolean; created_by: string | null; created_at: Date; dup: number }[]>`
    select m.id, m.occurred_on, m.direction, m.kind, m.amount, m.currency, m.description, m.reference, m.counterparty, m.status, a.name as account, m.reverses_id,
           exists (select 1 from public.cash_movements r where r.reverses_id = m.id) as reversed, u.full_name as created_by, m.created_at,
           (select count(*)::int from public.cash_movements d where d.account_id = m.account_id and d.amount = m.amount and d.occurred_on = m.occurred_on
              and d.direction = m.direction and d.id <> m.id and d.reverses_id is null and m.reverses_id is null and d.kind <> 'transferencia') as dup
    from public.cash_movements m join public.cash_accounts a on a.id = m.account_id left join public.user_profiles u on u.id = m.created_by
    where m.org_id = ${ctx.org.id} and to_char(m.occurred_on, 'YYYY-MM') = ${month} ${account ? tx`and m.account_id = ${account}` : tx``}
    order by m.occurred_on desc, m.created_at desc`);
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)); return d.toISOString().slice(0, 7); });
  const dups = rows.filter((r) => r.dup > 0).length;
  return (
    <>
      <FilterForm keep={[["vista", "movimientos"]]}>
        <FilterSelect name="cuenta" label="Cuenta" defaultValue={account} allLabel="Todas" options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
        <FilterSelect name="mes" label="Mes" defaultValue={month === today.slice(0, 7) ? "" : month} allLabel="Mes actual" options={months.slice(1).map((m) => ({ value: m, label: m.split("-").reverse().join("/") }))} />
      </FilterForm>
      {dups ? <div className="mb-4"><Notice tone="warning">{dups} movimiento(s) comparten cuenta, fecha, sentido e importe con otro: verifique que no estén duplicados.</Notice></div> : null}
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin movimientos en el período" /></div> : (
        <TableWrap>
          <Table>
            <THead><Th>Fecha</Th><Th>Cuenta</Th><Th>Tipo</Th><Th>Descripción</Th><Th numeric>Ingreso</Th><Th numeric>Egreso</Th><Th>Estado</Th><Th /></THead>
            <tbody>
              {rows.map((m) => (
                <Tr key={m.id}>
                  <Td className="num whitespace-nowrap">{formatDate(m.occurred_on)}</Td>
                  <Td muted>{m.account}</Td>
                  <Td>{CASH_KIND[m.kind]}{m.dup ? <StatusPill tone="warning" className="ml-2">¿Duplicado?</StatusPill> : null}</Td>
                  <Td className="max-w-80"><span className="block truncate text-ink-2">{m.description}</span><span className="text-[11.5px] text-faint">{[m.reference, m.counterparty, m.created_by].filter(Boolean).join(" · ")}</span></Td>
                  <Td numeric>{m.direction === "ingreso" ? <Money value={m.amount} currency={m.currency} /> : ""}</Td>
                  <Td numeric>{m.direction === "egreso" ? <Money value={m.amount} currency={m.currency} /> : ""}</Td>
                  <Td><CatalogPill catalog={MOVEMENT_STATUS} value={m.status} />{m.reversed ? <span className="mt-1 block text-[11.5px] text-critical">Revertido</span> : null}</Td>
                  <Td className="text-right">{ctx.perms.has("cash.reverse") && ["apertura", "ajuste", "otro", "transferencia"].includes(m.kind) && !m.reversed && !m.reverses_id ? <ReverseMovementButton id={m.id} /> : null}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      <p className="mt-3 text-[12px] text-faint">{formatNumber(rows.length)} movimiento(s). Los cobros, pagos y gastos se revierten desde su origen.</p>
    </>
  );
}

async function Reconciliations({ ctx }: { ctx: AppContext }) {
  const rows = await ctx.db((tx) => tx<{ id: string; account: string; currency: string; period_end: string; statement_balance: string; system_balance: string; difference: string; status: string; notes: string | null; created_by: string | null; created_at: Date; movements: number }[]>`
    select r.id, a.name as account, a.currency, r.period_end, r.statement_balance, r.system_balance, r.difference, r.status, r.notes, u.full_name as created_by, r.created_at,
           (select count(*)::int from public.cash_movements m where m.reconciliation_id = r.id) as movements
    from public.reconciliations r join public.cash_accounts a on a.id = r.account_id left join public.user_profiles u on u.id = r.created_by
    where r.org_id = ${ctx.org.id} order by r.period_end desc, r.created_at desc`);
  if (!rows.length) return <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin conciliaciones" description="Concilie cada cuenta contra su extracto bancario o arqueo de caja." /></div>;
  return (
    <TableWrap>
      <Table>
        <THead><Th>Cuenta</Th><Th>Al</Th><Th numeric>Extracto</Th><Th numeric>Sistema</Th><Th numeric>Diferencia</Th><Th numeric>Movimientos</Th><Th>Estado</Th><Th>Registró</Th></THead>
        <tbody>
          {rows.map((r) => (
            <Tr key={r.id}>
              <Td className="text-ink">{r.account}</Td>
              <Td className="num">{formatDate(r.period_end)}</Td>
              <Td numeric><Money value={r.statement_balance} currency={r.currency} /></Td>
              <Td numeric><Money value={r.system_balance} currency={r.currency} /></Td>
              <Td numeric><Money value={r.difference} currency={r.currency} tone={Number(r.difference) !== 0 ? "critical" : "muted"} /></Td>
              <Td numeric>{r.movements}</Td>
              <Td>{r.status === "cerrada" ? <StatusPill tone="positive">Cuadrada</StatusPill> : <StatusPill tone="critical">Con diferencia</StatusPill>}{r.notes ? <span className="mt-1 block max-w-56 truncate text-[11.5px] text-faint">{r.notes}</span> : null}</Td>
              <Td muted>{r.created_by}<span className="block text-[11.5px]">{formatDateTime(r.created_at)}</span></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </TableWrap>
  );
}

async function Rates({ ctx, today }: { ctx: AppContext; today: string }) {
  const rows = await ctx.db((tx) => tx<{ id: string; rate_date: string; from_currency: string; to_currency: string; rate: string; source: string; created_by: string | null }[]>`
    select r.id, r.rate_date, r.from_currency, r.to_currency, r.rate, r.source, u.full_name as created_by
    from public.exchange_rates r left join public.user_profiles u on u.id = r.created_by where r.org_id = ${ctx.org.id} order by r.rate_date desc limit 100`);
  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <Notice>Los tipos de cambio se cargan manualmente; no hay integración con el BCP ni con bancos. Cada conversión usa el último tipo registrado a su fecha.</Notice>
        {ctx.perms.any("settings.manage", "cash.reconcile") ? <RateDialog today={today} /> : null}
      </div>
      {rows.length === 0 ? <EmptyState title="Sin tipos de cambio" /> : (
        <TableWrap>
          <Table>
            <THead><Th>Fecha</Th><Th>Par</Th><Th numeric>Tipo de cambio</Th><Th>Fuente</Th><Th>Registró</Th></THead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id}><Td className="num">{formatDate(r.rate_date)}</Td><Td>1 {r.from_currency} = … {r.to_currency}</Td><Td numeric>{formatNumber(Number(r.rate), 2)}</Td><Td muted>{r.source}</Td><Td muted>{r.created_by ?? "—"}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}
