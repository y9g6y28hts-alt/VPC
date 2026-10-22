import { getContext, query, can } from "@/server/context";
import { PageHeader, Panel, Empty } from "@/components/ui/Layout";
import { ActionForm, Field, Select, Submit } from "@/components/ui/Form";
import { LinkButton } from "@/components/ui/Button";
import { SearchParams, sp } from "@/components/ui/Table";
import { money } from "@/lib/format";
import { createDealAction } from "../actions";

export const metadata = { title: "Nueva operación" };

export default async function NewDealPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const ctx = await getContext();
  if (!can(ctx, "deal.write")) return <Panel><Empty title="Se requiere el permiso deal.write" /></Panel>;
  const { units, customers } = await query(ctx, async (db) => ({
    units: await db.rows<{ id: string; stock_number: string; make: string; model: string; version: string | null; list_price: string; currency: string; commercial_status: string }>(
      "select id, stock_number, make, model, version, list_price, currency, commercial_status from public.units where organization_id = $1 and commercial_status in ('available','reserved') order by make, model", [ctx.org.id]),
    customers: await db.rows<{ id: string; display_name: string }>(
      "select id, display_name from public.customers where organization_id = $1 and status <> 'inactive' order by display_name", [ctx.org.id]),
  }));
  return (
    <>
      <PageHeader crumbs={[["/deals", "Mesa de negociación"]]} title="Nueva operación" subtitle="Seleccione la unidad y el cliente; la negociación continúa en la mesa." />
      <Panel>
        <ActionForm action={createDealAction} className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
          <Field label="Unidad disponible o reservada para el cliente" name="unit">
            <Select name="unit" defaultValue={sp(params, "unit") ?? ""} placeholder="Seleccione…" options={units.map((u) => [u.id, `${u.stock_number} · ${u.make} ${u.model} ${u.version ?? ""} · ${money(u.list_price, u.currency)}${u.commercial_status === "reserved" ? " · reservada" : ""}`])} />
          </Field>
          <Field label="Cliente" name="customer" hint={<>¿No existe? <a href="/customers/new" className="text-accent">Crear cliente</a></>}>
            <Select name="customer" defaultValue={sp(params, "customer") ?? ""} placeholder="Seleccione…" options={customers.map((c) => [c.id, c.display_name])} />
          </Field>
          <div className="flex gap-2 md:col-span-2"><Submit>Crear y abrir mesa</Submit><LinkButton href="/deals" variant="ghost">Volver</LinkButton></div>
        </ActionForm>
      </Panel>
    </>
  );
}
