"use client";

import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { signIn } from "@/server/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={signIn} className="mt-8 space-y-4">
      {(state) => (
        <>
          <input type="hidden" name="next" value={next ?? ""} />
          <Field label="Correo electrónico" htmlFor="email" error={state.fieldErrors?.email}>
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus aria-invalid={!!state.fieldErrors?.email} />
          </Field>
          <Field label="Contraseña" htmlFor="password" error={state.fieldErrors?.password}>
            <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.fieldErrors?.password} />
          </Field>
          <SubmitButton className="w-full">Ingresar</SubmitButton>
        </>
      )}
    </ActionForm>
  );
}
