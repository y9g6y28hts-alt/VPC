"use client";

import { createContext, Fragment, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, OctagonAlert } from "lucide-react";
import { buttonClass, Variant } from "./Button";

export interface ActionState {
  ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string>; redirectTo?: string; at?: number;
}
type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

const ErrorsCtx = createContext<Record<string, string>>({});

export function ActionForm({ action, children, className = "", resetOnSuccess = false, hideMessage = false }: {
  action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; hideMessage?: boolean;
}) {
  const [state, formAction] = useActionState(action, { ok: false });
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && state.redirectTo) router.push(state.redirectTo);
    else if (state.ok) {
      if (resetOnSuccess) ref.current?.reset();
      router.refresh();
    }
  }, [state, router, resetOnSuccess]);
  return (
    <ErrorsCtx.Provider value={state.fieldErrors ?? {}}>
      <form ref={ref} action={formAction} className={className} noValidate>
        {children}
        {!hideMessage && <FormMessage state={state} />}
      </form>
    </ErrorsCtx.Provider>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.at) return null;
  return state.ok ? (
    <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-good"><CheckCircle2 className="size-3.5" />{state.message}</p>
  ) : (
    <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-risk"><OctagonAlert className="mt-px size-3.5 shrink-0" />{state.error}</p>
  );
}

const inputCls = "h-8 w-full rounded-sm border border-line bg-ink px-2.5 text-[13px] text-text placeholder:text-faint focus:border-accent/70 focus:outline-none aria-[invalid=true]:border-risk";

export function Field({ label, name, hint, children, className = "" }: {
  label: string; name?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  const errors = useContext(ErrorsCtx);
  const error = name ? errors[name] : undefined;
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-risk">{error}</span> : hint ? <span className="mt-1 block text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const errors = useContext(ErrorsCtx);
  const invalid = props.name ? Boolean(errors[props.name]) : false;
  return <input {...props} aria-invalid={invalid} className={`${inputCls} ${props.inputMode === "decimal" ? "num text-right" : ""} ${props.className ?? ""}`} />;
}

export function Select({ options, placeholder, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & {
  options: Array<[string, string]>; placeholder?: string;
}) {
  const errors = useContext(ErrorsCtx);
  return (
    <select {...props} aria-invalid={props.name ? Boolean(errors[props.name]) : false} className={`${inputCls} ${props.className ?? ""}`}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputCls} h-auto min-h-16 py-1.5 ${props.className ?? ""}`} />;
}

export function Submit({ children, variant = "primary", size = "md", name, value, disabled }: {
  children: React.ReactNode; variant?: Variant; size?: "sm" | "md"; name?: string; value?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={buttonClass(variant, size)}>
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

/**
 * Confirmación en dos pasos para operaciones financieras: muestra un resumen
 * de los valores del formulario antes de enviarlo.
 */
export function ConfirmSubmit({ label, confirmLabel = "Confirmar", fields, variant = "primary", warning }: {
  label: string; confirmLabel?: string; variant?: Variant; warning?: string;
  fields: Array<{ name: string; label: string; options?: Record<string, string> }>;
}) {
  const [summary, setSummary] = useState<Array<[string, string]> | null>(null);
  const { pending } = useFormStatus();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!pending && summary) setSummary(null); }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps
  const review = () => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const fd = new FormData(form);
    setSummary(fields.map((f) => {
      const raw = String(fd.get(f.name) ?? "");
      return [f.label, (f.options?.[raw] ?? raw) || "—"];
    }));
  };
  return (
    <div ref={ref}>
      {!summary ? (
        <button type="button" onClick={review} className={buttonClass(variant)}>{label}</button>
      ) : (
        <div className="rounded-sm border border-accent/40 bg-raised p-3">
          <p className="mb-2 text-xs font-medium text-accent">Revise antes de confirmar</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            {summary.map(([k, v]) => (<Fragment key={k}><dt className="text-muted">{k}</dt><dd className="num text-text">{v}</dd></Fragment>))}
          </dl>
          {warning && <p className="mt-2 text-xs text-warn">{warning}</p>}
          <div className="mt-3 flex gap-2">
            <Submit variant={variant}>{confirmLabel}</Submit>
            <button type="button" onClick={() => setSummary(null)} className={buttonClass("ghost")}>Volver</button>
          </div>
        </div>
      )}
    </div>
  );
}
