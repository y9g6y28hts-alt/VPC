import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import { requirePerm } from "@/server/auth/context";
import { listMembers } from "@/server/queries/common";
import { getCustomer } from "@/server/queries/customers";
import { updateCustomer } from "@/server/actions/customers";

export const metadata: Metadata = { title: "Editar cliente" };

export default async function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePerm("customers.edit");
  const { id } = await params;
  const c = await getCustomer(ctx, id);
  if (!c) notFound();
  const canAssign = ctx.perms.has("customers.view_all");
  const sellers = canAssign ? await listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: c.full_name, href: `/clientes/${id}` }, { label: "Editar" }]} title={`Editar ${c.full_name}`} />
      <CustomerForm action={updateCustomer} values={c} sellers={sellers} canAssign={canAssign} cancelHref={`/clientes/${id}`} />
    </>
  );
}
