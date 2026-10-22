import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Brand } from "@/components/shell/brand";
import { buttonClass } from "@/components/ui/button";
import { signOut } from "@/server/auth/actions";

export const metadata = { title: "Sin acceso" };

export default async function NoAccess({ searchParams }: { searchParams: Promise<{ permiso?: string; motivo?: string }> }) {
  const { permiso, motivo } = await searchParams;
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Brand className="mb-10" />
      <ShieldCheck className="mb-4 size-8 text-faint" aria-hidden />
      <h1 className="text-xl font-semibold text-ink">
        {motivo === "sin-organizacion" ? "Su usuario no tiene una organización asignada" : "No tiene acceso a esta sección"}
      </h1>
      <p className="mt-2 max-w-md text-sm text-muted">
        {motivo === "sin-organizacion"
          ? "Pida al administrador técnico que le asigne un rol en la organización."
          : "Su rol no incluye el permiso necesario. Si lo necesita para su trabajo, solicítelo a la dirección."}
      </p>
      {permiso ? <p className="mt-3 font-mono text-[12px] text-faint">Permiso requerido: {permiso}</p> : null}
      <div className="mt-8 flex gap-2">
        <Link href="/" className={buttonClass("secondary")}>
          Volver al inicio
        </Link>
        <form action={signOut}>
          <button type="submit" className={buttonClass("ghost")}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </main>
  );
}
