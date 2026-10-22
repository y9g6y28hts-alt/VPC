"use client";

import Link from "next/link";
import { useState } from "react";
import { Banknote, Plus } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FilterableSelect } from "@/components/ui/filterable-select";
import { FormDialog } from "@/components/ui/form-dialog";
import { Panel } from "@/components/ui/panel";
import { COST_KIND, INVOICE_CATEGORY, SUPPLIER_KIND } from "@/lib/labels";
import { confirmSupplierPayment, createInvoice, registerSupplierPayment, saveSupplier } from "@/server/actions/payables";

export function SupplierDialog({ supplier }: { supplier?: { id: string; name: string; tax_id: string | null; kind: string; phone: string | null; email: string | null; address: string | null; notes: string | null } }) {
  return (
    <FormDialog action={saveSupplier} trigger={supplier ? "Editar" : <><Plus aria-hidden /> Nuevo proveedor</>} triggerVariant={supplier ? "ghost" : "primary"} triggerSize={supplier ? "sm" : "md"}
      title={supplier ? "Editar proveedor" : "Nuevo proveedor"} submitLabel="Guardar" wide>
      {(s) => (
        <>
          {supplier ? <input type="hidden" name="id" value={supplier.id} /> : null}
          <FormGrid>
            <Field label="Nombre o razón social" htmlFor="s-name" required error={s.fieldErrors?.name}><Input id="s-name" name="name" defaultValue={supplier?.name} /></Field>
            <Field label="RUC" htmlFor="s-ruc" error={s.fieldErrors?.tax_id}><Input id="s-ruc" name="tax_id" defaultValue={supplier?.tax_id ?? ""} placeholder="80012345-6" /></Field>
            <Field label="Tipo" htmlFor="s-kind"><Select id="s-kind" name="kind" defaultValue={supplier?.kind ?? "general"}>{Object.entries(SUPPLIER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Teléfono" htmlFor="s-phone"><Input id="s-phone" name="phone" defaultValue={supplier?.phone ?? ""} /></Field>
            <Field label="Correo" htmlFor="s-email" error={s.fieldErrors?.email}><Input id="s-email" name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
            <Field label="Dirección" htmlFor="s-addr"><Input id="s-addr" name="address" defaultValue={supplier?.address ?? ""} /></Field>
          </FormGrid>
          <Field label="Observaciones" htmlFor="s-notes"><Textarea id="s-notes" name="notes" rows={2} defaultValue={supplier?.notes ?? ""} /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function InvoiceForm({ suppliers, vehicles, today, defaultVehicle }: { suppliers: Array<{ id: string; name: string }>; vehicles: Array<{ value: string; label: string }>; today: string; defaultVehicle?: string }) {
  const [toVehicle, setToVehicle] = useState(!!defaultVehicle);
  return (
    <ActionForm action={createInvoice} className="space-y-5" successRedirect={(s) => (s.id ? `/compras/facturas/${s.id}` : null)}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        return (
          <>
            <Panel title="Factura">
              <FormGrid cols={4}>
                <Field label="Proveedor" htmlFor="f-sup" required error={e.supplier_id} className="sm:col-span-2">
                  <Select id="f-sup" name="supplier_id" defaultValue=""><option value="">Seleccione…</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
                </Field>
                <Field label="N.º de factura" htmlFor="f-num" required error={e.invoice_number}><Input id="f-num" name="invoice_number" placeholder="001-001-0001234" /></Field>
                <Field label="Timbrado" htmlFor="f-tim"><Input id="f-tim" name="timbrado" /></Field>
                <Field label="Emisión" htmlFor="f-iss" required error={e.issue_date}><Input id="f-iss" name="issue_date" type="date" defaultValue={today} /></Field>
                <Field label="Vencimiento" htmlFor="f-due" required error={e.due_date}><Input id="f-due" name="due_date" type="date" defaultValue={today} /></Field>
                <Field label="Moneda" htmlFor="f-cur"><Select id="f-cur" name="currency" defaultValue="PYG"><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
                <Field label="Categoría" htmlFor="f-cat"><Select id="f-cat" name="category" defaultValue="general">{Object.entries(INVOICE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                <Field label="Total (IVA incluido)" htmlFor="f-amount" required error={e.amount}><Input id="f-amount" name="amount" inputMode="decimal" className="num" /></Field>
                <Field label="IVA" htmlFor="f-tax" error={e.tax_amount}><Input id="f-tax" name="tax_amount" inputMode="decimal" className="num" defaultValue="0" /></Field>
              </FormGrid>
              <Field label="Concepto" htmlFor="f-concept" required error={e.concept} className="mt-4"><Input id="f-concept" name="concept" /></Field>
            </Panel>
            <Panel title="Imputación a una unidad" description="Si el gasto corresponde a un vehículo, al aprobarse la factura se registra como coste de esa unidad.">
              <Checkbox name="create_vehicle_cost" checked={toVehicle} onChange={(ev) => setToVehicle(ev.target.checked)} label="Imputar como coste de una unidad" />
              {toVehicle ? (
                <FormGrid className="mt-4">
                  <Field label="Unidad" htmlFor="f-veh" error={e.vehicle_id}><FilterableSelect id="f-veh" name="vehicle_id" options={vehicles} defaultValue={defaultVehicle} /></Field>
                  <Field label="Tipo de coste" htmlFor="f-kind"><Select id="f-kind" name="cost_kind" defaultValue="reparacion">{Object.entries(COST_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
                </FormGrid>
              ) : null}
            </Panel>
            <div className="flex justify-end gap-2">
              <Link href="/compras" className={buttonClass("ghost")}>Cancelar</Link>
              <SubmitButton>Registrar factura</SubmitButton>
            </div>
          </>
        );
      }}
    </ActionForm>
  );
}

export function SupplierPaymentDialog({ invoiceId, currency, accounts, today, maxAmount }: { invoiceId: string; currency: string; accounts: Array<{ id: string; name: string; currency: string }>; today: string; maxAmount: string }) {
  return (
    <FormDialog action={registerSupplierPayment} trigger={<><Banknote aria-hidden /> Registrar pago</>} triggerVariant="primary" title="Pago a proveedor" submitLabel="Registrar"
      description={`Saldo disponible para pagar: ${maxAmount}. Un pago registrado se confirma al verificar el débito en la cuenta.`}>
      {(s) => (
        <>
          <input type="hidden" name="invoice_id" value={invoiceId} />
          <FormGrid>
            <Field label="Fecha" htmlFor="sp-date" required><Input id="sp-date" name="paid_on" type="date" defaultValue={today} /></Field>
            <Field label={`Importe (${currency})`} htmlFor="sp-amount" required error={s.fieldErrors?.amount}><Input id="sp-amount" name="amount" inputMode="decimal" className="num" /></Field>
            <Field label="Cuenta" htmlFor="sp-acc" required error={s.fieldErrors?.cash_account_id}>
              <Select id="sp-acc" name="cash_account_id" defaultValue=""><option value="">Seleccione…</option>{accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </Field>
            <Field label="Referencia" htmlFor="sp-ref"><Input id="sp-ref" name="reference" /></Field>
          </FormGrid>
          <Checkbox name="confirm_now" label="Confirmar ahora (el débito ya figura en la cuenta)" />
        </>
      )}
    </FormDialog>
  );
}

export function ConfirmSupplierPaymentButton({ paymentId, invoiceId }: { paymentId: string; invoiceId: string }) {
  return <ConfirmAction action={confirmSupplierPayment} hidden={{ payment_id: paymentId, invoice_id: invoiceId }} trigger="Confirmar" title="Confirmar pago a proveedor" description="Se registra el egreso en la cuenta seleccionada." />;
}
