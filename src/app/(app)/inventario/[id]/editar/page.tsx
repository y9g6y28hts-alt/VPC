import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { VehicleForm } from "@/components/inventory/vehicle-form";
import { requirePerm } from "@/server/auth/context";
import { listBranches, listBrands, listCategories, listMembers, listSuppliers } from "@/server/queries/common";
import { getVehicle } from "@/server/queries/inventory";
import { updateVehicle } from "@/server/actions/inventory";

export const metadata: Metadata = { title: "Editar unidad" };

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("inventory.edit");
  const { id } = await params;
  const [v, brands, categories, branches, suppliers, members] = await Promise.all([
    getVehicle(ctx, id), listBrands(ctx), listCategories(ctx), listBranches(ctx), listSuppliers(ctx), listMembers(ctx),
  ]);
  if (!v) notFound();
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Inventario", href: "/inventario" }, { label: v.stock_code, href: `/inventario/${id}` }, { label: "Editar" }]}
        title={`Editar ${v.brand} ${v.model}`} description="Los cambios quedan registrados en la auditoría." />
      <VehicleForm
        mode="edit"
        action={updateVehicle}
        values={{ ...v, list_price: v.list_price, min_price: v.min_price }}
        brands={brands}
        categories={categories}
        branches={branches}
        suppliers={suppliers}
        members={members}
        canPrice={ctx.perms.has("inventory.pricing.edit")}
        canCost={false}
      />
    </>
  );
}
