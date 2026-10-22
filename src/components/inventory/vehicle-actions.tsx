"use client";

import { ImagePlus, Plus, Star } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { COST_KIND, DOC_STATUS, PHYSICAL_STATUS, PREP_STATUS } from "@/lib/labels";
import { formatInputAmount } from "@/lib/format";
import {
  addVehicleCost, cancelReservation, changeVehicleStatus, confirmEstimatedCost, setWithdrawn, updateVehiclePricing,
} from "@/server/actions/inventory";
import { setCoverPhoto, uploadVehiclePhoto } from "@/server/actions/documents";

export function AddCostDialog({ vehicleId, suppliers, today, defaultCurrency }: { vehicleId: string; suppliers: Array<{ id: string; name: string }>; today: string; defaultCurrency: string }) {
  return (
    <FormDialog action={addVehicleCost} trigger={<><Plus aria-hidden /> Registrar coste</>} triggerSize="sm" title="Registrar coste" description="Coste atribuible a esta unidad. Una corrección posterior requiere autorización y queda auditada." submitLabel="Registrar">
      {(s) => (
        <>
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <FormGrid>
            <Field label="Concepto" htmlFor="c-kind" required>
              <Select id="c-kind" name="kind" defaultValue="reparacion">
                {Object.entries(COST_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Fecha" htmlFor="c-date" required error={s.fieldErrors?.incurred_on}>
              <Input id="c-date" name="incurred_on" type="date" defaultValue={today} />
            </Field>
          </FormGrid>
          <Field label="Descripción" htmlFor="c-desc" required error={s.fieldErrors?.description}>
            <Input id="c-desc" name="description" placeholder="Cambio de pastillas y discos" />
          </Field>
          <FormGrid>
            <Field label="Importe" htmlFor="c-amount" required error={s.fieldErrors?.amount}>
              <Input id="c-amount" name="amount" inputMode="decimal" className="num" />
            </Field>
            <Field label="Moneda" htmlFor="c-cur">
              <Select id="c-cur" name="currency" defaultValue={defaultCurrency}>
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
          </FormGrid>
          <Field label="Proveedor" htmlFor="c-sup">
            <Select id="c-sup" name="supplier_id" defaultValue="">
              <option value="">—</option>
              {suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          </Field>
          <Checkbox name="is_estimate" label="Es un presupuesto / estimación (aún sin factura)" />
        </>
      )}
    </FormDialog>
  );
}

export function ConfirmCostButton({ costId, vehicleId }: { costId: string; vehicleId: string }) {
  return (
    <ConfirmAction action={confirmEstimatedCost} hidden={{ cost_id: costId, vehicle_id: vehicleId }} trigger="Confirmar" triggerVariant="ghost"
      title="Confirmar coste" description="El coste estimado pasa a registrado. Si el importe final difiere, corríjalo antes (queda auditado)." />
  );
}

const DIMENSIONS = {
  physical_status: { label: "Situación física", catalog: PHYSICAL_STATUS },
  prep_status: { label: "Preparación", catalog: PREP_STATUS },
  doc_status: { label: "Documentación", catalog: DOC_STATUS },
} as const;

export function StatusChangeForm({ vehicleId, dimension, current }: { vehicleId: string; dimension: keyof typeof DIMENSIONS; current: string }) {
  const d = DIMENSIONS[dimension];
  return (
    <ActionForm action={changeVehicleStatus} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      {() => (
        <>
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <input type="hidden" name="dimension" value={dimension} />
          <Field label={d.label} htmlFor={`st-${dimension}`} className="sm:w-56">
            <Select id={`st-${dimension}`} name="value" defaultValue={current}>
              {Object.entries(d.catalog).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          </Field>
          <Field label="Nota (opcional)" htmlFor={`stn-${dimension}`} className="flex-1">
            <Input id={`stn-${dimension}`} name="note" placeholder="Motivo o detalle" />
          </Field>
          <SubmitButton variant="secondary">Actualizar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function PricingForm({ vehicleId, currency, list, min }: { vehicleId: string; currency: string; list: string | null; min: string | null }) {
  return (
    <ActionForm action={updateVehiclePricing} className="space-y-3">
      {(s) => (
        <>
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <FormGrid cols={3}>
            <Field label="Moneda" htmlFor="p-cur">
              <Select id="p-cur" name="price_currency" defaultValue={currency}>
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Precio de lista" htmlFor="p-list" error={s.fieldErrors?.list_price}>
              <Input id="p-list" name="list_price" inputMode="decimal" className="num" defaultValue={formatInputAmount(list, currency)} />
            </Field>
            <Field label="Mínimo autorizado" htmlFor="p-min" error={s.fieldErrors?.min_price}>
              <Input id="p-min" name="min_price" inputMode="decimal" className="num" defaultValue={formatInputAmount(min, currency)} />
            </Field>
          </FormGrid>
          <div className="flex justify-end">
            <SubmitButton variant="secondary" size="sm">Guardar precios</SubmitButton>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function WithdrawButton({ vehicleId, withdraw }: { vehicleId: string; withdraw: boolean }) {
  return (
    <ConfirmAction
      action={setWithdrawn}
      hidden={{ vehicle_id: vehicleId, withdraw: withdraw ? "1" : "0" }}
      trigger={withdraw ? "Retirar de la venta" : "Reincorporar"}
      triggerVariant="ghost"
      triggerSize="md"
      title={withdraw ? "Retirar unidad de la venta" : "Reincorporar unidad al stock"}
      description={withdraw ? "La unidad deja de estar disponible para reservas y ventas." : "La unidad vuelve a estar disponible."}
      reasonLabel="Motivo"
      confirmVariant={withdraw ? "danger" : "primary"}
    />
  );
}

export function CancelReservationButton({ reservationId, vehicleId }: { reservationId: string; vehicleId: string }) {
  return (
    <ConfirmAction
      action={cancelReservation}
      hidden={{ reservation_id: reservationId, vehicle_id: vehicleId }}
      trigger="Anular reserva"
      triggerVariant="danger"
      title="Anular reserva"
      description="La unidad vuelve a estar disponible. Si hubo seña, gestione su devolución o aplicación desde Cobranzas."
      reasonLabel="Motivo de la anulación"
      confirmVariant="danger"
    />
  );
}

export function PhotoUploadDialog({ vehicleId }: { vehicleId: string }) {
  return (
    <FormDialog action={uploadVehiclePhoto} trigger={<><ImagePlus aria-hidden /> Fotografías</>} triggerSize="sm" title="Cargar fotografías" description="JPG, PNG o WEBP, hasta 10 MB cada una. La primera de la unidad será la portada." submitLabel="Cargar">
      {() => (
        <>
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <input name="files" type="file" multiple accept="image/jpeg,image/png,image/webp" required
            className="block w-full text-[13px] text-muted file:mr-3 file:h-9 file:rounded-md file:border file:border-line file:bg-elevated file:px-3 file:text-ink" />
        </>
      )}
    </FormDialog>
  );
}

export function CoverButton({ photoId, vehicleId }: { photoId: string; vehicleId: string }) {
  return (
    <ActionForm action={setCoverPhoto}>
      {() => (
        <>
          <input type="hidden" name="photo_id" value={photoId} />
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <button type="submit" title="Usar como portada" aria-label="Usar como portada" className="rounded-md bg-black/60 p-1.5 text-ink-2 hover:text-ink">
            <Star className="size-3.5" />
          </button>
        </>
      )}
    </ActionForm>
  );
}

