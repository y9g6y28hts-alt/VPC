import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { AppraisalForm } from "@/components/tradein/appraisal-form";
import { requirePerm } from "@/server/auth/context";
import { getToday } from "@/server/queries/common";
import { customerOptions } from "@/server/queries/customers";
import { getAppraisal } from "@/server/queries/tradein";
import { updateAppraisal } from "@/server/actions/tradein";

export const metadata: Metadata = { title: "Editar tasación" };

export default async function EditAppraisalPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("tradein.create");
  const { id } = await params;
  const t = await getAppraisal(ctx, id);
  if (!t) notFound();
  if (!["borrador", "rechazada"].includes(t.status)) redirect(`/tradein/${id}`);
  const [customers, today] = await Promise.all([customerOptions(ctx), getToday(ctx)]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Trade-in", href: "/tradein" }, { label: t.number, href: `/tradein/${id}` }, { label: "Editar" }]} title={`Editar ${t.number}`} />
      <AppraisalForm action={updateAppraisal} customers={customers} today={today} values={t} />
    </>
  );
}
