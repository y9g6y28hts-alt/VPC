"use client";

import { Plus } from "lucide-react";
import { Field, FormGrid, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { EXPENSE_CATEGORY } from "@/lib/labels";
import { createExpense, payExpense } from "@/server/actions/expenses";

export function ExpenseDialog({ suppliers, today }: { suppliers: Array<{ id: string; name: string }>; today: string }) {
  return (
    <FormDialog action={createExpense} trigger={<><Plus aria-hidden /> Registrar gasto</>} triggerVariant="primary" title="Registrar gasto general" description="Gastos no atribuibles a una unidad. Los de una unidad se cargan en su ficha de costes." submitLabel="Registrar" wide>
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Fecha" htmlFor="e-date" required error={s.fieldErrors?.expense_date}><Input id="e-date" name="expense_date" type="date" defaultValue={today} /></Field>
            <Field label="Categoría" htmlFor="e-cat"><Select id="e-cat" name="category" defaultValue="servicios">{Object.entries(EXPENSE_CATEGORY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
            <Field label="Proveedor" htmlFor="e-sup"><Select id="e-sup" name="supplier_id" defaultValue=""><option value="">—</option>{suppliers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
            <Field label="Importe" htmlFor="e-amount" required error={s.fieldErrors?.amount}><Input id="e-amount" name="amount" inputMode="decimal" className="num" /></Field>
            <Field label="Moneda" htmlFor="e-cur"><Select id="e-cur" name="currency" defaultValue="PYG"><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
          </FormGrid>
          <Field label="Descripción" htmlFor="e-desc" required error={s.fieldErrors?.description}><Input id="e-desc" name="description" /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function PayExpenseDialog({ expenseId, currency, accounts, today }: { expenseId: string; currency: string; accounts: Array<{ id: string; name: string; currency: string }>; today: string }) {
  return (
    <FormDialog action={payExpense} trigger="Pagar" triggerSize="sm" title="Pagar gasto" submitLabel="Registrar pago">
      {(s) => (
        <>
          <input type="hidden" name="expense_id" value={expenseId} />
          <FormGrid>
            <Field label="Fecha" htmlFor="pe-date"><Input id="pe-date" name="paid_on" type="date" defaultValue={today} /></Field>
            <Field label="Cuenta" htmlFor="pe-acc" required error={s.fieldErrors?.cash_account_id}>
              <Select id="pe-acc" name="cash_account_id" defaultValue=""><option value="">Seleccione…</option>{accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
            </Field>
          </FormGrid>
          <Field label="Referencia" htmlFor="pe-ref"><Input id="pe-ref" name="reference" /></Field>
        </>
      )}
    </FormDialog>
  );
}
