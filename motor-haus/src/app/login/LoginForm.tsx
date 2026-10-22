"use client";

import { ActionForm, Field, Input, Submit } from "@/components/ui/Form";
import { loginAction } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-3">
      <Field label="Correo" name="email"><Input name="email" type="email" autoComplete="username" required autoFocus /></Field>
      <Field label="Contraseña" name="password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      <div className="pt-1"><Submit>Ingresar</Submit></div>
    </ActionForm>
  );
}
