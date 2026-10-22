import { getContext, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { ActionForm, Field, Input, Select, Submit, Textarea } from "@/components/ui/Form";
import { CATEGORY } from "@/lib/labels";
import { createUnitAction } from "../actions";

export const metadata = { title: "Nueva unidad" };

export default async function NewUnitPage() {
  const ctx = await getContext();
  if (!can(ctx, "inventory.write")) return <Panel><Empty title="Se requiere el permiso inventory.write" /></Panel>;
  return (
    <>
      <PageHeader crumbs={[["/inventory", "Inventario"]]} title="Alta de unidad"
        subtitle="La unidad inicia en evaluación o compra aprobada. Costes, recepción, preparación y precios se registran en su expediente." />
      <Panel>
        <ActionForm action={createUnitAction} className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Categoría" name="category"><Select name="category" options={Object.entries(CATEGORY)} /></Field>
          <Field label="Marca" name="make"><Input name="make" /></Field>
          <Field label="Modelo" name="model"><Input name="model" /></Field>
          <Field label="Versión" name="version"><Input name="version" /></Field>
          <Field label="Año-modelo" name="model_year"><Input name="model_year" inputMode="numeric" placeholder="2025" /></Field>
          <Field label="Año de fabricación" name="year_built"><Input name="year_built" inputMode="numeric" /></Field>
          <Field label="Uso" name="usage_value"><Input name="usage_value" inputMode="decimal" /></Field>
          <Field label="Unidad de uso" name="usage_unit"><Select name="usage_unit" options={[["km", "Kilómetros"], ["mi", "Millas"], ["h", "Horas"]]} /></Field>
          <Field label="Color exterior" name="exterior_color"><Input name="exterior_color" /></Field>
          <Field label="Interior" name="interior_color"><Input name="interior_color" /></Field>
          <Field label="Procedencia" name="origin"><Select name="origin" options={[["import", "Importación"], ["local_purchase", "Compra local"], ["consignment", "Consignación"]]} /></Field>
          <Field label="País de origen" name="origin_country"><Input name="origin_country" /></Field>
          <Field label="Moneda comercial" name="currency"><Select name="currency" defaultValue={ctx.org.currency} options={[["USD", "USD"], ["PYG", "PYG"], ["EUR", "EUR"]]} /></Field>
          <Field label="Estado inicial" name="acquisition_status"><Select name="acquisition_status" options={[["evaluation", "En evaluación de compra"], ...(can(ctx, "inventory.status.write") ? [["approved", "Compra aprobada"] as [string, string]] : [])]} /></Field>
          <Field label="Identificador" name="identifier_kind"><Select name="identifier_kind" options={[["vin", "VIN"], ["chassis", "Chasis"], ["hull", "Casco (HIN)"], ["serial", "Serie"]]} /></Field>
          <Field label="Valor del identificador" name="identifier_value" hint="Se rechazan duplicados"><Input name="identifier_value" className="uppercase" /></Field>
          <Field label="Equipamiento (separado por comas)" name="equipment" className="sm:col-span-2"><Textarea name="equipment" rows={2} /></Field>
          <Field label="Descripción" name="description" className="sm:col-span-2"><Textarea name="description" rows={2} /></Field>
          <div className="sm:col-span-2 lg:col-span-4"><Submit>Registrar unidad</Submit></div>
        </ActionForm>
      </Panel>
    </>
  );
}
