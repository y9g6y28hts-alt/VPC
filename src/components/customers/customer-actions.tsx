"use client";

import { MessageSquarePlus, Target, UserCog } from "lucide-react";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { addInteraction, assignCollector, createOpportunity } from "@/server/actions/customers";

export function InteractionDialog({ customerId }: { customerId: string }) {
  return (
    <FormDialog action={addInteraction} trigger={<><MessageSquarePlus aria-hidden /> Registrar contacto</>} title="Registrar interacción" submitLabel="Registrar">
      {(s) => (
        <>
          <input type="hidden" name="customer_id" value={customerId} />
          <Field label="Canal" htmlFor="i-ch">
            <Select id="i-ch" name="channel" defaultValue="whatsapp">
              <option value="whatsapp">WhatsApp</option>
              <option value="llamada">Llamada</option>
              <option value="visita">Visita</option>
              <option value="email">Correo</option>
              <option value="nota">Nota interna</option>
              <option value="otro">Otro</option>
            </Select>
          </Field>
          <Field label="Resumen" htmlFor="i-sum" required error={s.fieldErrors?.summary}>
            <Textarea id="i-sum" name="summary" rows={3} placeholder="Qué se habló, interés, objeciones…" />
          </Field>
          <FormGrid>
            <Field label="Próxima acción" htmlFor="i-na">
              <Input id="i-na" name="next_action" placeholder="Enviar propuesta" />
            </Field>
            <Field label="Fecha" htmlFor="i-nad" error={s.fieldErrors?.next_action_at}>
              <Input id="i-nad" name="next_action_at" type="date" />
            </Field>
          </FormGrid>
        </>
      )}
    </FormDialog>
  );
}

export function OpportunityDialog({
  customerId,
  stages,
  vehicles,
  customers,
}: {
  customerId?: string;
  stages: Array<{ id: string; name: string; is_won: boolean; is_lost: boolean }>;
  vehicles: Array<{ id: string; label: string }>;
  customers?: Array<{ value: string; label: string }>;
}) {
  return (
    <FormDialog action={createOpportunity} trigger={<><Target aria-hidden /> Nueva oportunidad</>} title="Nueva oportunidad" description="Un interés comercial. No es una venta: la venta se registra en Ventas." submitLabel="Crear" wide>
      {(s) => (
        <>
          {customerId ? <input type="hidden" name="customer_id" value={customerId} /> : (
            <Field label="Cliente" htmlFor="o-c" required error={s.fieldErrors?.customer_id}>
              <Select id="o-c" name="customer_id" defaultValue="">
                <option value="">Seleccione…</option>
                {customers?.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            </Field>
          )}
          <Field label="Descripción" htmlFor="o-t" required error={s.fieldErrors?.title}>
            <Input id="o-t" name="title" placeholder="SUV familiar con financiación a 24 meses" />
          </Field>
          <FormGrid>
            <Field label="Unidad de interés" htmlFor="o-v">
              <Select id="o-v" name="vehicle_id" defaultValue="">
                <option value="">Sin definir</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </Select>
            </Field>
            <Field label="Etapa" htmlFor="o-s" required>
              <Select id="o-s" name="stage_id" defaultValue={stages[0]?.id}>
                {stages.filter((x) => !x.is_won && !x.is_lost).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </Select>
            </Field>
            <Field label="Valor esperado" htmlFor="o-ev" error={s.fieldErrors?.expected_value}>
              <Input id="o-ev" name="expected_value" inputMode="decimal" className="num" />
            </Field>
            <Field label="Moneda" htmlFor="o-cur">
              <Select id="o-cur" name="currency" defaultValue="PYG">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Próxima acción" htmlFor="o-na">
              <Input id="o-na" name="next_action" />
            </Field>
            <Field label="Fecha" htmlFor="o-nad">
              <Input id="o-nad" name="next_action_at" type="date" />
            </Field>
          </FormGrid>
        </>
      )}
    </FormDialog>
  );
}

export function AssignCollectorDialog({ customerId, current, collectors }: { customerId: string; current: string | null; collectors: Array<{ id: string; full_name: string }> }) {
  return (
    <FormDialog action={assignCollector} trigger={<><UserCog aria-hidden /> Responsable de cobranza</>} triggerVariant="ghost" title="Responsable de cobranza" submitLabel="Asignar">
      {() => (
        <>
          <input type="hidden" name="customer_id" value={customerId} />
          <Field label="Responsable" htmlFor="col">
            <Select id="col" name="collector_id" defaultValue={current ?? ""}>
              <option value="">Sin asignar</option>
              {collectors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
            </Select>
          </Field>
        </>
      )}
    </FormDialog>
  );
}
