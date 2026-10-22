import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { AppraisalForm } from "@/components/tradein/appraisal-form";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getToday } from "@/server/queries/common";
import { customerOptions } from "@/server/queries/customers";
import { createAppraisal } from "@/server/actions/tradein";

export const metadata: Metadata = { title: "Nueva tasación" };

export default async function NewAppraisalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("tradein.create");
  const sp = await searchParams;
  const [customers, today] = await Promise.all([customerOptions(ctx), getToday(ctx)]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trade-in", href: "/tradein" }, { label: "Nueva tasación" }]} title="Nueva tasación"
        description="Registre los datos del usado, su valoración e informe. Luego cargue la inspección por áreas y envíela a revisión." />
      <AppraisalForm action={createAppraisal} customers={customers} today={today} values={{ customer_id: param(sp, "cliente") }} />
    </>
  );
}
