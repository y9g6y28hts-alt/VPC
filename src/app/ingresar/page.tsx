import type { Metadata } from "next";
import { Brand } from "@/components/shell/brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Ingresar" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ siguiente?: string }> }) {
  const { siguiente } = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <section className="relative hidden overflow-hidden border-r border-line-soft lg:block">
        <div aria-hidden className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_100%,rgba(200,16,46,0.16),transparent_60%)]" />
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-line to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <Brand />
          <div className="max-w-md">
            <p className="display text-[34px] font-semibold leading-[1.1] text-ink">
              Inventario, ventas, cobros y caja en un solo lugar.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted">
              Plataforma privada de Da Silva Automotores. Acceso restringido a personal autorizado; toda acción
              sensible queda registrada.
            </p>
          </div>
          <p className="text-[12px] text-faint">Range Rover · Ford · Changan</p>
        </div>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-2xl font-semibold text-ink">Ingresar</h1>
          <p className="mt-1.5 text-sm text-muted">Use las credenciales que le asignó la administración.</p>
          <LoginForm next={siguiente} />
          <p className="mt-8 text-[12.5px] leading-relaxed text-faint">
            ¿Olvidó su contraseña o necesita acceso? Solicítelo al administrador técnico de la empresa.
          </p>
        </div>
      </section>
    </main>
  );
}
