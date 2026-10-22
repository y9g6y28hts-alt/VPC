import Link from "next/link";
import type { Metadata } from "next";
import { Money } from "@/components/ui/money";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { FilterForm, FilterSelect } from "@/components/ui/filter-form";
import { OpportunityDialog } from "@/components/customers/customer-actions";
import { MoveStageForm } from "@/components/customers/move-stage";
import { formatDate, formatMoneyCompact } from "@/lib/format";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getToday, listMembers } from "@/server/queries/common";
import { customerOptions, listOpportunities, pipelineStages } from "@/server/queries/customers";
import { sellableVehicles } from "@/server/queries/inventory";

export const metadata: Metadata = { title: "Embudo comercial" };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("crm.manage", "customers.view_all");
  const sp = await searchParams;
  const seller = param(sp, "vendedor");
  const [stages, opps, today] = await Promise.all([pipelineStages(ctx), listOpportunities(ctx, seller), getToday(ctx)]);
  const canManage = ctx.perms.has("crm.manage");
  const [vehicles, customers, sellers] = await Promise.all([
    canManage ? sellableVehicles(ctx) : Promise.resolve([]),
    canManage ? customerOptions(ctx) : Promise.resolve([]),
    ctx.perms.has("customers.view_all") ? listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : Promise.resolve([]),
  ]);
  const open = stages.filter((s) => !s.is_won && !s.is_lost);

  return (
    <>
      <PageHeader title="Clientes" description="Seguimiento comercial por etapa. Las etapas de venta y entrega se completan solas al formalizar y entregar la operación."
        actions={canManage ? <OpportunityDialog stages={stages} vehicles={vehicles} customers={customers} /> : null} />
      <Tabs active="oportunidades" items={[{ key: "clientes", label: "Clientes", href: "/clientes" }, { key: "oportunidades", label: "Embudo comercial", href: "/clientes/oportunidades", count: opps.length }]} />
      {sellers.length ? (
        <FilterForm>
          <FilterSelect name="vendedor" label="Vendedor" defaultValue={seller} options={sellers.map((s) => ({ value: s.id, label: s.full_name }))} />
        </FilterForm>
      ) : null}
      <div className="scrollbar-thin -mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="grid min-w-[1100px] gap-3" style={{ gridTemplateColumns: `repeat(${open.length}, minmax(0, 1fr))` }}>
          {open.map((s) => {
            const list = opps.filter((o) => o.stage_id === s.id);
            const total = list.reduce((a, o) => a + (o.currency === "PYG" ? Number(o.expected_value ?? 0) : 0), 0);
            return (
              <section key={s.id} aria-label={s.name} className="flex min-h-64 flex-col rounded-lg border border-line-soft bg-surface">
                <header className="border-b border-line-soft px-3 py-2.5">
                  <p className="flex items-center justify-between text-[12.5px] font-semibold text-ink">{s.name}<span className="num text-faint">{list.length}</span></p>
                  <p className="num mt-0.5 text-[11.5px] text-faint">{total ? formatMoneyCompact(total, "PYG") : "—"}</p>
                </header>
                <ul className="flex flex-1 flex-col gap-2 p-2">
                  {list.map((o) => {
                    const late = o.next_action_at && o.next_action_at < today;
                    return (
                      <li key={o.id} className="rounded-md border border-line-soft bg-carbon/50 p-2.5 text-[12.5px]">
                        <Link href={`/clientes/${o.customer_id}`} className="block font-medium text-ink hover:underline">{o.customer}</Link>
                        <p className="mt-0.5 text-muted">{o.title}</p>
                        {o.vehicle ? <p className="mt-0.5 truncate text-faint">{o.vehicle}</p> : null}
                        <div className="mt-2 flex items-center justify-between">
                          <Money value={o.expected_value} currency={o.currency} compact className="text-ink-2" />
                          <span className="text-faint">{o.days_in_stage} d</span>
                        </div>
                        {o.next_action_at ? <p className={`mt-1 ${late ? "text-critical" : "text-faint"}`}>{late ? "Atrasada: " : ""}{o.next_action ?? "Acción"} · {formatDate(o.next_action_at)}</p> : null}
                        {o.seller && sellers.length ? <p className="mt-1 text-faint">{o.seller}</p> : null}
                        {canManage ? <MoveStageForm opportunityId={o.id} currentStageId={o.stage_id} stages={stages} /> : null}
                      </li>
                    );
                  })}
                  {list.length === 0 ? <li className="px-1 py-4 text-center text-[12px] text-faint">Sin oportunidades</li> : null}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
