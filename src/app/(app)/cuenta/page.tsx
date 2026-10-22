import type { Metadata } from "next";
import { PasswordForm } from "@/components/settings/settings-forms";
import { PageHeader } from "@/components/ui/page-header";
import { DescriptionList, Panel } from "@/components/ui/panel";
import { ROLE_LABELS } from "@/domain/permissions";
import { requireContext } from "@/server/auth/context";

export const metadata: Metadata = { title: "Mi cuenta" };

export default async function AccountPage() {
  const ctx = await requireContext();
  return (
    <>
      <PageHeader title="Mi cuenta" />
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Datos de acceso">
          <DescriptionList cols={1} items={[
            { label: "Nombre", value: ctx.fullName },
            { label: "Correo", value: ctx.email ?? "—" },
            { label: "Organización", value: ctx.org.name },
            { label: "Rol", value: ROLE_LABELS[ctx.org.role], hint: "Los permisos los asigna un usuario con gestión de usuarios." },
          ]} />
        </Panel>
        <Panel title="Cambiar contraseña">
          <PasswordForm />
        </Panel>
      </div>
    </>
  );
}
