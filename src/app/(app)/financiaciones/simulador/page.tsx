import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { DealBuilder } from "@/components/sales/deal-builder";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { builderData } from "@/server/queries/builder";

export const metadata: Metadata = { title: "Simulador de financiación" };

export default async function SimulatorPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("deals.create", "contracts.view");
  const sp = await searchParams;
  const data = await builderData(ctx);
  return (
    <>
      <PageHeader title="Financiaciones" description="Simule planes en sistema francés o alemán, con refuerzos y tasa cero. La simulación no crea contratos ni compromete la unidad." />
      <Tabs active="simulador" items={[
        ...(ctx.perms.has("contracts.view") ? [{ key: "contratos", label: "Contratos", href: "/financiaciones" }] : []),
        { key: "simulador", label: "Simulador", href: "/financiaciones/simulador" },
      ]} />
      <DealBuilder mode="simulator" {...data} initial={{ vehicle_id: param(sp, "unidad"), customer_id: param(sp, "cliente") }} />
    </>
  );
}
