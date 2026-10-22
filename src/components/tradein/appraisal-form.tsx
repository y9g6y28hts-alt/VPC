"use client";

import Link from "next/link";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { Panel } from "@/components/ui/panel";
import { formatInputAmount } from "@/lib/format";
import { FUEL, TRADEIN_DOC_STATUS, TRANSMISSION } from "@/lib/labels";
import type { AppraisalRow } from "@/server/queries/tradein";

export function AppraisalForm({ action, customers, values, today }: { action: FormAction; customers: Array<{ value: string; label: string; hint?: string }>; values?: Partial<AppraisalRow>; today: string }) {
  const cur = values?.currency ?? "PYG";
  const amt = (v: string | null | undefined) => formatInputAmount(v, cur);
  return (
    <ActionForm action={action} className="space-y-5" successRedirect={(s) => (s.id ? `/tradein/${s.id}` : null)}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        return (
          <>
            {values?.id ? <input type="hidden" name="id" value={values.id} /> : null}
            <Panel title="Cliente y vehículo usado">
              <FormGrid cols={4}>
                <Field label="Cliente" htmlFor="t-customer" required error={e.customer_id} className="sm:col-span-2">
                  <FilterableSelect id="t-customer" name="customer_id" options={customers} defaultValue={values?.customer_id} invalid={!!e.customer_id} />
                </Field>
                <Field label="Marca" htmlFor="t-brand" required error={e.brand_name}><Input id="t-brand" name="brand_name" defaultValue={values?.brand_name} /></Field>
                <Field label="Modelo" htmlFor="t-model" required error={e.model}><Input id="t-model" name="model" defaultValue={values?.model} /></Field>
                <Field label="Versión" htmlFor="t-version"><Input id="t-version" name="version" defaultValue={values?.version ?? ""} /></Field>
                <Field label="Año-modelo" htmlFor="t-year" required error={e.year_model}><Input id="t-year" name="year_model" inputMode="numeric" defaultValue={values?.year_model} /></Field>
                <Field label="Kilometraje" htmlFor="t-km" required error={e.mileage_km}><Input id="t-km" name="mileage_km" inputMode="numeric" defaultValue={values?.mileage_km} /></Field>
                <Field label="Color" htmlFor="t-color"><Input id="t-color" name="color" defaultValue={values?.color ?? ""} /></Field>
                <Field label="VIN / chasis" htmlFor="t-vin"><Input id="t-vin" name="vin" className="uppercase" defaultValue={values?.vin ?? ""} /></Field>
                <Field label="Chapa" htmlFor="t-plate"><Input id="t-plate" name="plate" className="uppercase" defaultValue={values?.plate ?? ""} /></Field>
                <Field label="Combustible" htmlFor="t-fuel"><Select id="t-fuel" name="fuel" defaultValue={values?.fuel ?? "nafta"}>{Object.entries(FUEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Transmisión" htmlFor="t-tr"><Select id="t-tr" name="transmission" defaultValue={values?.transmission ?? "manual"}>{Object.entries(TRANSMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              </FormGrid>
            </Panel>
            <Panel title="Estado documental">
              <FormGrid>
                <Field label="Documentación" htmlFor="t-doc"><Select id="t-doc" name="doc_status" defaultValue={values?.doc_status ?? "sin_revisar"}>{Object.entries(TRADEIN_DOC_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Observaciones documentales" htmlFor="t-docn"><Input id="t-docn" name="doc_notes" defaultValue={values?.doc_notes ?? ""} placeholder="Título, cédula verde, gravámenes, multas…" /></Field>
              </FormGrid>
            </Panel>
            <Panel title="Valoración" description="El valor de mercado es una estimación del tasador con fuente y fecha; no es una tasación profesional verificada.">
              <FormGrid cols={4}>
                <Field label="Moneda" htmlFor="t-cur"><Select id="t-cur" name="currency" defaultValue={cur}><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
                <Field label="Valor de mercado estimado" htmlFor="t-mkt" error={e.market_value_estimate}><Input id="t-mkt" name="market_value_estimate" inputMode="decimal" className="num" defaultValue={amt(values?.market_value_estimate)} /></Field>
                <Field label="Fuente del valor" htmlFor="t-src" error={e.market_value_source}><Input id="t-src" name="market_value_source" defaultValue={values?.market_value_source ?? ""} placeholder="Avisos clasificados, concesionarias…" /></Field>
                <Field label="Fecha de la estimación" htmlFor="t-mdate"><Input id="t-mdate" name="market_value_date" type="date" defaultValue={values?.market_value_date ?? today} /></Field>
                <Field label="Valor ofrecido" htmlFor="t-off" error={e.offered_value}><Input id="t-off" name="offered_value" inputMode="decimal" className="num" defaultValue={amt(values?.offered_value)} /></Field>
                <Field label="Precio de reventa esperado" htmlFor="t-res" error={e.expected_resale_price}><Input id="t-res" name="expected_resale_price" inputMode="decimal" className="num" defaultValue={amt(values?.expected_resale_price)} /></Field>
                <Field label="Reparaciones estimadas" htmlFor="t-rep" hint="Se recalcula con las inspecciones"><Input id="t-rep" name="estimated_repair_costs" inputMode="decimal" className="num" defaultValue={amt(values?.estimated_repair_costs ?? "0")} /></Field>
              </FormGrid>
              <Field label="Informe del tasador" htmlFor="t-notes" className="mt-4"><Textarea id="t-notes" name="appraiser_notes" rows={3} defaultValue={values?.appraiser_notes ?? ""} /></Field>
            </Panel>
            <div className="flex justify-end gap-2">
              <Link href={values?.id ? `/tradein/${values.id}` : "/tradein"} className={buttonClass("ghost")}>Cancelar</Link>
              <SubmitButton>{values?.id ? "Guardar cambios" : "Crear tasación"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
