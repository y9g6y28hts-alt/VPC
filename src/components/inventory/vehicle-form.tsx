"use client";

import Link from "next/link";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";
import { FUEL, ORIGIN, PHYSICAL_STATUS, TRANSMISSION } from "@/lib/labels";
import { formatInputAmount } from "@/lib/format";

type Opt = { id: string; name: string };

export interface VehicleFormValues {
  id?: string;
  row_version?: number;
  stock_code?: string;
  brand_id?: string;
  category_id?: string | null;
  branch_id?: string | null;
  model?: string;
  version?: string | null;
  year_manufacture?: number;
  year_model?: number;
  vin?: string | null;
  engine_number?: string | null;
  plate?: string | null;
  mileage_km?: number;
  fuel?: string;
  transmission?: string;
  color?: string | null;
  condition?: string;
  origin?: string;
  location?: string | null;
  acquisition_date?: string | null;
  supplier_id?: string | null;
  responsible_id?: string | null;
  physical_status?: string;
  description?: string | null;
  price_currency?: string;
  list_price?: string | null;
  min_price?: string | null;
}

export function VehicleForm({
  action,
  values = {},
  brands,
  categories,
  branches,
  suppliers,
  members,
  canPrice,
  canCost,
  canEdit = true,
  mode,
}: {
  action: FormAction;
  values?: VehicleFormValues;
  brands: Opt[];
  categories: Opt[];
  branches: Opt[];
  suppliers: Opt[];
  members: Array<{ id: string; full_name: string }>;
  canPrice: boolean;
  canCost: boolean;
  canEdit?: boolean;
  mode: "create" | "edit";
}) {
  const year = new Date().getFullYear();
  return (
    <ActionForm
      action={action}
      className="space-y-5"
      successRedirect={(s) => (s.id ? `/inventario/${s.id}` : null)}
    >
      {(state) => {
        const e = state.fieldErrors ?? {};
        const ro = !canEdit;
        return (
          <>
            {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
            {values.row_version ? <input type="hidden" name="row_version" value={values.row_version} /> : null}
            <Panel title="Identificación">
              <FormGrid cols={4}>
                <Field label="Código interno" htmlFor="stock_code" hint={mode === "create" ? "Vacío = se asigna automáticamente" : undefined} error={e.stock_code}>
                  <Input id="stock_code" name="stock_code" defaultValue={values.stock_code} disabled={mode === "edit"} />
                </Field>
                <Field label="Marca" htmlFor="brand_id" required error={e.brand_id}>
                  <Select id="brand_id" name="brand_id" defaultValue={values.brand_id ?? ""} disabled={ro} aria-invalid={!!e.brand_id}>
                    <option value="">Seleccione…</option>
                    {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Modelo" htmlFor="model" required error={e.model}>
                  <Input id="model" name="model" defaultValue={values.model} readOnly={ro} aria-invalid={!!e.model} placeholder="Ranger" />
                </Field>
                <Field label="Versión" htmlFor="version" error={e.version}>
                  <Input id="version" name="version" defaultValue={values.version ?? ""} readOnly={ro} placeholder="XLT 3.0 V6 4x4 AT" />
                </Field>
                <Field label="Año de fabricación" htmlFor="year_manufacture" required error={e.year_manufacture}>
                  <Input id="year_manufacture" name="year_manufacture" inputMode="numeric" defaultValue={values.year_manufacture ?? year} readOnly={ro} />
                </Field>
                <Field label="Año-modelo" htmlFor="year_model" required error={e.year_model}>
                  <Input id="year_model" name="year_model" inputMode="numeric" defaultValue={values.year_model ?? year + 1} readOnly={ro} />
                </Field>
                <Field label="VIN / chasis" htmlFor="vin" error={e.vin}>
                  <Input id="vin" name="vin" defaultValue={values.vin ?? ""} readOnly={ro} className="uppercase" />
                </Field>
                <Field label="N.º de motor" htmlFor="engine_number" error={e.engine_number}>
                  <Input id="engine_number" name="engine_number" defaultValue={values.engine_number ?? ""} readOnly={ro} />
                </Field>
                <Field label="Chapa" htmlFor="plate" error={e.plate}>
                  <Input id="plate" name="plate" defaultValue={values.plate ?? ""} readOnly={ro} className="uppercase" />
                </Field>
                <Field label="Categoría" htmlFor="category_id">
                  <Select id="category_id" name="category_id" defaultValue={values.category_id ?? ""} disabled={ro}>
                    <option value="">Sin categoría</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                <Field label="Condición" htmlFor="condition" required error={e.condition}>
                  <Select id="condition" name="condition" defaultValue={values.condition ?? "nuevo"} disabled={ro}>
                    <option value="nuevo">Nuevo</option>
                    <option value="usado">Usado</option>
                  </Select>
                </Field>
                <Field label="Origen" htmlFor="origin" required>
                  <Select id="origin" name="origin" defaultValue={values.origin ?? "compra_local"} disabled={ro}>
                    {Object.entries(ORIGIN).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              </FormGrid>
            </Panel>

            <Panel title="Ficha técnica y ubicación">
              <FormGrid cols={4}>
                <Field label="Kilometraje" htmlFor="mileage_km" required error={e.mileage_km}>
                  <Input id="mileage_km" name="mileage_km" inputMode="numeric" defaultValue={values.mileage_km ?? 0} readOnly={ro} />
                </Field>
                <Field label="Combustible" htmlFor="fuel" required error={e.fuel}>
                  <Select id="fuel" name="fuel" defaultValue={values.fuel ?? "nafta"} disabled={ro}>
                    {Object.entries(FUEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Transmisión" htmlFor="transmission" required error={e.transmission}>
                  <Select id="transmission" name="transmission" defaultValue={values.transmission ?? "automatica"} disabled={ro}>
                    {Object.entries(TRANSMISSION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
                <Field label="Color" htmlFor="color">
                  <Input id="color" name="color" defaultValue={values.color ?? ""} readOnly={ro} />
                </Field>
                <Field label="Sucursal" htmlFor="branch_id">
                  <Select id="branch_id" name="branch_id" defaultValue={values.branch_id ?? ""} disabled={ro}>
                    <option value="">—</option>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
                <Field label="Ubicación" htmlFor="location" hint="Salón, depósito, taller…">
                  <Input id="location" name="location" defaultValue={values.location ?? ""} readOnly={ro} />
                </Field>
                {mode === "create" ? (
                  <Field label="Situación física" htmlFor="physical_status">
                    <Select id="physical_status" name="physical_status" defaultValue={values.physical_status ?? "recibido"}>
                      {Object.entries(PHYSICAL_STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Responsable" htmlFor="responsible_id">
                  <Select id="responsible_id" name="responsible_id" defaultValue={values.responsible_id ?? ""} disabled={ro}>
                    <option value="">—</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </Select>
                </Field>
              </FormGrid>
              <Field label="Descripción / equipamiento" htmlFor="description" className="mt-4">
                <Textarea id="description" name="description" defaultValue={values.description ?? ""} readOnly={ro} rows={3} />
              </Field>
            </Panel>

            <Panel title="Adquisición" description="El coste total se compone de todos los costes registrados en la ficha de la unidad.">
              <FormGrid cols={4}>
                <Field label="Fecha de adquisición" htmlFor="acquisition_date" error={e.acquisition_date}>
                  <Input id="acquisition_date" name="acquisition_date" type="date" defaultValue={values.acquisition_date ?? ""} readOnly={ro} />
                </Field>
                <Field label="Proveedor" htmlFor="supplier_id">
                  <Select id="supplier_id" name="supplier_id" defaultValue={values.supplier_id ?? ""} disabled={ro}>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                </Field>
                {mode === "create" && canCost ? (
                  <>
                    <Field label="Coste de adquisición" htmlFor="acquisition_cost" error={e.acquisition_cost} hint="Puede cargarse después">
                      <Input id="acquisition_cost" name="acquisition_cost" inputMode="decimal" className="num" />
                    </Field>
                    <Field label="Moneda del coste" htmlFor="acquisition_cost_currency">
                      <Select id="acquisition_cost_currency" name="acquisition_cost_currency" defaultValue="">
                        <option value="">Igual al precio</option>
                        <option value="PYG">Guaraníes (PYG)</option>
                        <option value="USD">Dólares (USD)</option>
                      </Select>
                    </Field>
                  </>
                ) : null}
              </FormGrid>
            </Panel>

            <Panel
              title="Precios"
              description={canPrice ? "El precio mínimo autorizado define cuándo una venta requiere aprobación." : "Sólo gerencia comercial y dirección modifican precios."}
            >
              <FormGrid cols={3}>
                <Field label="Moneda" htmlFor="price_currency" required>
                  <Select id="price_currency" name="price_currency" defaultValue={values.price_currency ?? "PYG"} disabled={!canPrice && mode === "edit"}>
                    <option value="PYG">Guaraníes (PYG)</option>
                    <option value="USD">Dólares (USD)</option>
                  </Select>
                  {!canPrice && mode === "edit" ? <input type="hidden" name="price_currency" value={values.price_currency ?? "PYG"} /> : null}
                </Field>
                <Field label="Precio de lista" htmlFor="list_price" error={e.list_price}>
                  <Input id="list_price" name="list_price" inputMode="decimal" className="num" defaultValue={formatInputAmount(values.list_price, values.price_currency ?? "PYG")} readOnly={!canPrice} />
                </Field>
                <Field label="Precio mínimo autorizado" htmlFor="min_price" error={e.min_price}>
                  <Input id="min_price" name="min_price" inputMode="decimal" className="num" defaultValue={formatInputAmount(values.min_price, values.price_currency ?? "PYG")} readOnly={!canPrice} />
                </Field>
              </FormGrid>
            </Panel>

            <div className="flex justify-end gap-2">
              <Link href={values.id ? `/inventario/${values.id}` : "/inventario"} className={buttonClass("ghost")}>
                Cancelar
              </Link>
              <SubmitButton>{mode === "create" ? "Registrar unidad" : "Guardar cambios"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
