"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Field, FormError, Input } from "@/components/ui/field";
import { signIn } from "@/server/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, { ok: false });
  return (
    <form action={action} className="mt-8 space-y-4" noValidate>
      {state.message && !state.fieldErrors ? <FormError message={state.message} /> : null}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Correo electrónico" htmlFor="email" error={state.fieldErrors?.email}>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus aria-invalid={!!state.fieldErrors?.email} />
      </Field>
      <Field label="Contraseña" htmlFor="password" error={state.fieldErrors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.fieldErrors?.password} />
      </Field>
      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      Ingresar
    </button>
  );
}
