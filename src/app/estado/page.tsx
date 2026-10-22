import Link from "next/link";
import type { Metadata } from "next";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, CircleMinus, XCircle } from "lucide-react";
import { Brand } from "@/components/shell/brand";
import { buttonClass } from "@/components/ui/button";
import { isEmbeddedDemo } from "@/server/db/client";
import { runChecks, type CheckStatus } from "@/server/health";

export const metadata: Metadata = { title: "Estado del sistema" };

const ICON: Record<CheckStatus, { Icon: typeof CheckCircle2; cls: string; label: string }> = {
  ok: { Icon: CheckCircle2, cls: "text-positive", label: "Correcto" },
  warning: { Icon: AlertTriangle, cls: "text-warning", label: "Advertencia" },
  error: { Icon: XCircle, cls: "text-critical", label: "Error" },
  skipped: { Icon: CircleMinus, cls: "text-faint", label: "No verificado" },
};

/**
 * Diagnóstico de puesta en marcha (público, sin secretos): indica qué falta
 * configurar cuando la aplicación no puede iniciar. Con todo en orden no
 * muestra detalles.
 */
export default async function StatusPage() {
  await connection();
  if (isEmbeddedDemo()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-12">
        <Brand className="mb-10" />
        <h1 className="text-2xl font-semibold text-ink">Demo autónoma activa</h1>
        <p className="mt-2 text-sm text-muted">
          Sin DATABASE_URL la aplicación usa una base de datos embebida con datos de demostración. No requiere configuración.
          Para operar con datos reales, siga docs/DESPLIEGUE.md.
        </p>
        <div className="mt-8"><Link href="/ingresar" className={buttonClass("primary")}>Ir a la demo</Link></div>
      </main>
    );
  }
  const checks = await runChecks();
  const blocking = checks.filter((c) => c.status === "error" || c.status === "skipped");
  const ready = blocking.length === 0;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-5 py-12">
      <Brand className="mb-10" />
      <h1 className="text-2xl font-semibold text-ink">{ready ? "El sistema está listo" : "Configuración pendiente"}</h1>
      <p className="mt-2 text-sm text-muted">
        {ready
          ? "La configuración del servidor, la base de datos y la autenticación funcionan correctamente."
          : "La aplicación todavía no puede funcionar en este servidor. Corrija los puntos marcados en rojo y vuelva a cargar esta página. Después de cambiar variables en Vercel hay que hacer «Redeploy»."}
      </p>

      {ready ? (
        <div className="mt-8">
          <Link href="/ingresar" className={buttonClass("primary")}>Ingresar</Link>
        </div>
      ) : (
        <ol className="mt-8 divide-y divide-line-soft rounded-lg border border-line-soft bg-surface">
          {checks.map((c) => {
            const { Icon, cls, label } = ICON[c.status];
            return (
              <li key={c.key} className="flex gap-3 px-4 py-3.5">
                <Icon className={`mt-0.5 size-5 shrink-0 ${cls}`} aria-label={label} />
                <div className="min-w-0">
                  <p className="font-mono text-[13px] text-ink">{c.label}</p>
                  <p className="mt-0.5 text-[13px] text-muted">{c.detail}</p>
                  {c.fix ? <p className="mt-1 text-[13px] text-ink-2">→ {c.fix}</p> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <p className="mt-6 text-[12px] text-faint">Guía completa: docs/DESPLIEGUE.md en el repositorio. Esta página nunca muestra valores de claves.</p>
    </main>
  );
}
