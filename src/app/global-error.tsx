"use client";

/**
 * Último recurso cuando falla el layout raíz. No hereda estilos globales:
 * se usan estilos en línea con la paleta de la aplicación.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && "digest" in error ? String((error as Error & { digest?: string }).digest ?? "") : "";
  return (
    <html lang="es-PY">
      <body style={{ margin: 0, minHeight: "100dvh", background: "#101113", color: "#F5F5F2", fontFamily: "system-ui, sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <title>Error · Da Silva OS</title>
        <main style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>No se pudo cargar Da Silva OS</h1>
          <p style={{ color: "#A5A8AE", fontSize: 14, lineHeight: 1.5, margin: 0 }}>
            Si es la primera puesta en marcha, revise la configuración del servidor en la página de estado.
            {digest ? ` Código: ${digest}.` : ""}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
            <a href="/estado" style={{ background: "#C8102E", color: "#fff", padding: "9px 16px", borderRadius: 6, textDecoration: "none", fontSize: 14 }}>Ver estado del sistema</a>
            <button type="button" onClick={() => retry()} style={{ background: "#22252A", color: "#F5F5F2", border: "1px solid #34383E", padding: "9px 16px", borderRadius: 6, fontSize: 14, cursor: "pointer" }}>Reintentar</button>
          </div>
        </main>
      </body>
    </html>
  );
}
