"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { buttonClass } from "./button";
import { Field, FormError, Textarea } from "./field";
import { toast } from "./toast";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Acción sensible con confirmación explícita. Si `reasonLabel` está definido,
 * exige un motivo (mín. 5 caracteres) que queda en la auditoría.
 */
export function ConfirmAction({
  action,
  hidden,
  trigger,
  triggerVariant = "secondary",
  triggerSize = "sm",
  title,
  description,
  confirmLabel = "Confirmar",
  confirmVariant = "primary",
  reasonLabel,
  children,
}: {
  action: Action;
  hidden: Record<string, string>;
  trigger: ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "danger" | "outline";
  triggerSize?: "sm" | "md";
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  confirmVariant?: "primary" | "danger";
  reasonLabel?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, { ok: false });
  const [reason, setReason] = useState("");
  const last = useRef<number | undefined>(undefined);
  const id = useId();

  useEffect(() => {
    if (!state.at || state.at === last.current) return;
    last.current = state.at;
    if (state.ok) {
      ref.current?.close();
      setReason("");
      toast.success(state.message ?? "Operación realizada");
    }
  }, [state]);

  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize)} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-t`}
        className="m-auto w-[min(94vw,480px)] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]"
      >
        <form action={formAction} className="flex flex-col gap-4 p-5">
          <div>
            <h2 id={`${id}-t`} className="text-base font-semibold">
              {title}
            </h2>
            {description ? <div className="mt-1.5 text-[13px] text-muted">{description}</div> : null}
          </div>
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {children}
          {reasonLabel ? (
            <Field label={reasonLabel} htmlFor={`${id}-r`} required hint="Queda registrado en la auditoría.">
              <Textarea id={`${id}-r`} name="reason" value={reason} onChange={(e) => setReason(e.target.value)} required minLength={5} />
            </Field>
          ) : null}
          {!state.ok && state.message ? <FormError message={state.message} /> : null}
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass("ghost", "md")} onClick={() => ref.current?.close()}>
              Cancelar
            </button>
            <ConfirmSubmit variant={confirmVariant} disabled={!!reasonLabel && reason.trim().length < 5}>
              {confirmLabel}
            </ConfirmSubmit>
          </div>
        </form>
      </dialog>
    </>
  );
}

function ConfirmSubmit({ children, variant, disabled }: { children: ReactNode; variant: "primary" | "danger"; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={buttonClass(variant, "md")}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
