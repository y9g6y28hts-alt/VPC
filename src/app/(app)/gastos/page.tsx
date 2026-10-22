import Link from "next/link";
import type { Metadata } from "next";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { Table, TableWrap, Td, TFootRow, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ExpenseDialog, PayExpenseDialog } from "@/components/payables/expense-forms";
import { formatDate, formatMoney } from "@/lib/format";
import { COST_KIND, EXPENSE_CATEGORY, EXPENSE_STATUS } from "@/lib/labels";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getToday, listCashAccounts, listSuppliers } from "@/server/queries/common";

export const metadata: Metadata = { title: "Gastos" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("expenses.view", "inventory.costs.view");
  const sp = await searchParams;
  const tab = param(sp, "vista") === "unidades" || !ctx.perms.has("expenses.view") ? "unidades" : "generales";
  const today = await getToday(ctx);
  const month = param(sp, "mes") ?? today.slice(0, 7);
  const base = ctx.org.baseCurrency;
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1 - i, 1)); return d.toISOString().slice(0, 7); });

  return (
    <>
      <PageHeader title="Gastos" description="Gastos operativos generales y costes atribuibles a unidades. Ningún gasto se paga sin aprobación previa."
        actions={tab === "generales" && ctx.perms.has("expenses.create") ? <ExpenseDialog suppliers={await listSuppliers(ctx)} today={today} /> : null} />
      <Tabs active={tab} items={[
        ...(ctx.perms.has("expenses.view") ? [{ key: "generales", label: "Gastos generales", href: "/gastos" }] : []),
        ...(ctx.perms.has("inventory.costs.view") ? [{ key: "unidades", label: "Costes de unidades", href: "/gastos?vista=unidades" }] : []),
      ]} />
      <FilterForm keep={[["vista", param(sp, "vista")]]}>
        <FilterSelect name="mes" label="Mes" defaultValue={month === today.slice(0, 7) ? "" : month} allLabel="Mes actual" options={months.slice(1).map((m) => ({ value: m, label: m.split("-").reverse().join("/") }))} />
        {tab === "unidades" ? <FilterSelect name="tipo" label="Tipo" defaultValue={param(sp, "tipo")} options={[{ value: "estimados", label: "Sólo estimados (sin factura)" }, ...Object.entries(COST_KIND).map(([k, v]) => ({ value: k, label: v }))]} /> : null}
      </FilterForm>
      {tab === "generales" ? <General ctx={ctx} month={month} today={today} /> : <UnitCosts ctx={ctx} month={month} kind={param(sp, "tipo")} base={base} />}
    </>
  );
}

async function General({ ctx, month, today }: { ctx: AppContext; month: string; today: string }) {
  const rows = await ctx.db((tx) => tx<{ id: string; number: string; expense_date: string; category: string; description: string; amount: string; currency: string; status: string; supplier: string | null; created_by: string | null; account: string | null }[]>`
    select e.id, e.number, e.expense_date, e.category, e.description, e.amount, e.currency, e.status, s.name as supplier, u.full_name as created_by, a.name as account
    from public.expenses e left join public.suppliers s on s.id = e.supplier_id left join public.user_profiles u on u.id = e.created_by left join public.cash_accounts a on a.id = e.cash_account_id
    where e.org_id = ${ctx.org.id} and (to_char(e.expense_date, 'YYYY-MM') = ${month} or e.status in ('pendiente_aprobacion','aprobado'))
    order by e.expense_date desc`);
  const accounts = ctx.perms.has("cash.register") ? await listCashAccounts(ctx) : [];
  const totals = rows.filter((r) => r.status !== "rechazado" && r.status !== "anulado").reduce<Record<string, number>>((a, r) => ({ ...a, [r.currency]: (a[r.currency] ?? 0) + Number(r.amount) }), {});
  if (!rows.length) return <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin gastos en el período" /></div>;
  return (
    <TableWrap>
      <Table>
        <THead><Th>N.º</Th><Th>Fecha</Th><Th>Categoría</Th><Th>Descripción</Th><Th className="hidden lg:table-cell">Proveedor</Th><Th numeric>Importe</Th><Th>Estado</Th><Th /></THead>
        <tbody>
          {rows.map((e) => (
            <Tr key={e.id}>
              <Td className="num">{e.number}</Td>
              <Td className="num">{formatDate(e.expense_date)}</Td>
              <Td>{EXPENSE_CATEGORY[e.category]}</Td>
              <Td className="max-w-72"><span className="block truncate text-ink">{e.description}</span><span className="text-[11.5px] text-faint">{e.created_by}{e.account ? ` · pagado desde ${e.account}` : ""}</span></Td>
              <Td className="hidden lg:table-cell" muted>{e.supplier ?? "—"}</Td>
              <Td numeric><Money value={e.amount} currency={e.currency} /></Td>
              <Td>{e.status === "pendiente_aprobacion" ? <Link href="/aprobaciones"><CatalogPill catalog={EXPENSE_STATUS} value={e.status} /></Link> : <CatalogPill catalog={EXPENSE_STATUS} value={e.status} />}</Td>
              <Td className="text-right">{e.status === "aprobado" && ctx.perms.has("cash.register") ? <PayExpenseDialog expenseId={e.id} currency={e.currency} accounts={accounts} today={today} /> : null}</Td>
            </Tr>
          ))}
        </tbody>
        <TFootRow><Td colSpan={5}>Total (sin rechazados ni anulados)</Td><Td numeric>{Object.entries(totals).map(([c, v]) => <span key={c} className="block">{formatMoney(v, c)}</span>)}</Td><Td colSpan={2} /></TFootRow>
      </Table>
    </TableWrap>
  );
}

async function UnitCosts({ ctx, month, kind, base }: { ctx: AppContext; month: string; kind?: string; base: string }) {
  const rows = await ctx.db((tx) => tx<{ id: string; vehicle_id: string; vehicle: string; kind: string; description: string; amount: string; currency: string; amount_base: string; is_estimate: boolean; incurred_on: string; supplier: string | null }[]>`
    select vc.id, vc.vehicle_id, v.stock_code || ' · ' || app.vehicle_name(b.name, v.model) as vehicle, vc.kind, vc.description, vc.amount, vc.currency, vc.amount_base,
           vc.is_estimate, vc.incurred_on, s.name as supplier
    from public.vehicle_costs vc join public.vehicles v on v.id = vc.vehicle_id join public.brands b on b.id = v.brand_id left join public.suppliers s on s.id = vc.supplier_id
    where vc.org_id = ${ctx.org.id} and vc.kind <> 'adquisicion'
      ${kind === "estimados" ? tx`and vc.is_estimate` : kind ? tx`and vc.kind = ${kind} and to_char(vc.incurred_on, 'YYYY-MM') = ${month}` : tx`and to_char(vc.incurred_on, 'YYYY-MM') = ${month}`}
    order by vc.incurred_on desc`);
  const total = rows.reduce((a, r) => a + Number(r.amount_base), 0);
  if (!rows.length) return <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin costes de unidades en el período" description="No incluye costes de adquisición." /></div>;
  return (
    <TableWrap>
      <Table>
        <THead><Th>Fecha</Th><Th>Unidad</Th><Th>Concepto</Th><Th>Descripción</Th><Th numeric>Importe</Th><Th numeric>{`En ${base}`}</Th><Th>Tipo</Th></THead>
        <tbody>
          {rows.map((c) => (
            <Tr key={c.id}>
              <Td className="num">{formatDate(c.incurred_on)}</Td>
              <Td><Link href={`/inventario/${c.vehicle_id}?tab=costes`} className="hover:text-ink">{c.vehicle}</Link></Td>
              <Td>{COST_KIND[c.kind]}</Td>
              <Td className="max-w-72 truncate" muted>{c.description}{c.supplier ? ` · ${c.supplier}` : ""}</Td>
              <Td numeric><Money value={c.amount} currency={c.currency} /></Td>
              <Td numeric><Money value={c.amount_base} currency={base} /></Td>
              <Td>{c.is_estimate ? <StatusPill tone="warning">Estimado</StatusPill> : <StatusPill tone="neutral">Registrado</StatusPill>}</Td>
            </Tr>
          ))}
        </tbody>
        <TFootRow><Td colSpan={5}>Total</Td><Td numeric><Money value={total} currency={base} /></Td><Td /></TFootRow>
      </Table>
    </TableWrap>
  );
}
