"use client";

import { ChevronRight } from "lucide-react";
import { ActionForm, Field, Input, Submit } from "@/components/ui/Form";
import { demoLoginAction, loginAction } from "./actions";

export function LoginForm({ defaultEmail, defaultPassword }: { defaultEmail?: string; defaultPassword?: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-3">
      <Field label="Correo" name="email"><Input name="email" type="email" autoComplete="username" required defaultValue={defaultEmail} /></Field>
      <Field label="Contraseña" name="password"><Input name="password" type="password" autoComplete="current-password" required defaultValue={defaultPassword} /></Field>
      <div className="pt-1"><Submit>Ingresar</Submit></div>
    </ActionForm>
  );
}

export function DemoAccess({ users }: { users: ReadonlyArray<{ key: string; label: string; hint: string; email: string }> }) {
  return (
    <ActionForm action={demoLoginAction} className="space-y-1.5">
      {users.map((u) => (
        <button key={u.key} type="submit" name="demo" value={u.key}
          className="flex w-full items-center justify-between gap-3 rounded-sm border border-line bg-raised px-3 py-2.5 text-left transition-colors hover:border-accent/60">
          <span>
            <span className="block text-[13px] font-medium text-text">Entrar como {u.label}</span>
            <span className="block text-xs text-muted">{u.hint}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-accent" aria-hidden />
        </button>
      ))}
    </ActionForm>
  );
}
