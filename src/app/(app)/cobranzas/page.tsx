import Link from "next/link";
import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { ChartCard, HBars } from "@/components/charts/charts";
import { FilterForm, FilterSelect, SearchInput } from "@/components/ui/filter-form";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatGrid } from "@/components/ui/stat";
import { EmptyState, Notice } from "@/components/ui/states";
import { CatalogPill, StatusPill } from "@/components/ui/status";
import { SortTh, Table, TableWrap, Td, Th, THead, Tr } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { CollectionActionDialog, PaymentRowActions } from "@/components/finance/payment-actions";
import { agingSeverity, DEFAULT_AGING_BUCKETS } from "@/domain/collections/aging";
import { collectionPriority } from "@/domain/collections/priority";
import { formatDate, formatMoney, formatMoneyCompact, formatNumber, formatPercent, whatsappHref } from "@/lib/format";
import { PAYMENT_METHOD, PROMISE_STATUS } from "@/lib/labels";
import { hrefWith, param, sortParams, type SearchParams } from "@/lib/url";
import { requirePerm, type AppContext } from "@/server/auth/context";
import { getToday, latestRate, listMembers } from "@/server/queries/common";
import { agingDistribution, collectionKpis, paymentsToConfirm, portfolio, PORTFOLIO_SORTS, promisesList, type PortfolioRow } from "@/server/queries/collections";

export const metadata: Metadata = { title: "Cobranzas" };

export default async function CollectionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("collections.view");
  const sp = await searchParams;
  const tab = param(sp, "vista") ?? "cartera";
  const base = ctx.org.baseCurrency;
  const [kpis, dist, today, usdRate, toConfirm] = await Promise.all([
    collectionKpis(ctx), agingDistribution(ctx), getToday(ctx), latestRate(ctx, "USD", base), ctx.perms.has("payments.view") ? paymentsToConfirm(ctx) : Promise.resolve([]),
  ]);
  const rate = (cur: string) => (cur === base ? 1 : cur === "USD" ? usdRate?.rate ?? null : null);
  const sumBase = (k: "outstanding" | "overdue" | "collected_month") => kpis.reduce((a, r) => a + Number(r[k]) * (rate(r.currency) ?? 0), 0);
  const hasForeign = kpis.some((k) => k.currency !== base && Number(k.outstanding) > 0);
  const missingRate = hasForeign && !usdRate;
  const outstanding = sumBase("outstanding");
  const overdue = sumBase("overdue");
  const customersOverdue = kpis.reduce((a, k) => a + k.customers_overdue, 0);
  const foreignNote = (k: "outstanding" | "overdue" | "collected_month") => {
    const f = kpis.filter((x) => x.currency !== base && Number(x[k]) > 0);
    return f.length ? `Incluye ${f.map((x) => formatMoney(x[k], x.currency)).join(" + ")}` : undefined;
  };
  const promises = await promisesList(ctx);
  const pendingPromises = promises.filter((p) => p.promise_status === "pendiente");
  const brokenPromises = promises.filter((p) => p.promise_status === "incumplida");

  return (
    <>
      <PageHeader title="Cobranzas" description="Cartera, mora y gestiones. Todos los saldos se calculan desde cuotas y pagos confirmados; las promesas no cuentan como cobro." />
      {missingRate ? <div className="mb-4"><Notice tone="warning">No hay tipo de cambio USD→{base} registrado: los totales consolidados excluyen los contratos en dólares.</Notice></div> : null}

      <StatGrid className="mb-6 xl:grid-cols-3 min-[1700px]:grid-cols-6">
        <Stat id="cb-out" label="Cartera pendiente" value={formatMoneyCompact(outstanding, base)} sub={foreignNote("outstanding")}
          definition={{ formula: "Σ saldo pendiente de contratos vigentes (cuotas − aplicaciones de pagos confirmados). Dólares convertidos con el último tipo de cambio registrado (referencial).", source: "v_contract_balances." }} />
        <Stat id="cb-over" label="Total vencido" value={formatMoneyCompact(overdue, base)} tone={overdue > 0 ? "critical" : "neutral"} sub={foreignNote("overdue")}
          definition={{ formula: "Σ saldo de cuotas con vencimiento anterior a hoy.", source: "v_installment_balances." }} />
        <Stat id="cb-pct" label="Cartera vencida" value={outstanding > 0 ? formatPercent((overdue / outstanding) * 100) : "—"} tone={overdue / (outstanding || 1) > 0.1 ? "warning" : "neutral"}
          definition={{ formula: "Total vencido ÷ cartera pendiente × 100.", source: "Cálculo sobre los dos indicadores anteriores." }} />
        <Stat id="cb-cus" label="Clientes en mora" value={formatNumber(customersOverdue)} href="/cobranzas?vista=bandeja"
          definition={{ formula: "Clientes distintos con al menos una cuota vencida e impaga.", source: "v_contract_balances." }} />
        <Stat id="cb-rec" label="Recuperado este mes" value={formatMoneyCompact(sumBase("collected_month"), base)} tone="positive" sub={foreignNote("collected_month")}
          definition={{ formula: "Σ pagos CONFIRMADOS de clientes con fecha de cobro en el mes actual (excluye usados y notas de crédito).", source: "customer_payments." }} />
        <Stat id="cb-prom" label="Compromisos pendientes" value={formatNumber(pendingPromises.length)} sub={brokenPromises.length ? `${brokenPromises.length} incumplidos` : "Ninguno incumplido"}
          tone={brokenPromises.length ? "critical" : "neutral"} href="/cobranzas?vista=promesas"
          definition={{ formula: "Promesas de pago con fecha futura aún no cubiertas por pagos confirmados. Incumplida = venció sin pagos suficientes.", source: "collection_actions + customer_payments." }} />
      </StatGrid>

      <Tabs active={tab} items={[
        { key: "cartera", label: "Cartera", href: "/cobranzas" },
        { key: "bandeja", label: "Bandeja de hoy", href: "/cobranzas?vista=bandeja" },
        { key: "promesas", label: "Promesas", href: "/cobranzas?vista=promesas", count: pendingPromises.length + brokenPromises.length },
        ...(ctx.perms.has("payments.view") ? [{ key: "confirmar", label: "Pagos por confirmar", href: "/cobranzas?vista=confirmar", count: toConfirm.length }] : []),
      ]} />

      {tab === "cartera" ? <PortfolioTab ctx={ctx} sp={sp} dist={dist} base={base} rate={rate} /> : null}
      {tab === "bandeja" ? <TrayTab ctx={ctx} today={today} /> : null}
      {tab === "promesas" ? (
        <TableWrap>
          {promises.length === 0 ? <EmptyState title="Sin promesas registradas" /> : (
            <Table>
              <THead><Th>Cliente</Th><Th>Contrato</Th><Th numeric>Prometido</Th><Th>Fecha</Th><Th numeric>Pagado desde la promesa</Th><Th>Estado</Th><Th className="hidden lg:table-cell">Registró</Th></THead>
              <tbody>
                {promises.map((p) => (
                  <Tr key={p.id}>
                    <Td><Link href={`/clientes/${p.customer_id}`} className="hover:text-ink">{p.customer}</Link></Td>
                    <Td>{p.contract_id ? <Link href={`/financiaciones/${p.contract_id}`} className="num hover:text-ink">{p.contract}</Link> : "—"}</Td>
                    <Td numeric><Money value={p.promise_amount} currency={p.promise_currency} /></Td>
                    <Td className="num">{formatDate(p.promise_date)}</Td>
                    <Td numeric><Money value={p.paid_since_promise} currency={p.promise_currency} tone="muted" /></Td>
                    <Td><CatalogPill catalog={PROMISE_STATUS} value={p.promise_status} /></Td>
                    <Td className="hidden lg:table-cell" muted>{p.user_name}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </TableWrap>
      ) : null}
      {tab === "confirmar" ? (
        <>
          <p className="mb-3 text-[13px] text-muted">Pagos informados que todavía no cuentan como cobro. Confírmelos sólo tras verificar la acreditación en la cuenta.</p>
          <TableWrap>
            {toConfirm.length === 0 ? <EmptyState title="No hay pagos pendientes de confirmación" /> : (
              <Table>
                <THead><Th>N.º</Th><Th>Cliente</Th><Th>Destino</Th><Th>Fecha</Th><Th>Medio / cuenta</Th><Th>Referencia</Th><Th numeric>Importe</Th><Th className="hidden lg:table-cell">Registró</Th><Th /></THead>
                <tbody>
                  {toConfirm.map((p) => (
                    <Tr key={p.id}>
                      <Td className="num">{p.number}</Td>
                      <Td><Link href={`/clientes/${p.customer_id}`} className="hover:text-ink">{p.customer}</Link></Td>
                      <Td>{p.contract_id ? <Link href={`/financiaciones/${p.contract_id}`} className="num hover:text-ink">{p.contract}</Link> : <span className="text-faint">Seña {p.reservation}</span>}</Td>
                      <Td className="num">{formatDate(p.received_on)}</Td>
                      <Td muted>{PAYMENT_METHOD[p.method]} · {p.account}</Td>
                      <Td muted>{p.reference ?? "—"}</Td>
                      <Td numeric><Money value={p.amount} currency={p.currency} /></Td>
                      <Td className="hidden lg:table-cell" muted>{p.registered_by}</Td>
                      <Td><PaymentRowActions paymentId={p.id} contractId={p.contract_id ?? undefined} status="registrado" canConfirm={ctx.perms.has("payments.confirm")} canVoid={ctx.perms.has("payments.register")} canReverse={false} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </TableWrap>
        </>
      ) : null}
    </>
  );
}

async function PortfolioTab({ ctx, sp, dist, base, rate }: { ctx: AppContext; sp: SearchParams; dist: Awaited<ReturnType<typeof agingDistribution>>; base: string; rate: (c: string) => number | null }) {
  const sort = sortParams(sp, PORTFOLIO_SORTS, "vencido");
  const [rows, collectors] = await Promise.all([
    portfolio(ctx, { sort, bucket: param(sp, "tramo"), collector: param(sp, "responsable"), q: param(sp, "q"), onlyOverdue: param(sp, "solo_vencidos") === "1" }),
    listMembers(ctx, ["cobranzas", "administracion", "finanzas", "director"]),
  ]);
  const sortHref = (field: string, dir: "asc" | "desc") => hrefWith("/cobranzas", sp, { orden: field, dir });
  const byBucket = DEFAULT_AGING_BUCKETS.map((b) => b.label).map((label) => {
    const items = dist.filter((d) => d.label === label);
    const value = items.reduce((a, d) => a + Number(d.label === "Al día" ? d.outstanding : d.overdue) * (rate(d.currency) ?? 0), 0);
    const contracts = items.reduce((a, d) => a + d.contracts, 0);
    return { key: label, label, value, display: formatMoneyCompact(value, base), detail: `${contracts} contrato(s)` };
  });
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_2fr]">
        <ChartCard title="Deuda por antigüedad" subtitle={`Vencido por tramo; «Al día» muestra el saldo no vencido. En ${base}.`}>
          <HBars data={byBucket} valueLabel={`Importe (${base})`} />
        </ChartCard>
        <div className="rounded-lg border border-line-soft bg-surface p-4 text-[13px] text-muted">
          <p className="font-medium text-ink">Cómo se calcula la mora</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Una cuota está vencida si su vencimiento es anterior a hoy y conserva saldo después de aplicar pagos <strong className="text-ink-2">confirmados</strong>.</li>
            <li>Los días de atraso de un contrato son los de su cuota impaga más antigua; el tramo se asigna según la configuración.</li>
            <li>Un pago registrado pero no confirmado no reduce la mora. Una promesa de pago tampoco.</li>
            <li>Cada pago se aplica a la cuota pendiente más antigua; un pago puede cubrir varias cuotas y una cuota recibir varios pagos.</li>
          </ul>
        </div>
      </div>
      <FilterForm keep={[["orden", param(sp, "orden")], ["dir", param(sp, "dir")]]}>
        <SearchInput defaultValue={param(sp, "q")} placeholder="Cliente o contrato" />
        <FilterSelect name="tramo" label="Tramo" defaultValue={param(sp, "tramo")} options={DEFAULT_AGING_BUCKETS.map((b) => ({ value: b.label, label: b.label }))} />
        <FilterSelect name="responsable" label="Responsable" defaultValue={param(sp, "responsable")} options={[{ value: "sin", label: "Sin asignar" }, ...collectors.map((c) => ({ value: c.id, label: c.full_name }))]} />
        <label className="flex h-9 items-center gap-2 text-[13px] text-ink-2">
          <input type="checkbox" name="solo_vencidos" value="1" defaultChecked={param(sp, "solo_vencidos") === "1"} className="size-4 accent-[var(--color-brand)]" /> Sólo con vencido
        </label>
      </FilterForm>
      {rows.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Sin contratos con saldo para estos filtros" /></div> : (
        <TableWrap>
          <Table>
            <THead>
              <SortTh label="Cliente" field="cliente" current={sort.field} dir={sort.dir} hrefFor={sortHref} />
              <Th>Contrato / vehículo</Th>
              <Th numeric className="hidden 2xl:table-cell">Contractual</Th>
              <Th numeric className="hidden xl:table-cell">Pagado conf.</Th>
              <SortTh label="Saldo" field="saldo" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric />
              <SortTh label="Vencido" field="vencido" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric />
              <SortTh label="Próx. venc." field="proximo" current={sort.field} dir={sort.dir} hrefFor={sortHref} />
              <SortTh label="Atraso" field="dias" current={sort.field} dir={sort.dir} hrefFor={sortHref} numeric />
              <Th className="hidden lg:table-cell">Último pago</Th>
              <Th className="hidden lg:table-cell">Responsable</Th>
              <Th>Estado</Th>
            </THead>
            <tbody>
              {rows.map((r) => <PortfolioTr key={r.contract_id} r={r} />)}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </div>
  );
}

function PortfolioTr({ r }: { r: PortfolioRow }) {
  const sev = agingSeverity(r.max_days_overdue);
  return (
    <Tr>
      <Td><Link href={`/clientes/${r.customer_id}`} className="font-medium text-ink hover:underline">{r.customer}</Link></Td>
      <Td><Link href={`/financiaciones/${r.contract_id}`} className="num text-ink-2 hover:text-ink">{r.number}</Link><span className="block max-w-48 truncate text-[11.5px] text-faint">{r.vehicle}</span></Td>
      <Td numeric className="hidden 2xl:table-cell"><Money value={r.total_due} currency={r.currency} tone="muted" /></Td>
      <Td numeric className="hidden xl:table-cell"><Money value={r.total_applied} currency={r.currency} /></Td>
      <Td numeric><Money value={r.outstanding} currency={r.currency} /></Td>
      <Td numeric><Money value={r.overdue_amount} currency={r.currency} tone={Number(r.overdue_amount) > 0 ? "critical" : "muted"} /></Td>
      <Td className="num whitespace-nowrap">{r.next_due_date ? formatDate(r.next_due_date) : "—"}</Td>
      <Td numeric><span className={sev === "ok" ? "text-faint" : sev === "low" ? "text-warning" : "font-semibold text-critical"}>{r.max_days_overdue || "—"}</span></Td>
      <Td className="hidden lg:table-cell" muted>{formatDate(r.last_payment_on)}</Td>
      <Td className="hidden lg:table-cell" muted>{r.collector ?? <span className="text-warning">Sin asignar</span>}</Td>
      <Td>{r.max_days_overdue > 0 ? <StatusPill tone={sev === "low" ? "warning" : "critical"}>{r.bucket}</StatusPill> : <StatusPill tone="positive">Al día</StatusPill>}
        {r.broken_promises ? <span className="mt-1 block text-[11.5px] text-critical">Promesa incumplida</span> : null}</Td>
    </Tr>
  );
}

async function TrayTab({ ctx, today }: { ctx: AppContext; today: string }) {
  const rows = await portfolio(ctx, { sort: { field: "vencido", dir: "desc" } });
  const base = ctx.org.baseCurrency;
  const mine = ctx.perms.has("collections.assign") ? null : ctx.userId;
  const cases = rows
    .filter((r) => !mine || r.collector_id === mine || r.collector_id === null)
    .map((r) => {
      const actionDue = !!r.next_action_at && r.next_action_at <= today;
      const promiseToday = !!r.pending_promise_date && r.pending_promise_date <= today;
      const p = collectionPriority({ overdueAmountBase: Number(r.overdue_base ?? 0), maxDaysOverdue: r.max_days_overdue, brokenPromises: r.broken_promises, nextActionDue: actionDue });
      const reasons = [...p.reasons];
      if (promiseToday) reasons.push("Vence hoy un compromiso de pago");
      return { r, score: p.score + (promiseToday ? 400_000 : 0), reasons };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  return (
    <>
      <p className="mb-3 text-[13px] text-muted">
        Orden sugerido para hoy: primero promesas incumplidas, luego gestiones agendadas y después mayor deuda vencida ponderada por antigüedad.
        {mine ? " Se muestran sus contratos y los que no tienen responsable." : ""}
      </p>
      {cases.length === 0 ? <div className="rounded-lg border border-line-soft bg-surface"><EmptyState title="Nada pendiente para hoy" description="No hay contratos vencidos ni gestiones agendadas." /></div> : (
        <ol className="space-y-2">
          {cases.map(({ r, reasons }, i) => {
            const wa = whatsappHref(r.customer_phone, `Hola ${r.customer.split(" ")[0]}, le escribimos de Da Silva Automotores por su contrato ${r.number}.`);
            return (
              <li key={r.contract_id} className="flex flex-col gap-3 rounded-lg border border-line-soft bg-surface p-4 lg:flex-row lg:items-center">
                <span className="num flex size-7 shrink-0 items-center justify-center rounded-full border border-line text-[12px] text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/financiaciones/${r.contract_id}`} className="font-medium text-ink hover:underline">{r.customer}</Link>
                    <span className="num text-[12.5px] text-faint">{r.number} · {r.vehicle}</span>
                  </p>
                  <p className="mt-1 text-[12.5px] text-warning">{reasons.join(" · ")}</p>
                  <p className="mt-0.5 text-[12px] text-faint">Último pago: {formatDate(r.last_payment_on)} · Responsable: {r.collector ?? "sin asignar"}{r.customer_phone ? ` · ${r.customer_phone}` : ""}</p>
                </div>
                <div className="text-right">
                  <Money value={r.overdue_amount} currency={r.currency} tone="critical" className="font-semibold" />
                  <p className="text-[11.5px] text-faint">{r.max_days_overdue} días · saldo {formatMoneyCompact(r.outstanding, r.currency)}</p>
                  {r.currency !== base && r.overdue_base ? <p className="text-[11px] text-faint">≈ {formatMoneyCompact(r.overdue_base, base)}</p> : null}
                </div>
                <div className="flex gap-2">
                  {wa ? <a href={wa} target="_blank" rel="noopener" aria-label={`WhatsApp a ${r.customer}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-2.5 text-[13px] text-ink-2 hover:bg-elevated"><MessageCircle className="size-4" aria-hidden /> WhatsApp</a> : null}
                  {ctx.perms.has("collections.manage") ? <CollectionActionDialog customerId={r.customer_id} contractId={r.contract_id} currency={r.currency} today={today} label="Gestión" variant="outline" /> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
