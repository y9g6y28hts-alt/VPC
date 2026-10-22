import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { VehicleForm } from "@/components/inventory/vehicle-form";
import { requirePerm } from "@/server/auth/context";
import { getToday, listBranches, listBrands, listCategories, listMembers, listSuppliers } from "@/server/queries/common";
import { createVehicle } from "@/server/actions/inventory";

export const metadata: Metadata = { title: "Nueva unidad" };

export default async function NewVehiclePage() {
  const ctx = await requirePerm("inventory.create");
  const [brands, categories, branches, suppliers, members, today] = await Promise.all([
    listBrands(ctx), listCategories(ctx), listBranches(ctx), listSuppliers(ctx), listMembers(ctx), getToday(ctx),
  ]);
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Inventario", href: "/inventario" }, { label: "Nueva unidad" }]} title="Nueva unidad"
        description="Registre la unidad al recibirla o cuando esté en tránsito. Los costes adicionales se cargan desde su ficha." />
      <VehicleForm
        mode="create"
        action={createVehicle}
        values={{ acquisition_date: today, branch_id: branches[0]?.id }}
        brands={brands}
        categories={categories}
        branches={branches}
        suppliers={suppliers}
        members={members}
        canPrice={ctx.perms.has("inventory.pricing.edit")}
        canCost={ctx.perms.has("inventory.costs.create")}
      />
    </>
  );
}
