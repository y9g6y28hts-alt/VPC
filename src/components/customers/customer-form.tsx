"use client";

import Link from "next/link";
import { ActionForm, SubmitButton, type FormAction } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { Panel } from "@/components/ui/panel";

export interface CustomerValues {
  id?: string;
  kind?: string;
  full_name?: string;
  doc_type?: string;
  doc_number?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  customer_type?: string;
  source?: string | null;
  assigned_seller_id?: string | null;
  notes?: string | null;
}

export function CustomerForm({
  action,
  values = {},
  sellers,
  canAssign,
  cancelHref,
}: {
  action: FormAction;
  values?: CustomerValues;
  sellers: Array<{ id: string; full_name: string }>;
  canAssign: boolean;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="space-y-5" successRedirect={(s) => (s.id ? `/clientes/${s.id}` : null)}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        return (
          <>
            {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
            <Panel title="Identificación">
              <FormGrid cols={3}>
                <Field label="Tipo" htmlFor="kind" required>
                  <Select id="kind" name="kind" defaultValue={values.kind ?? "persona"}>
                    <option value="persona">Persona física</option>
                    <option value="empresa">Empresa</option>
                  </Select>
                </Field>
                <Field label="Nombre o razón social" htmlFor="full_name" required error={e.full_name} className="sm:col-span-2">
                  <Input id="full_name" name="full_name" defaultValue={values.full_name} aria-invalid={!!e.full_name} />
                </Field>
                <Field label="Documento" htmlFor="doc_type" required>
                  <Select id="doc_type" name="doc_type" defaultValue={values.doc_type ?? "ci"}>
                    <option value="ci">Cédula de identidad</option>
                    <option value="ruc">RUC</option>
                    <option value="pasaporte">Pasaporte</option>
                    <option value="otro">Otro</option>
                  </Select>
                </Field>
                <Field label="Número" htmlFor="doc_number" required error={e.doc_number} hint="Sin puntos. RUC con dígito verificador.">
                  <Input id="doc_number" name="doc_number" defaultValue={values.doc_number} aria-invalid={!!e.doc_number} />
                </Field>
                <Field label="Tipo de cliente" htmlFor="customer_type">
                  <Select id="customer_type" name="customer_type" defaultValue={values.customer_type ?? "particular"}>
                    <option value="particular">Particular</option>
                    <option value="empresa">Empresa</option>
                    <option value="flota">Flota</option>
                    <option value="revendedor">Revendedor</option>
                    <option value="otro">Otro</option>
                  </Select>
                </Field>
              </FormGrid>
            </Panel>
            <Panel title="Contacto">
              <FormGrid cols={3}>
                <Field label="Teléfono" htmlFor="phone" error={e.phone} hint="Celular, p. ej. 0981 123 456">
                  <Input id="phone" name="phone" type="tel" defaultValue={values.phone ?? ""} aria-invalid={!!e.phone} />
                </Field>
                <Field label="Correo" htmlFor="email" error={e.email}>
                  <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} aria-invalid={!!e.email} />
                </Field>
                <Field label="Ciudad" htmlFor="city">
                  <Input id="city" name="city" defaultValue={values.city ?? ""} />
                </Field>
                <Field label="Dirección" htmlFor="address" className="sm:col-span-2">
                  <Input id="address" name="address" defaultValue={values.address ?? ""} />
                </Field>
                <Field label="Origen del contacto" htmlFor="source" hint="Salón, referido, redes, web…">
                  <Input id="source" name="source" defaultValue={values.source ?? ""} />
                </Field>
              </FormGrid>
            </Panel>
            <Panel title="Gestión">
              <FormGrid>
                {canAssign ? (
                  <Field label="Vendedor responsable" htmlFor="assigned_seller_id">
                    <Select id="assigned_seller_id" name="assigned_seller_id" defaultValue={values.assigned_seller_id ?? ""}>
                      <option value="">Sin asignar</option>
                      {sellers.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                    </Select>
                  </Field>
                ) : null}
                <Field label="Observaciones" htmlFor="notes" className={canAssign ? undefined : "sm:col-span-2"}>
                  <Textarea id="notes" name="notes" defaultValue={values.notes ?? ""} rows={2} />
                </Field>
              </FormGrid>
            </Panel>
            {s.needsConfirmation ? (
              <Checkbox name="confirm_duplicate" label="Confirmo que no es un duplicado: es otra persona o empresa" />
            ) : null}
            <div className="flex justify-end gap-2">
              <Link href={cancelHref} className={buttonClass("ghost")}>Cancelar</Link>
              <SubmitButton>{values.id ? "Guardar cambios" : "Registrar cliente"}</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}
