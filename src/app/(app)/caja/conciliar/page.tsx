import type { Metadata } from "next";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { ReconcileForm } from "@/components/finance/reconcile-form";
import { formatDate } from "@/lib/format";
import { CASH_KIND } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getToday } from "@/server/queries/common";

export const metadata: Metadata = { title: "Conciliar cuenta" };

export default async function ReconcilePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("cash.reconcile");
  const sp = await searchParams;
  const today = await getToday(ctx);
  const accounts = await ctx.db((tx) => tx<{ id: string; name: string; currency: string }[]>`select id, name, currency from public.cash_accounts where org_id = ${ctx.org.id} and is_active order by currency, name`);
  const accountId = param(sp, "cuenta") ?? accounts[0]?.id;
  const until = param(sp, "hasta") ?? today;
  const account = accounts.find((a) => a.id === accountId);
  const movements = account ? await ctx.db((tx) => tx<{ id: string; occurred_on: string; direction: string; kind: string; amount: string; description: string; reference: string | null }[]>`
    select id, occurred_on, direction, kind, amount, description, reference from public.cash_movements
    where account_id = ${account.id} and status = 'registrado' and occurred_on <= ${until} order by occurred_on, created_at`) : [];
  const [sys] = account ? await ctx.db((tx) => tx<{ total: string }[]>`
    select coalesce(sum(case when direction = 'ingreso' then amount else -amount end), 0) as total from public.cash_movements where account_id = ${account.id} and occurred_on <= ${until}`) : [{ total: "0" }];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Caja", href: "/caja" }, { label: "Conciliar" }]} title="Conciliar contra extracto"
        description="Marque los movimientos que figuran en el extracto y registre el saldo del extracto. La diferencia queda registrada y aparece como alerta hasta resolverse." />
      <FilterForm>
        <FilterSelect name="cuenta" label="Cuenta" defaultValue={accountId} allLabel="Seleccione" options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.currency})` }))} />
        <label className="flex flex-col gap-1"><span className="text-[11px] font-medium uppercase tracking-wide text-faint">Hasta</span>
          <input type="date" name="hasta" defaultValue={until} max={today} className="h-9 rounded-md border border-line bg-surface px-2.5 text-[13px] text-ink-2" /></label>
        <button type="submit" className="h-9 rounded-md border border-line px-3 text-[13px] text-ink-2 hover:bg-elevated">Aplicar</button>
      </FilterForm>
      {!account ? <EmptyState title="No hay cuentas" /> : (
        <Panel title={`${account.name} al ${formatDate(until)}`} description={<>Saldo según el sistema a esa fecha: <Money value={sys!.total} currency={account.currency} className="text-ink" /></>}>
          {movements.length === 0 ? <EmptyState title="No hay movimientos sin conciliar hasta esa fecha" /> : (
            <ReconcileForm accountId={account.id} periodEnd={until} currency={account.currency}
              movements={movements.map((m) => ({ id: m.id, date: formatDate(m.occurred_on), label: `${CASH_KIND[m.kind]} · ${m.description}${m.reference ? ` · ${m.reference}` : ""}`, signed: m.direction === "ingreso" ? Number(m.amount) : -Number(m.amount) }))} />
          )}
        </Panel>
      )}
    </>
  );
}
