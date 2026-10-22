"use client";

import { useMemo, useState } from "react";
import { BadgeDollarSign, CalendarClock, FilePen, PhoneCall, RefreshCcw } from "lucide-react";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/ui/field";
import { FormDialog } from "@/components/ui/form-dialog";
import { Notice } from "@/components/ui/states";
import { AMORTIZATION_LABELS, amortize, type AmortizationMethod } from "@/domain/financing/amortization";
import { RATE_CONVENTION_LABELS, monthlyRateFrom, type RateConvention } from "@/domain/financing/rates";
import { addMonths } from "@/domain/dates";
import { formatMoney } from "@/lib/format";
import { parseLocaleNumber } from "@/lib/forms";
import {
  confirmPayment, registerCollectionAction, registerPayment, requestAdjustment, requestRefinance, reversePayment, voidPayment,
} from "@/server/actions/payments";

type Account = { id: string; name: string; currency: string };

export function RegisterPaymentDialog({
  customerId,
  contractId,
  contractCurrency,
  accounts,
  today,
  canConfirm,
  label = "Registrar pago",
  variant = "primary",
}: {
  customerId: string;
  contractId?: string;
  contractCurrency: string;
  accounts: Account[];
  today: string;
  canConfirm: boolean;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [currency, setCurrency] = useState(contractCurrency);
  return (
    <FormDialog action={registerPayment} trigger={<><BadgeDollarSign aria-hidden /> {label}</>} triggerVariant={variant} title="Registrar pago recibido"
      description="Un pago registrado no cuenta como cobro hasta que se confirma. Al confirmar se aplica a las cuotas más antiguas." submitLabel="Registrar" wide>
      {(s) => (
        <>
          <input type="hidden" name="customer_id" value={customerId} />
          {contractId ? <input type="hidden" name="contract_id" value={contractId} /> : null}
          <FormGrid cols={3}>
            <Field label="Fecha de cobro" htmlFor="p-date" required error={s.fieldErrors?.received_on}>
              <Input id="p-date" name="received_on" type="date" defaultValue={today} max={today} />
            </Field>
            <Field label="Medio" htmlFor="p-method" required>
              <Select id="p-method" name="method" defaultValue="transferencia">
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="deposito">Depósito</option>
                <option value="cheque">Cheque</option>
                <option value="tarjeta">Tarjeta</option>
              </Select>
            </Field>
            <Field label="Moneda" htmlFor="p-cur" hint={currency !== contractCurrency ? `Se convierte a ${contractCurrency} con el tipo de cambio registrado` : undefined}>
              <Select id="p-cur" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
              </Select>
            </Field>
            <Field label="Importe" htmlFor="p-amount" required error={s.fieldErrors?.amount}>
              <Input id="p-amount" name="amount" inputMode="decimal" className="num" />
            </Field>
            <Field label="Cuenta de ingreso" htmlFor="p-acc" required error={s.fieldErrors?.cash_account_id}>
              <Select id="p-acc" name="cash_account_id" defaultValue="">
                <option value="">Seleccione…</option>
                {accounts.filter((a) => a.currency === currency).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            </Field>
            <Field label="Referencia" htmlFor="p-ref" error={s.fieldErrors?.reference} hint="N.º de transferencia, depósito o cheque">
              <Input id="p-ref" name="reference" />
            </Field>
          </FormGrid>
          <Field label="Observaciones" htmlFor="p-notes"><Textarea id="p-notes" name="notes" rows={2} /></Field>
          {s.needsConfirmation ? <Checkbox name="allow_duplicate" label="Verifiqué el extracto: no es un duplicado, registrarlo igual" /> : null}
          {canConfirm ? <Checkbox name="confirm_now" label="Confirmar ahora (verifiqué la acreditación en la cuenta)" /> : null}
        </>
      )}
    </FormDialog>
  );
}

export function PaymentRowActions({ paymentId, contractId, status, canConfirm, canVoid, canReverse }: { paymentId: string; contractId?: string; status: string; canConfirm: boolean; canVoid: boolean; canReverse: boolean }) {
  const hidden = { payment_id: paymentId, contract_id: contractId ?? "" };
  return (
    <div className="flex justify-end gap-1">
      {status === "registrado" && canConfirm ? (
        <ConfirmAction action={confirmPayment} hidden={hidden} trigger="Confirmar" triggerVariant="secondary" title="Confirmar pago"
          description="Confirme sólo si verificó la acreditación. Se aplicará a las cuotas pendientes más antiguas y se registrará el ingreso de caja." />
      ) : null}
      {status === "registrado" && canVoid ? (
        <ConfirmAction action={voidPayment} hidden={hidden} trigger="Anular" triggerVariant="ghost" title="Anular pago no confirmado"
          description="El pago no tuvo efectos contables." reasonLabel="Motivo" confirmVariant="danger" />
      ) : null}
      {status === "confirmado" && canReverse ? (
        <ConfirmAction action={reversePayment} hidden={hidden} trigger="Revertir" triggerVariant="ghost" title="Revertir pago confirmado"
          description="Se restituye la deuda de las cuotas, se registra un egreso de caja y queda constancia en la cuenta corriente y la auditoría. No se borra nada."
          reasonLabel="Motivo de la reversión" confirmVariant="danger" confirmLabel="Revertir pago" />
      ) : null}
    </div>
  );
}

export function AdjustmentDialog({ contractId, currency, today }: { contractId: string; currency: string; today: string }) {
  const [kind, setKind] = useState("recargo");
  return (
    <FormDialog action={requestAdjustment} trigger={<><FilePen aria-hidden /> Solicitar ajuste</>} triggerVariant="ghost" title="Solicitar recargo o nota de crédito"
      description="Requiere aprobación de finanzas o dirección. No modifica el saldo hasta ser aprobado." submitLabel="Enviar a aprobación">
      {(s) => (
        <>
          <input type="hidden" name="contract_id" value={contractId} />
          <FormGrid>
            <Field label="Tipo" htmlFor="a-kind">
              <Select id="a-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="recargo">Recargo (aumenta la deuda)</option>
                <option value="nota_credito">Nota de crédito (reduce la deuda)</option>
              </Select>
            </Field>
            <Field label={`Importe (${currency})`} htmlFor="a-amount" required error={s.fieldErrors?.amount}>
              <Input id="a-amount" name="amount" inputMode="decimal" className="num" />
            </Field>
          </FormGrid>
          <Field label="Descripción en la cuenta del cliente" htmlFor="a-desc" required error={s.fieldErrors?.description}>
            <Input id="a-desc" name="description" placeholder={kind === "recargo" ? "Interés por mora cuota 5" : "Bonificación acordada"} />
          </Field>
          {kind === "recargo" ? (
            <Field label="Vencimiento del recargo" htmlFor="a-due" required error={s.fieldErrors?.due_date}>
              <Input id="a-due" name="due_date" type="date" defaultValue={today} />
            </Field>
          ) : null}
          <Field label="Motivo (para quien aprueba)" htmlFor="a-reason" required error={s.fieldErrors?.reason}>
            <Textarea id="a-reason" name="reason" rows={2} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function RefinanceDialog({ contractId, currency, outstanding, today }: { contractId: string; currency: "PYG" | "USD"; outstanding: number; today: string }) {
  const [method, setMethod] = useState<AmortizationMethod>("frances");
  const [rate, setRate] = useState("18");
  const [conv, setConv] = useState<RateConvention>("nominal_annual");
  const [term, setTerm] = useState("12");
  const [first, setFirst] = useState(addMonths(today, 1));
  const preview = useMemo(() => {
    try {
      const r = amortize({ principal: outstanding, currency, monthlyRate: monthlyRateFrom(parseLocaleNumber(rate || "0"), conv), termMonths: Number(term), method, firstDueDate: first });
      return { ok: true as const, text: `${term} cuotas · ${method === "frances" ? "cuota" : "primera cuota"} ${formatMoney(r.regularPayment, currency)} · intereses ${formatMoney(r.totalInterest, currency)}` };
    } catch (e) {
      return { ok: false as const, text: (e as Error).message };
    }
  }, [outstanding, currency, rate, conv, term, method, first]);
  return (
    <FormDialog action={requestRefinance} trigger={<><RefreshCcw aria-hidden /> Refinanciar</>} triggerVariant="ghost" title="Solicitar refinanciación"
      description={`Reemplaza el saldo vigente (${formatMoney(outstanding, currency)}, incluye vencido) por un nuevo plan. Requiere aprobación; crea una nueva versión del contrato.`} submitLabel="Enviar a aprobación" wide>
      {(s) => (
        <>
          <input type="hidden" name="contract_id" value={contractId} />
          <input type="hidden" name="outstanding" value={String(outstanding)} />
          <input type="hidden" name="currency" value={currency} />
          <FormGrid cols={3}>
            <Field label="Sistema" htmlFor="r-m">
              <Select id="r-m" name="method" value={method} onChange={(e) => setMethod(e.target.value as AmortizationMethod)}>
                {Object.entries(AMORTIZATION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Tasa (%)" htmlFor="r-r" error={s.fieldErrors?.rate}>
              <Input id="r-r" name="rate" inputMode="decimal" className="num" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
            <Field label="Expresión" htmlFor="r-c">
              <Select id="r-c" name="convention" value={conv} onChange={(e) => setConv(e.target.value as RateConvention)}>
                {Object.entries(RATE_CONVENTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Plazo (meses)" htmlFor="r-t" error={s.fieldErrors?.term}>
              <Input id="r-t" name="term" inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} />
            </Field>
            <Field label="Primer vencimiento" htmlFor="r-f" error={s.fieldErrors?.first_due_date}>
              <Input id="r-f" name="first_due_date" type="date" value={first} onChange={(e) => setFirst(e.target.value)} />
            </Field>
          </FormGrid>
          <Notice tone={preview.ok ? "info" : "warning"}>{preview.text}</Notice>
          <Field label="Motivo" htmlFor="r-reason" required error={s.fieldErrors?.reason}>
            <Textarea id="r-reason" name="reason" rows={2} />
          </Field>
        </>
      )}
    </FormDialog>
  );
}

export function CollectionActionDialog({ customerId, contractId, currency, today, label = "Registrar gestión", variant = "secondary" }: { customerId: string; contractId?: string; currency: string; today: string; label?: string; variant?: "secondary" | "ghost" | "outline" }) {
  const [result, setResult] = useState("contactado");
  return (
    <FormDialog action={registerCollectionAction} trigger={<><PhoneCall aria-hidden /> {label}</>} triggerVariant={variant} triggerSize={variant === "ghost" ? "sm" : "md"}
      title="Registrar gestión de cobranza" submitLabel="Registrar" wide>
      {(s) => (
        <>
          <input type="hidden" name="customer_id" value={customerId} />
          {contractId ? <input type="hidden" name="contract_id" value={contractId} /> : null}
          <FormGrid cols={3}>
            <Field label="Canal" htmlFor="c-ch">
              <Select id="c-ch" name="channel" defaultValue="llamada">
                <option value="llamada">Llamada</option><option value="whatsapp">WhatsApp</option><option value="visita">Visita</option>
                <option value="email">Correo</option><option value="sms">SMS</option><option value="otro">Otro</option>
              </Select>
            </Field>
            <Field label="Resultado" htmlFor="c-res" className="sm:col-span-2">
              <Select id="c-res" name="result" value={result} onChange={(e) => setResult(e.target.value)}>
                <option value="contactado">Contactado</option><option value="sin_respuesta">Sin respuesta</option>
                <option value="numero_erroneo">Número erróneo</option><option value="promesa_pago">Promesa de pago</option>
                <option value="pago_informado">Informa que pagó (verificar)</option><option value="negativa">Se niega a pagar</option><option value="otro">Otro</option>
              </Select>
            </Field>
          </FormGrid>
          {result === "promesa_pago" ? (
            <FormGrid cols={3}>
              <Field label="Importe prometido" htmlFor="c-pa" required error={s.fieldErrors?.promise_amount}>
                <Input id="c-pa" name="promise_amount" inputMode="decimal" className="num" />
              </Field>
              <Field label="Moneda" htmlFor="c-pc">
                <Select id="c-pc" name="promise_currency" defaultValue={currency}><option value="PYG">PYG</option><option value="USD">USD</option></Select>
              </Field>
              <Field label="Fecha prometida" htmlFor="c-pd" required error={s.fieldErrors?.promise_date}>
                <Input id="c-pd" name="promise_date" type="date" min={today} />
              </Field>
            </FormGrid>
          ) : null}
          {result === "pago_informado" ? <Notice>Registre el pago en el contrato para que administración lo confirme contra la cuenta.</Notice> : null}
          <Field label="Observaciones" htmlFor="c-notes"><Textarea id="c-notes" name="notes" rows={2} /></Field>
          <FormGrid>
            <Field label="Próxima acción" htmlFor="c-na"><Input id="c-na" name="next_action" placeholder="Volver a llamar" /></Field>
            <Field label="Fecha" htmlFor="c-nad"><Input id="c-nad" name="next_action_at" type="date" defaultValue={today} /></Field>
          </FormGrid>
          <p className="flex items-center gap-1.5 text-[12px] text-faint"><CalendarClock className="size-3.5" aria-hidden /> Las promesas de pago no se contabilizan como dinero recibido.</p>
        </>
      )}
    </FormDialog>
  );
}
