"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { Notice } from "@/components/ui/states";
import { createReservation } from "@/server/actions/inventory";

export function ReserveDialog({
  vehicleId,
  vehicleLabel,
  customers,
  accounts,
  defaultExpiry,
  canRegisterDeposit,
}: {
  vehicleId: string;
  vehicleLabel: string;
  customers: Array<{ value: string; label: string; hint?: string }>;
  accounts: Array<{ id: string; name: string; currency: string }>;
  defaultExpiry: string;
  canRegisterDeposit: boolean;
}) {
  const [currency, setCurrency] = useState("PYG");
  return (
    <FormDialog
      action={createReservation}
      trigger={<><CalendarClock aria-hidden /> Reservar</>}
      triggerVariant="secondary"
      title="Reservar unidad"
      description={vehicleLabel}
      submitLabel="Crear reserva"
      wide
    >
      {(s) => (
        <>
          <input type="hidden" name="vehicle_id" value={vehicleId} />
          <FormGrid>
            <Field label="Cliente" required error={s.fieldErrors?.customer_id}>
              <FilterableSelect name="customer_id" options={customers} placeholder="Seleccione el cliente" invalid={!!s.fieldErrors?.customer_id} />
            </Field>
            <Field label="Vence el" htmlFor="expires_on" required error={s.fieldErrors?.expires_on} hint="La unidad se libera automáticamente al vencer">
              <Input id="expires_on" name="expires_on" type="date" defaultValue={defaultExpiry} />
            </Field>
          </FormGrid>
          <Field label="Observaciones" htmlFor="res-notes">
            <Textarea id="res-notes" name="notes" rows={2} />
          </Field>
          {canRegisterDeposit ? (
            <fieldset className="rounded-md border border-line-soft p-3">
              <legend className="px-1 text-[12.5px] font-medium text-ink-2">Seña (opcional)</legend>
              <FormGrid cols={4}>
                <Field label="Importe" htmlFor="deposit_amount" error={s.fieldErrors?.deposit_amount}>
                  <Input id="deposit_amount" name="deposit_amount" inputMode="decimal" className="num" />
                </Field>
                <Field label="Moneda" htmlFor="deposit_currency">
                  <Select id="deposit_currency" name="deposit_currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="PYG">PYG</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
                <Field label="Medio" htmlFor="deposit_method">
                  <Select id="deposit_method" name="deposit_method" defaultValue="transferencia">
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                    <option value="deposito">Depósito</option>
                    <option value="cheque">Cheque</option>
                    <option value="tarjeta">Tarjeta</option>
                  </Select>
                </Field>
                <Field label="Cuenta" htmlFor="deposit_account" error={s.fieldErrors?.deposit_account}>
                  <Select id="deposit_account" name="deposit_account" defaultValue="">
                    <option value="">—</option>
                    {accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                </Field>
              </FormGrid>
              <Field label="Referencia" htmlFor="deposit_reference" className="mt-3">
                <Input id="deposit_reference" name="deposit_reference" placeholder="N.º de transferencia o recibo" />
              </Field>
              <p className="mt-2 text-[12px] text-faint">La seña queda «registrada» y cuenta como cobro sólo cuando administración la confirma.</p>
            </fieldset>
          ) : (
            <Notice>Para registrar una seña, pida a administración que la cargue: su rol no registra cobros.</Notice>
          )}
        </>
      )}
    </FormDialog>
  );
}
