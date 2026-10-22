"use client";

import { Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { ROLE_LABELS, type Role } from "@/domain/permissions";
import type { OrgSettings } from "@/server/queries/common";
import {
  addBranch, addBrand, addCategory, addDocumentType, changePassword, changeRole, createUser, setBrandActive,
  setDocumentTypeRequired, setMemberActive, updateAgingBuckets, updateOrganization, updateSettings,
} from "@/server/actions/settings";

export function OrganizationForm({ org }: { org: { name: string; legal_name: string | null; tax_id: string | null } }) {
  return (
    <ActionForm action={updateOrganization} className="space-y-4">
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Nombre comercial" htmlFor="o-name" required error={s.fieldErrors?.name}><Input id="o-name" name="name" defaultValue={org.name} /></Field>
            <Field label="Razón social" htmlFor="o-legal"><Input id="o-legal" name="legal_name" defaultValue={org.legal_name ?? ""} /></Field>
            <Field label="RUC" htmlFor="o-ruc"><Input id="o-ruc" name="tax_id" defaultValue={org.tax_id ?? ""} /></Field>
          </FormGrid>
          <SubmitButton size="sm">Guardar datos</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function SettingsForm({ settings }: { settings: OrgSettings }) {
  return (
    <ActionForm action={updateSettings} className="space-y-4">
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Descuento máximo sin aprobación (%)" htmlFor="s-disc" required error={s.fieldErrors?.max_discount_pct_without_approval}
              hint="Por encima, la operación requiere aprobación de gerencia.">
              <Input id="s-disc" name="max_discount_pct_without_approval" inputMode="decimal" className="num" defaultValue={String(Number(settings.max_discount_pct_without_approval)).replace(".", ",")} />
            </Field>
            <Field label="Vigencia de reservas (días)" htmlFor="s-res" required error={s.fieldErrors?.reservation_default_days}>
              <Input id="s-res" name="reservation_default_days" inputMode="numeric" className="num" defaultValue={settings.reservation_default_days} />
            </Field>
            <Field label="Validez de propuestas (días)" htmlFor="s-prop" required error={s.fieldErrors?.proposal_validity_days}>
              <Input id="s-prop" name="proposal_validity_days" inputMode="numeric" className="num" defaultValue={settings.proposal_validity_days} />
            </Field>
            <Field label="Alerta de stock antiguo (días)" htmlFor="s-aging" required error={s.fieldErrors?.aging_alert_days}>
              <Input id="s-aging" name="aging_alert_days" inputMode="numeric" className="num" defaultValue={settings.aging_alert_days} />
            </Field>
            <Field label="Aviso de facturas por vencer (días)" htmlFor="s-pay" required error={s.fieldErrors?.payables_due_soon_days}>
              <Input id="s-pay" name="payables_due_soon_days" inputMode="numeric" className="num" defaultValue={settings.payables_due_soon_days} />
            </Field>
            <Field label="Convención de tasa por defecto" htmlFor="s-rate">
              <Select id="s-rate" name="default_rate_convention" defaultValue={settings.default_rate_convention}>
                <option value="nominal_annual">TNA — nominal anual</option>
                <option value="effective_annual">TEA — efectiva anual</option>
                <option value="monthly">TEM — efectiva mensual</option>
              </Select>
            </Field>
          </FormGrid>
          <div>
            <Checkbox name="require_down_payment_before_delivery" defaultChecked={settings.require_down_payment_before_delivery}
              label="Exigir la entrega inicial confirmada antes de registrar la entrega física de la unidad" />
          </div>
          <SubmitButton size="sm">Guardar parámetros</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function AgingBucketsForm({ limits }: { limits: number[] }) {
  return (
    <ActionForm action={updateAgingBuckets} className="flex flex-wrap items-end gap-3">
      {(s) => (
        <>
          <Field label="Límites superiores de cada tramo (días)" htmlFor="ab-limits" error={s.fieldErrors?.limits} hint="Ejemplo: 30, 60, 90 → Al día · 1–30 · 31–60 · 61–90 · Más de 90" className="w-full sm:w-96">
            <Input id="ab-limits" name="limits" defaultValue={limits.join(", ")} className="num" />
          </Field>
          <SubmitButton size="sm">Guardar tramos</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function NewUserDialog({ assignable }: { assignable: Role[] }) {
  return (
    <FormDialog action={createUser} trigger={<><Plus aria-hidden /> Nuevo usuario</>} triggerSize="sm" title="Nuevo usuario"
      description="Se crea la cuenta de acceso con una contraseña inicial. Comuníquela por un canal seguro; el usuario puede cambiarla en «Mi cuenta»." submitLabel="Crear usuario">
      {(s) => (
        <FormGrid>
          <Field label="Nombre completo" htmlFor="u-name" required error={s.fieldErrors?.full_name} className="sm:col-span-2"><Input id="u-name" name="full_name" autoComplete="off" /></Field>
          <Field label="Correo" htmlFor="u-email" required error={s.fieldErrors?.email}><Input id="u-email" name="email" type="email" autoComplete="off" /></Field>
          <Field label="Rol" htmlFor="u-role" required error={s.fieldErrors?.role}>
            <Select id="u-role" name="role" defaultValue=""><option value="">Seleccione…</option>{assignable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>
          </Field>
          <Field label="Contraseña inicial" htmlFor="u-pass" required error={s.fieldErrors?.password} hint="Mínimo 12 caracteres" className="sm:col-span-2">
            <Input id="u-pass" name="password" type="text" autoComplete="new-password" />
          </Field>
        </FormGrid>
      )}
    </FormDialog>
  );
}

export function RoleSelect({ memberId, role, assignable, disabled }: { memberId: string; role: Role; assignable: Role[]; disabled?: boolean }) {
  const options = assignable.includes(role) ? assignable : [role, ...assignable];
  return (
    <ActionForm action={changeRole} className="flex items-center gap-2">
      {() => (
        <>
          <input type="hidden" name="member_id" value={memberId} />
          <label className="sr-only" htmlFor={`role-${memberId}`}>Rol</label>
          <Select id={`role-${memberId}`} name="role" defaultValue={role} disabled={disabled} className="h-8 w-48 text-[13px]"
            onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            {options.map((r) => <option key={r} value={r} disabled={!assignable.includes(r)}>{ROLE_LABELS[r]}</option>)}
          </Select>
        </>
      )}
    </ActionForm>
  );
}

export function MemberActiveButton({ memberId, active, name }: { memberId: string; active: boolean; name: string }) {
  return active ? (
    <ConfirmAction action={setMemberActive} hidden={{ member_id: memberId, active: "false" }} trigger="Desactivar" triggerVariant="ghost"
      title={`Desactivar a ${name}`} description="Pierde el acceso a esta organización de inmediato. Su historial y auditoría se conservan." confirmVariant="danger" confirmLabel="Desactivar" />
  ) : (
    <ConfirmAction action={setMemberActive} hidden={{ member_id: memberId, active: "true" }} trigger="Reactivar" triggerVariant="outline"
      title={`Reactivar a ${name}`} description="Recupera el acceso con el rol que tenía asignado." confirmLabel="Reactivar" />
  );
}

function InlineAdd({ action, name, label, placeholder }: { action: typeof addBrand; name: string; label: string; placeholder?: string }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex items-end gap-2">
      {(s) => (
        <>
          <Field label={label} htmlFor={`add-${label}`} error={s.fieldErrors?.[name]} className="flex-1"><Input id={`add-${label}`} name={name} placeholder={placeholder} /></Field>
          <SubmitButton size="sm" variant="secondary">Agregar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export const AddBrandForm = () => <InlineAdd action={addBrand} name="name" label="Nueva marca" />;
export const AddCategoryForm = () => <InlineAdd action={addCategory} name="name" label="Nueva categoría" placeholder="SUV, Pick-up…" />;

export function AddBranchForm() {
  return (
    <ActionForm action={addBranch} resetOnSuccess className="space-y-3">
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Sucursal" htmlFor="b-name" required error={s.fieldErrors?.name}><Input id="b-name" name="name" /></Field>
            <Field label="Dirección" htmlFor="b-addr"><Input id="b-addr" name="address" /></Field>
            <Field label="Ciudad" htmlFor="b-city"><Input id="b-city" name="city" /></Field>
          </FormGrid>
          <SubmitButton size="sm" variant="secondary">Agregar sucursal</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function ToggleButton({ action, hidden, label }: { action: typeof setBrandActive; hidden: Record<string, string>; label: string }) {
  return (
    <ActionForm action={action}>
      {() => (
        <>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <SubmitButton size="sm" variant="outline">{label}</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export const BrandToggle = ({ id, active }: { id: string; active: boolean }) => (
  <ToggleButton action={setBrandActive} hidden={{ id, active: String(!active) }} label={active ? "Desactivar" : "Activar"} />
);
export const DocTypeToggle = ({ id, required }: { id: string; required: boolean }) => (
  <ToggleButton action={setDocumentTypeRequired} hidden={{ id, required: String(!required) }} label={required ? "Hacer opcional" : "Hacer obligatorio"} />
);

export const DOC_ENTITIES: Record<string, string> = {
  vehicle: "Unidad", customer: "Cliente", deal: "Operación", contract: "Contrato", payment: "Pago",
  supplier_invoice: "Factura de proveedor", trade_in: "Tasación", expense: "Gasto", cash_movement: "Movimiento de caja",
};

export function AddDocumentTypeForm() {
  return (
    <ActionForm action={addDocumentType} resetOnSuccess className="space-y-3">
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Aplica a" htmlFor="dt-ent" required error={s.fieldErrors?.entity_type}>
              <Select id="dt-ent" name="entity_type" defaultValue="vehicle">{Object.entries(DOC_ENTITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            </Field>
            <Field label="Nombre" htmlFor="dt-name" required error={s.fieldErrors?.name}><Input id="dt-name" name="name" placeholder="Título del automotor" /></Field>
            <Field label="Sólo para" htmlFor="dt-cond"><Select id="dt-cond" name="applies_to_condition" defaultValue=""><option value="">Todas las unidades</option><option value="nuevo">0 km</option><option value="usado">Usados</option></Select></Field>
          </FormGrid>
          <div><Checkbox name="is_required" label="Obligatorio (alimenta la alerta de documentación incompleta)" /></div>
          <SubmitButton size="sm" variant="secondary">Agregar tipo</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePassword} resetOnSuccess className="max-w-md space-y-3">
      {(s) => (
        <>
          <Field label="Contraseña actual" htmlFor="p-cur" required error={s.fieldErrors?.current}><Input id="p-cur" name="current" type="password" autoComplete="current-password" /></Field>
          <Field label="Nueva contraseña" htmlFor="p-new" required error={s.fieldErrors?.password} hint="Mínimo 12 caracteres"><Input id="p-new" name="password" type="password" autoComplete="new-password" /></Field>
          <Field label="Repita la nueva contraseña" htmlFor="p-conf" required error={s.fieldErrors?.confirm}><Input id="p-conf" name="confirm" type="password" autoComplete="new-password" /></Field>
          <SubmitButton size="sm">Cambiar contraseña</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
