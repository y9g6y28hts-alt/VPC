"use client";

import { useState } from "react";
import { ClipboardCheck, PackagePlus } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { INSPECTION_AREA, INSPECTION_RATING } from "@/lib/labels";
import { acquireAppraisal, customerDecision, saveInspection, submitAppraisal } from "@/server/actions/tradein";

export function InspectionDialog({ appraisalId }: { appraisalId: string }) {
  return (
    <FormDialog action={saveInspection} trigger={<><ClipboardCheck aria-hidden /> Registrar inspección</>} triggerSize="sm" title="Inspección" description="Una por área; volver a registrar un área la actualiza." submitLabel="Guardar">
      {(s) => (
        <>
          <input type="hidden" name="appraisal_id" value={appraisalId} />
          <FormGrid>
            <Field label="Área" htmlFor="i-area"><Select id="i-area" name="area">{Object.entries(INSPECTION_AREA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Estado" htmlFor="i-rating"><Select id="i-rating" name="rating" defaultValue="bueno">{Object.entries(INSPECTION_RATING).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          </FormGrid>
          <Field label="Observaciones" htmlFor="i-notes"><Textarea id="i-notes" name="notes" rows={2} /></Field>
          <Field label="Reparación estimada" htmlFor="i-rep" error={s.fieldErrors?.repair_estimate}><Input id="i-rep" name="repair_estimate" inputMode="decimal" className="num" defaultValue="0" /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function SubmitAppraisalButton({ id }: { id: string }) {
  return <ConfirmAction action={submitAppraisal} hidden={{ appraisal_id: id }} trigger="Enviar a revisión" triggerVariant="primary" triggerSize="md"
    title="Enviar tasación a revisión" description="Gerencia comercial o dirección aprobará o rechazará el valor ofrecido." />;
}

export function CustomerDecisionDialog({ id, offered, currency }: { id: string; offered: string; currency: string }) {
  const [decision, setDecision] = useState("acepta");
  return (
    <FormDialog action={customerDecision} trigger="Respuesta del cliente" triggerVariant="primary" title="Respuesta del cliente" submitLabel="Registrar">
      {(s) => (
        <>
          <input type="hidden" name="appraisal_id" value={id} />
          <Field label="El cliente…" htmlFor="d-dec"><Select id="d-dec" name="decision" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="acepta">Acepta</option><option value="rechaza">No acepta</option></Select></Field>
          {decision === "acepta" ? (
            <Field label={`Valor aceptado (${currency})`} htmlFor="d-val" error={s.fieldErrors?.accepted_value} hint="No puede superar el valor ofrecido aprobado">
              <Input id="d-val" name="accepted_value" inputMode="decimal" className="num" defaultValue={offered} />
            </Field>
          ) : null}
        </>
      )}
    </FormDialog>
  );
}

export function AcquireDialog({ id, brands, categories, today, year, currency, canPrice, suggestedPrice }: { id: string; brands: Array<{ id: string; name: string }>; categories: Array<{ id: string; name: string }>; today: string; year: number; currency: string; canPrice: boolean; suggestedPrice: string }) {
  return (
    <FormDialog action={acquireAppraisal} trigger={<><PackagePlus aria-hidden /> Ingresar al inventario</>} triggerVariant="primary" title="Formalizar adquisición" wide
      description="Crea la unidad en el inventario con el valor aceptado como coste de adquisición y las reparaciones estimadas como gasto pendiente." submitLabel="Ingresar">
      {(s) => (
        <>
          <input type="hidden" name="appraisal_id" value={id} />
          <FormGrid cols={3}>
            <Field label="Fecha de adquisición" htmlFor="a-on" required><Input id="a-on" name="acquired_on" type="date" defaultValue={today} /></Field>
            <Field label="Marca en inventario" htmlFor="a-brand" required error={s.fieldErrors?.brand_id}>
              <Select id="a-brand" name="brand_id" defaultValue=""><option value="">Seleccione…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
            </Field>
            <Field label="Categoría" htmlFor="a-cat"><Select id="a-cat" name="category_id" defaultValue=""><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Año de fabricación" htmlFor="a-year"><Input id="a-year" name="year_manufacture" inputMode="numeric" defaultValue={year} /></Field>
            <Field label="Ubicación" htmlFor="a-loc"><Input id="a-loc" name="location" placeholder="Playa de usados" /></Field>
            <Field label="Moneda de precio" htmlFor="a-cur"><Select id="a-cur" name="price_currency" defaultValue={currency}><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
            {canPrice ? (
              <>
                <Field label="Precio de lista" htmlFor="a-list"><Input id="a-list" name="list_price" inputMode="decimal" className="num" defaultValue={suggestedPrice} /></Field>
                <Field label="Mínimo autorizado" htmlFor="a-min"><Input id="a-min" name="min_price" inputMode="decimal" className="num" /></Field>
              </>
            ) : null}
          </FormGrid>
          {!canPrice ? <p className="text-[12.5px] text-faint">Los precios los fija gerencia comercial desde la ficha de la unidad.</p> : null}
        </>
      )}
    </FormDialog>
  );
}
