import Link from "next/link";
import { EmptyState } from "@/components/ui/states";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <EmptyState
      title="No encontramos lo que busca"
      description="El registro no existe o no tiene permiso para verlo."
      action={<Link href="/" className={buttonClass("secondary")}>Volver al inicio</Link>}
    />
  );
}
