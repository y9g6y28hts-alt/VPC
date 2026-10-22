import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { ActionForm, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { SearchParams, sp } from "@/components/ui/Table";
import { CATEGORY } from "@/lib/labels";
import { createAppraisalAction } from "../actions";

export const metadata = { title: "Nueva tasación" };

export default async function NewAppraisalPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "tradein.write")) return <Panel><Empty title="Se requiere el permiso tradein.write" /></Panel>;
  const customers = await query(ctx, (db) => db.rows<{ id: string; display_name: string }>(
    "select id, display_name from public.customers where organization_id = $1 order by display_name", [ctx.org.id]));
  return (
    <>
      <PageHeader crumbs={[["/appraisals", "Tasaciones"]]} title="Nueva tasación" subtitle="Registro de la unidad ofrecida. Luego: inspección, costes, valoración con fuente y aprobación." />
      <Panel>
        <ActionForm action={createAppraisalAction} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <input type="hidden" name="deal" value={sp(params, "deal") ?? ""} />
          <Field label="Cliente" name="customer" className="sm:col-span-2"><Select name="customer" defaultValue={sp(params, "customer") ?? ""} placeholder="Seleccione…" options={customers.map((c) => [c.id, c.display_name])} /></Field>
          <Field label="Categoría" name="category"><Select name="category" options={Object.entries(CATEGORY)} /></Field>
          <Field label="Moneda de valoración" name="currency"><Select name="currency" defaultValue={ctx.org.currency} options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]]} /></Field>
          <Field label="Marca" name="make"><Input name="make" /></Field>
          <Field label="Modelo" name="model"><Input name="model" /></Field>
          <Field label="Versión" name="version"><Input name="version" /></Field>
          <Field label="Año" name="year_built"><Input name="year_built" inputMode="numeric" /></Field>
          <Field label="Uso" name="usage_value"><Input name="usage_value" inputMode="decimal" /></Field>
          <Field label="Unidad" name="usage_unit"><Select name="usage_unit" options={[["km", "km"], ["mi", "millas"], ["h", "horas"]]} /></Field>
          <Field label="Identificador" name="identifier_kind"><Select name="identifier_kind" options={[["vin", "VIN"], ["chassis", "Chasis"], ["hull", "Casco"], ["serial", "Serie"]]} /></Field>
          <Field label="Valor" name="identifier_value"><Input name="identifier_value" /></Field>
          <Field label="Historial disponible" name="history_notes" className="sm:col-span-2 lg:col-span-4"><Textarea name="history_notes" rows={2} /></Field>
          <div><Submit>Crear tasación</Submit></div>
        </ActionForm>
      </Panel>
    </>
  );
}
