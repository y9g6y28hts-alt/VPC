import type { Metadata } from "next";
import { authMode } from "@/server/session";
import { DEMO_PASSWORD, DEMO_USERS, demoLoginEnabled } from "@/server/demo";
import { DemoAccess, LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Ingreso" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const mode = await authMode();
  const demo = mode === "local" && demoLoginEnabled();
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <div className="text-[11px] uppercase tracking-[0.28em] text-accent">Motor Haus</div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{demo ? "Demostración" : "Acceso privado"}</h1>
          <p className="mt-1 text-sm text-muted">Sistema de gestión de activos, ventas y finanzas.</p>
        </div>
        {error === "sin-organizacion" && (
          <p role="alert" className="mb-3 text-xs text-risk">El usuario no tiene una membresía activa en ninguna organización.</p>
        )}
        {demo && (
          <div className="mb-4 rounded-md border border-accent/40 bg-surface p-4">
            <p className="mb-3 text-sm text-text-2">Elija un perfil para entrar. Cada rol ve y puede hacer cosas distintas.</p>
            <DemoAccess users={DEMO_USERS} />
            <p className="mt-3 text-xs text-faint">Datos ficticios de demostración. Contraseña de todos los perfiles: <span className="text-text-2">{DEMO_PASSWORD}</span></p>
          </div>
        )}
        <details open={!demo} className="rounded-md border border-line bg-surface p-5">
          {demo && <summary className="cursor-pointer text-xs text-muted">Ingresar con correo y contraseña</summary>}
          <div className={demo ? "mt-4" : ""}>
            <LoginForm defaultEmail={demo ? DEMO_USERS[0].email : undefined} defaultPassword={demo ? DEMO_PASSWORD : undefined} />
          </div>
        </details>
        {!demo && (
          <p className="mt-4 text-xs leading-relaxed text-faint">
            {mode === "local" ? "Autenticación local: las credenciales se verifican contra la base de datos." : "Autenticación mediante Supabase Auth."}
          </p>
        )}
      </div>
    </main>
  );
}
