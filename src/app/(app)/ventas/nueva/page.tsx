import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { DealBuilder } from "@/components/sales/deal-builder";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { builderData } from "@/server/queries/builder";

export const metadata: Metadata = { title: "Nueva venta" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("deals.create");
  const sp = await searchParams;
  const data = await builderData(ctx);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Ventas", href: "/ventas" }, { label: "Nueva operación" }]} title="Nueva operación de venta"
        description="Defina precio, entrega, usado y financiación. El cálculo se actualiza al instante y el servidor lo valida al guardar." />
      <DealBuilder mode="deal" {...data} initial={{ vehicle_id: param(sp, "unidad"), customer_id: param(sp, "cliente") }} />
    </>
  );
}
