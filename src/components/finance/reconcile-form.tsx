"use client";

import { useMemo, useState } from "react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, FormGrid, Input, Textarea } from "@/components/ui/field";
import { formatMoney } from "@/lib/format";
import { parseLocaleNumber } from "@/lib/forms";
import { createReconciliation } from "@/server/actions/cash";

export function ReconcileForm({ accountId, periodEnd, currency, movements }: { accountId: string; periodEnd: string; currency: string; movements: Array<{ id: string; date: string; label: string; signed: number }> }) {
  const [checked, setChecked] = useState<Set<string>>(new Set(movements.map((m) => m.id)));
  const [statement, setStatement] = useState("");
  const sumChecked = useMemo(() => movements.filter((m) => checked.has(m.id)).reduce((a, m) => a + m.signed, 0), [checked, movements]);
  const st = parseLocaleNumber(statement);
  return (
    <ActionForm action={createReconciliation} className="space-y-4">
      {(s) => (
        <>
          <input type="hidden" name="account_id" value={accountId} />
          <input type="hidden" name="period_end" value={periodEnd} />
          <ul className="scrollbar-thin max-h-[420px] divide-y divide-line-soft overflow-y-auto rounded-md border border-line-soft">
            {movements.map((m) => (
              <li key={m.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-[13px] hover:bg-elevated/50">
                  <input type="checkbox" name="movement_ids" value={m.id} checked={checked.has(m.id)} className="size-4 accent-[var(--color-brand)]"
                    onChange={(e) => { const n = new Set(checked); if (e.target.checked) n.add(m.id); else n.delete(m.id); setChecked(n); }} />
                  <span className="num w-24 shrink-0 text-faint">{m.date}</span>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{m.label}</span>
                  <span className={`num ${m.signed < 0 ? "text-ink-2" : "text-ink"}`}>{formatMoney(m.signed, currency, { sign: true })}</span>
                </label>
              </li>
            ))}
          </ul>
          <FormGrid cols={3}>
            <Field label="Neto de los marcados" htmlFor="r-net"><Input id="r-net" readOnly value={formatMoney(sumChecked, currency)} className="num" /></Field>
            <Field label={`Saldo del extracto (${currency})`} htmlFor="r-st" required error={s.fieldErrors?.statement_balance}>
              <Input id="r-st" name="statement_balance" inputMode="decimal" className="num" value={statement} onChange={(e) => setStatement(e.target.value)} />
            </Field>
            <Field label="Notas" htmlFor="r-notes"><Textarea id="r-notes" name="notes" rows={1} /></Field>
          </FormGrid>
          <p className="text-[12.5px] text-faint">La diferencia se calcula contra el saldo total del sistema a la fecha. {Number.isFinite(st) ? "" : "Ingrese el saldo del extracto."}</p>
          <div className="flex justify-end"><SubmitButton>Registrar conciliación</SubmitButton></div>
        </>
      )}
    </ActionForm>
  );
}
