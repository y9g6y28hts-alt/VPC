import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { InvoiceForm } from "@/components/payables/payables-forms";
import { param, type SearchParams } from "@/lib/url";
import { requirePerm } from "@/server/auth/context";
import { getToday, listSuppliers } from "@/server/queries/common";

export const metadata: Metadata = { title: "Registrar factura" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requirePerm("payables.create");
  const sp = await searchParams;
  const [suppliers, today, vehicles] = await Promise.all([
    listSuppliers(ctx), getToday(ctx),
    ctx.db((tx) => tx<{ value: string; label: string }[]>`
      select v.id as value, v.stock_code || ' · ' || app.vehicle_name(b.name, v.model) || ' ' || v.year_model as label
      from public.vehicles v join public.brands b on b.id = v.brand_id where v.org_id = ${ctx.org.id} and v.commercial_status <> 'entregado' order by v.stock_code`),
  ]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Compras", href: "/compras" }, { label: "Registrar factura" }]} title="Registrar factura de proveedor"
        description="La factura queda pendiente de aprobación por finanzas o dirección antes de poder pagarse." />
      <InvoiceForm suppliers={suppliers} vehicles={vehicles} today={today} defaultVehicle={param(sp, "unidad")} />
    </>
  );
}
