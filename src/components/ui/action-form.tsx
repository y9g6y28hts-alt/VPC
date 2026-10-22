"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { buttonClass } from "./button";
import { FormError } from "./field";

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Formulario conectado a una acción de servidor. Envía con startTransition
 * (en lugar de la prop `action`) para que React no reinicie los campos cuando
 * el servidor devuelve errores: el usuario conserva lo que escribió.
 */
export function ActionForm({
  action,
  children,
  className,
  successRedirect,
  resetOnSuccess,
  onSuccess,
}: {
  action: FormAction;
  children: (state: ActionState) => ReactNode;
  className?: string;
  successRedirect?: (state: ActionState) => string | null;
  resetOnSuccess?: boolean;
  onSuccess?: (state: ActionState) => void;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    if (state.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      const to = successRedirect?.(state);
      if (to) router.push(to);
    }
  }, [state, router, successRedirect, resetOnSuccess, onSuccess]);

  return (
    <PendingContext.Provider value={pending}>
      <form
        ref={formRef}
        className={className}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
          const fd = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(fd));
        }}
      >
        {!state.ok && state.message ? <FormError message={state.message} /> : null}
        {children(state)}
      </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  disabled,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "outline";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
}) {
  const ctxPending = useContext(PendingContext);
  const { pending: formPending } = useFormStatus();
  const pending = ctxPending || formPending;
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending || disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
