"use client";

import { ArrowLeftRight, Plus } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Field, FormGrid, Input, Select } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { addExchangeRate, createCashAccount, createMovement, reverseMovement, transferFunds } from "@/server/actions/cash";

type Account = { id: string; name: string; currency: string };

export function MovementDialog({ accounts, today }: { accounts: Account[]; today: string }) {
  return (
    <FormDialog action={createMovement} trigger={<><Plus aria-hidden /> Movimiento manual</>} title="Movimiento manual" description="Sólo saldos iniciales, ajustes y otros. Cobros, pagos y gastos se registran desde su módulo." submitLabel="Registrar" wide>
      {(s) => (
        <>
          <FormGrid cols={3}>
            <Field label="Cuenta" htmlFor="m-acc" required error={s.fieldErrors?.account_id}><Select id="m-acc" name="account_id" defaultValue=""><option value="">Seleccione…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</Select></Field>
            <Field label="Fecha" htmlFor="m-date"><Input id="m-date" name="occurred_on" type="date" defaultValue={today} /></Field>
            <Field label="Tipo" htmlFor="m-kind"><Select id="m-kind" name="kind" defaultValue="ajuste"><option value="apertura">Saldo inicial</option><option value="ajuste">Ajuste</option><option value="otro">Otro</option></Select></Field>
            <Field label="Sentido" htmlFor="m-dir"><Select id="m-dir" name="direction" defaultValue="ingreso"><option value="ingreso">Ingreso</option><option value="egreso">Egreso</option></Select></Field>
            <Field label="Importe" htmlFor="m-amount" required error={s.fieldErrors?.amount}><Input id="m-amount" name="amount" inputMode="decimal" className="num" /></Field>
            <Field label="Referencia" htmlFor="m-ref"><Input id="m-ref" name="reference" /></Field>
          </FormGrid>
          <Field label="Descripción" htmlFor="m-desc" required error={s.fieldErrors?.description}><Input id="m-desc" name="description" /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function TransferDialog({ accounts, today }: { accounts: Account[]; today: string }) {
  return (
    <FormDialog action={transferFunds} trigger={<><ArrowLeftRight aria-hidden /> Transferencia</>} title="Transferencia entre cuentas" description="Ambas cuentas deben ser de la misma moneda." submitLabel="Registrar">
      {(s) => (
        <>
          <FormGrid>
            <Field label="Desde" htmlFor="t-from" required error={s.fieldErrors?.from}><Select id="t-from" name="from" defaultValue=""><option value="">Seleccione…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</Select></Field>
            <Field label="Hacia" htmlFor="t-to" required error={s.fieldErrors?.to}><Select id="t-to" name="to" defaultValue=""><option value="">Seleccione…</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</Select></Field>
            <Field label="Importe" htmlFor="t-amount" required error={s.fieldErrors?.amount}><Input id="t-amount" name="amount" inputMode="decimal" className="num" /></Field>
            <Field label="Fecha" htmlFor="t-date"><Input id="t-date" name="date" type="date" defaultValue={today} /></Field>
          </FormGrid>
          <Field label="Descripción" htmlFor="t-desc" required error={s.fieldErrors?.description}><Input id="t-desc" name="description" placeholder="Depósito de caja en banco" /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function ReverseMovementButton({ id }: { id: string }) {
  return <ConfirmAction action={reverseMovement} hidden={{ movement_id: id }} trigger="Revertir" triggerVariant="ghost" title="Revertir movimiento"
    description="Se registra un contraasiento por el mismo importe. El movimiento original no se borra." reasonLabel="Motivo" confirmVariant="danger" confirmLabel="Revertir" />;
}

export function RateDialog({ today }: { today: string }) {
  return (
    <FormDialog action={addExchangeRate} trigger={<><Plus aria-hidden /> Registrar tipo de cambio</>} triggerSize="sm" title="Tipo de cambio" description="Carga manual. Indique la fuente (p. ej. cotización del banco o del BCP del día)." submitLabel="Registrar">
      {(s) => (
        <>
          <FormGrid>
            <Field label="Fecha" htmlFor="r-date"><Input id="r-date" name="rate_date" type="date" defaultValue={today} /></Field>
            <Field label="1 unidad de" htmlFor="r-from"><Select id="r-from" name="from_currency" defaultValue="USD"><option value="USD">USD</option><option value="PYG">PYG</option></Select></Field>
            <Field label="Equivale en" htmlFor="r-to"><Select id="r-to" name="to_currency" defaultValue="PYG"><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
            <Field label="Tipo de cambio" htmlFor="r-rate" required error={s.fieldErrors?.rate}><Input id="r-rate" name="rate" inputMode="decimal" className="num" placeholder="7.350" /></Field>
          </FormGrid>
          <Field label="Fuente" htmlFor="r-src"><Input id="r-src" name="source" placeholder="Cotización vendedor, banco…" /></Field>
        </>
      )}
    </FormDialog>
  );
}

export function AccountDialog() {
  return (
    <FormDialog action={createCashAccount} trigger={<><Plus aria-hidden /> Nueva cuenta</>} triggerSize="sm" title="Nueva cuenta de caja o banco" submitLabel="Crear">
      {(s) => (
        <FormGrid>
          <Field label="Nombre" htmlFor="a-name" required error={s.fieldErrors?.name} className="sm:col-span-2"><Input id="a-name" name="name" placeholder="Banco cuenta corriente Gs." /></Field>
          <Field label="Tipo" htmlFor="a-kind"><Select id="a-kind" name="kind" defaultValue="banco"><option value="caja">Caja</option><option value="banco">Banco</option><option value="billetera">Billetera</option></Select></Field>
          <Field label="Moneda" htmlFor="a-cur"><Select id="a-cur" name="currency" defaultValue="PYG"><option value="PYG">PYG</option><option value="USD">USD</option></Select></Field>
          <Field label="Banco" htmlFor="a-bank"><Input id="a-bank" name="bank_name" /></Field>
          <Field label="Referencia de cuenta" htmlFor="a-ref" hint="Sólo los últimos dígitos"><Input id="a-ref" name="account_ref" /></Field>
        </FormGrid>
      )}
    </FormDialog>
  );
}
