import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { DealBuilder } from "@/components/sales/deal-builder";
import { requirePerm } from "@/server/auth/context";
import { builderData } from "@/server/queries/builder";
import { getDeal } from "@/server/queries/sales";

export const metadata: Metadata = { title: "Editar operación" };

export default async function EditDealPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("deals.create");
  const { id } = await params;
  const d = await getDeal(ctx, id);
  if (!d) notFound();
  if (d.status !== "borrador") redirect(`/ventas/${id}`);
  const data = await builderData(ctx, { excludeDealId: id, includeVehicleId: d.vehicle_id });
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Ventas", href: "/ventas" }, { label: d.number, href: `/ventas/${id}` }, { label: "Editar" }]}
        title={`Editar ${d.number}`} description="Los cambios de precio y condiciones quedan en el historial de la operación." />
      <DealBuilder mode="deal" {...data} initial={{
        id: d.id,
        customer_id: d.customer_id,
        vehicle_id: d.vehicle_id,
        discount: Number(d.discount_amount),
        trade_in_appraisal_id: d.trade_in_appraisal_id,
        trade_in_value: Number(d.trade_in_value),
        down_payment: Number(d.down_payment),
        payment_type: d.payment_type as "contado" | "financiado",
        terms: d.financing_terms,
        notes: d.notes,
      }} />
    </>
  );
}
