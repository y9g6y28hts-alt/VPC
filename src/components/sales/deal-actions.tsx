"use client";

import { FileSignature, PackageCheck } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Notice } from "@/components/ui/states";
import { cancelDeal, deliverDeal, formalizeDeal, reopenDeal, submitDeal } from "@/server/actions/sales";

export function SubmitDealButton({ dealId }: { dealId: string }) {
  return (
    <ConfirmAction action={submitDeal} hidden={{ deal_id: dealId }} trigger="Enviar" triggerVariant="primary" triggerSize="md"
      title="Enviar operación" description="Se valida el precio mínimo y el descuento. Si exceden lo autorizado, pasa a aprobación de gerencia." confirmLabel="Enviar" />
  );
}

export function ReopenDealButton({ dealId }: { dealId: string }) {
  return (
    <ConfirmAction action={reopenDeal} hidden={{ deal_id: dealId }} trigger="Volver a borrador" triggerVariant="ghost" triggerSize="md"
      title="Volver a borrador" description="Permite modificar condiciones. Se anula la solicitud de aprobación pendiente." />
  );
}

export function CancelDealButton({ dealId, formalized }: { dealId: string; formalized: boolean }) {
  return (
    <ConfirmAction action={cancelDeal} hidden={{ deal_id: dealId }} trigger="Anular" triggerVariant="ghost" triggerSize="md" confirmVariant="danger"
      title="Anular operación"
      description={formalized
        ? "Sólo es posible sin cobros aplicados. El contrato queda anulado, el saldo se da de baja y la unidad vuelve a estar disponible."
        : "La operación queda anulada. La unidad no se ve afectada."}
      reasonLabel="Motivo de la anulación" confirmLabel="Anular operación" />
  );
}

export function FormalizeDialog({
  dealId,
  today,
  firstDueDate,
  financed,
  collectors,
  reservedForOther,
}: {
  dealId: string;
  today: string;
  firstDueDate: string | null;
  financed: boolean;
  collectors: Array<{ id: string; full_name: string }>;
  reservedForOther: boolean;
}) {
  return (
    <FormDialog action={formalizeDeal} trigger={<><FileSignature aria-hidden /> Formalizar venta</>} triggerVariant="primary"
      title="Formalizar venta" submitLabel="Formalizar" onSuccessRedirect={(s) => (s.id ? `/financiaciones/${s.id}` : null)}
      description="Genera el contrato, el plan de pagos y la cuenta corriente. La unidad pasa a «vendida, pendiente de entrega».">
      {(s) => (
        <>
          <input type="hidden" name="deal_id" value={dealId} />
          {reservedForOther ? <Notice tone="critical">La unidad está reservada para otro cliente: la formalización será rechazada.</Notice> : null}
          <FormGrid>
            <Field label="Fecha de firma" htmlFor="f-signed" required error={s.fieldErrors?.signed_on}>
              <Input id="f-signed" name="signed_on" type="date" defaultValue={today} max={today} />
            </Field>
            {financed ? (
              <Field label="Primer vencimiento" htmlFor="f-first" error={s.fieldErrors?.first_due_date} hint="Por defecto, el de la propuesta">
                <Input id="f-first" name="first_due_date" type="date" defaultValue={firstDueDate ?? ""} />
              </Field>
            ) : null}
          </FormGrid>
          <Field label="Responsable de cobranza" htmlFor="f-col">
            <Select id="f-col" name="collector_id" defaultValue="">
              <option value="">Sin asignar</option>
              {collectors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
          <p className="text-[12.5px] text-faint">El cronograma se recalcula con la fecha de firma. La operación es atómica: si algo falla (otra venta de la misma unidad, falta de tipo de cambio), no se registra nada.</p>
        </>
      )}
    </FormDialog>
  );
}

export function DeliverDialog({ dealId, today }: { dealId: string; today: string }) {
  return (
    <FormDialog action={deliverDeal} trigger={<><PackageCheck aria-hidden /> Registrar entrega</>} triggerVariant="primary" title="Registrar entrega física" submitLabel="Registrar entrega"
      description="Si la configuración lo exige, la entrega inicial debe estar cobrada y confirmada.">
      {(s) => (
        <>
          <input type="hidden" name="deal_id" value={dealId} />
          <Field label="Fecha de entrega" htmlFor="d-on" required error={s.fieldErrors?.delivered_on}>
            <Input id="d-on" name="delivered_on" type="date" defaultValue={today} />
          </Field>
          <Field label="Observaciones" htmlFor="d-notes">
            <Textarea id="d-notes" name="notes" rows={2} placeholder="Llaves, manuales, accesorios entregados…" />
          </Field>
        </>
      )}
    </FormDialog>
  );
}
