"use client";

import { ErrorState } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ErrorState
      title="No se pudo cargar esta pantalla"
      detail={
        error.message?.includes("DATABASE_URL") || error.message?.includes("variables de entorno")
          ? error.message
          : `Intente nuevamente. Si el problema persiste, informe el código ${error.digest ?? "sin código"} al administrador técnico.`
      }
      action={
        <button type="button" onClick={() => retry()} className={buttonClass("secondary")}>
          Reintentar
        </button>
      }
    />
  );
}
