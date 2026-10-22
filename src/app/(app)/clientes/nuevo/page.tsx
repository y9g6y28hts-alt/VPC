import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/page-header";
import { CustomerForm } from "@/components/customers/customer-form";
import { requirePerm } from "@/server/auth/context";
import { listMembers } from "@/server/queries/common";
import { createCustomer } from "@/server/actions/customers";

export const metadata: Metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  const ctx = await requirePerm("customers.create");
  const canAssign = ctx.perms.has("customers.view_all");
  const sellers = canAssign ? await listMembers(ctx, ["vendedor", "gerencia_comercial", "director"]) : [];
  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Clientes", href: "/clientes" }, { label: "Nuevo" }]} title="Nuevo cliente"
        description="El sistema verifica documento, teléfono y correo para evitar duplicados." />
      <CustomerForm action={createCustomer} sellers={sellers} canAssign={canAssign} cancelHref="/clientes"
        values={{ assigned_seller_id: canAssign ? undefined : ctx.userId }} />
    </>
  );
}
