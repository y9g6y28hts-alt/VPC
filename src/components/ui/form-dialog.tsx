"use client";

import { useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { ActionForm, SubmitButton, type FormAction } from "./action-form";
import { buttonClass } from "./button";
import { cn } from "./cn";

/** Botón que abre un diálogo con un formulario conectado a una acción de servidor. */
export function FormDialog({
  action,
  trigger,
  triggerVariant = "secondary",
  triggerSize = "md",
  triggerClassName,
  title,
  description,
  submitLabel = "Guardar",
  wide,
  children,
  onSuccessRedirect,
}: {
  action: FormAction;
  trigger: ReactNode;
  triggerVariant?: "primary" | "secondary" | "ghost" | "outline" | "danger";
  triggerSize?: "sm" | "md";
  triggerClassName?: string;
  title: string;
  description?: ReactNode;
  submitLabel?: string;
  wide?: boolean;
  children: (state: ActionState) => ReactNode;
  onSuccessRedirect?: (s: ActionState) => string | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  return (
    <>
      <button type="button" className={buttonClass(triggerVariant, triggerSize, triggerClassName)} onClick={() => ref.current?.showModal()}>
        {trigger}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={`${id}-t`}
        className={cn(
          "m-auto max-h-[92dvh] rounded-lg border border-line bg-surface p-0 text-ink shadow-[var(--shadow-pop)]",
          wide ? "w-[min(96vw,760px)]" : "w-[min(94vw,520px)]",
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
          <div>
            <h2 id={`${id}-t`} className="text-base font-semibold">{title}</h2>
            {description ? <div className="mt-1 text-[13px] text-muted">{description}</div> : null}
          </div>
          <button type="button" aria-label="Cerrar" onClick={() => ref.current?.close()} className="rounded-md p-1 text-faint hover:bg-elevated hover:text-ink">
            <X className="size-5" />
          </button>
        </div>
        <ActionForm
          action={action}
          className="flex flex-col gap-4 px-5 py-4"
          resetOnSuccess
          onSuccess={() => ref.current?.close()}
          successRedirect={onSuccessRedirect}
        >
          {(state) => (
            <>
              {children(state)}
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" className={buttonClass("ghost")} onClick={() => ref.current?.close()}>
                  Cancelar
                </button>
                <SubmitButton>{submitLabel}</SubmitButton>
              </div>
            </>
          )}
        </ActionForm>
      </dialog>
    </>
  );
}
