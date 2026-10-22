import { getContext, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { ActionForm, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { CUSTOMER_KIND } from "@/lib/labels";
import { createCustomerAction } from "../actions";

export const metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  const ctx = await getContext();
  if (!can(ctx, "customer.write")) return <Panel><Empty title="Se requiere el permiso customer.write" /></Panel>;
  return (
    <>
      <PageHeader crumbs={[["/customers", "Clientes"]]} title="Nuevo cliente" subtitle="El documento evita duplicados: si ya existe un cliente con el mismo documento, el alta se rechaza." />
      <Panel>
        <ActionForm action={createCustomerAction} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Tipo" name="kind"><Select name="kind" options={Object.entries(CUSTOMER_KIND)} /></Field>
          <Field label="Nombre visible" name="display_name"><Input name="display_name" /></Field>
          <Field label="Razón social / nombre legal" name="legal_name"><Input name="legal_name" /></Field>
          <Field label="Correo" name="email"><Input name="email" type="email" /></Field>
          <Field label="Teléfono" name="phone"><Input name="phone" /></Field>
          <Field label="Ciudad" name="city"><Input name="city" /></Field>
          <Field label="País" name="country"><Input name="country" defaultValue="Paraguay" /></Field>
          <Field label="Tipo de documento" name="document_type"><Select name="document_type" placeholder="—" options={[["ci", "Cédula"], ["ruc", "RUC"], ["passport", "Pasaporte"], ["foreign_id", "Documento extranjero"], ["other", "Otro"]]} /></Field>
          <Field label="Número de documento" name="document_number" hint="Dato sensible: acceso restringido y auditado"><Input name="document_number" /></Field>
          <Field label="RUC / identificación fiscal" name="tax_id"><Input name="tax_id" /></Field>
          <Field label="Dirección" name="address" className="lg:col-span-2"><Input name="address" /></Field>
          <Field label="Notas" name="notes" className="sm:col-span-2 lg:col-span-4"><Textarea name="notes" rows={2} /></Field>
          <div><Submit>Crear cliente</Submit></div>
        </ActionForm>
      </Panel>
    </>
  );
}
