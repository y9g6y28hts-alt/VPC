"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { buttonClass } from "./button";
import { FormError } from "./field";
import { toast } from "./toast";

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Formulario conectado a una acción de servidor: muestra errores de campo y
 * generales, deshabilita el envío mientras se procesa y avisa el resultado.
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
  const [state, formAction] = useActionState(action, { ok: false });
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const lastAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!state.at || state.at === lastAt.current) return;
    lastAt.current = state.at;
    if (state.ok) {
      if (state.message) toast.success(state.message);
      if (resetOnSuccess) formRef.current?.reset();
      onSuccess?.(state);
      const to = successRedirect?.(state);
      if (to) router.push(to);
    }
  }, [state, router, successRedirect, resetOnSuccess, onSuccess]);

  return (
    <form ref={formRef} action={formAction} className={className} noValidate>
      {!state.ok && state.message && !state.fieldErrors ? <FormError message={state.message} /> : null}
      {!state.ok && state.message && state.fieldErrors ? <FormError message={state.message} /> : null}
      {children(state)}
    </form>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "outline";
  size?: "sm" | "md";
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
