import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

/** Rutas inexistentes fuera de la aplicación autenticada. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-carbon px-4">
      <EmptyState
        title="Página no encontrada"
        description="La dirección no corresponde a ninguna sección de Da Silva OS."
        action={<Link href="/" className={buttonClass("secondary")}>Ir al inicio</Link>}
      />
    </main>
  );
}
