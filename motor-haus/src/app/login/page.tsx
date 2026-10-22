import type { Metadata } from "next";
import { authMode } from "@/server/session";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingreso" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const mode = await authMode();
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="text-[11px] uppercase tracking-[0.28em] text-accent">Motor Haus</div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">Acceso privado</h1>
          <p className="mt-1 text-sm text-muted">Sistema de gestión de activos, ventas y finanzas.</p>
        </div>
        <div className="rounded-md border border-line bg-surface p-5">
          {error === "sin-organizacion" && (
            <p role="alert" className="mb-3 text-xs text-risk">El usuario no tiene una membresía activa en ninguna organización.</p>
          )}
          <LoginForm />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-faint">
          {mode === "local"
            ? "Autenticación local de desarrollo: las credenciales se verifican contra la base local. No usar en producción."
            : "Autenticación mediante Supabase Auth."}
        </p>
      </div>
    </main>
  );
}
