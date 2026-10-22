import Link from "next/link";
import { BrandMark } from "@/components/ui/Brand";

export default function NotFound() {
  return (
    <main className="grid min-h-[60vh] place-items-center px-4 text-center">
      <div>
        <BrandMark size={44} />
        <h1 className="mt-2 text-lg font-semibold">Registro no encontrado o sin acceso</h1>
        <p className="mt-1 text-sm text-muted">El recurso no existe o su rol no tiene permiso para verlo.</p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent">Volver al centro de control</Link>
      </div>
    </main>
  );
}
