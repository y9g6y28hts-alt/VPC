"use client";

import { useEffect } from "react";
import { OctagonAlert } from "lucide-react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-lg rounded-md border border-risk/40 bg-surface p-6">
      <div className="flex items-center gap-2 text-risk"><OctagonAlert className="size-5" /><h1 className="text-base font-semibold">No se pudo cargar esta vista</h1></div>
      <p className="mt-2 text-sm text-text-2">{error.message || "Error inesperado."} Ningún dato fue modificado.</p>
      {error.digest && <p className="mt-1 text-xs text-faint">Referencia: {error.digest}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={reset} className="h-8 rounded-sm bg-accent px-3 text-[13px] font-medium text-ink">Reintentar</button>
        <a href="/" className="h-8 rounded-sm border border-line px-3 text-[13px] leading-8 text-text">Ir al centro de control</a>
      </div>
    </div>
  );
}
