import { ArrowRight } from "lucide-react";
import { ROLE_LABELS, isRole } from "@/domain/permissions";
import { demoSignIn } from "@/server/auth/actions";
import { getSql } from "@/server/db/client";

const ROLE_HINT: Record<string, string> = {
  director: "Ve todo: tablero, aprobaciones, márgenes",
  administracion: "Formaliza ventas, confirma pagos",
  gerencia_comercial: "Precios, descuentos, equipo comercial",
  vendedor: "Sus clientes y operaciones, sin costes",
  cobranzas: "Cartera, mora y gestiones",
  inventario: "Unidades, costes y documentación",
  finanzas: "Caja, conciliación, proveedores",
  auditor: "Sólo lectura y auditoría",
  admin_tecnico: "Usuarios y configuración",
};

/** Ingreso de la demo autónoma: se elige un usuario de demostración, sin contraseña. */
export async function DemoLogin() {
  const sql = await getSql();
  const users = await sql<{ id: string; email: string; full_name: string; role: string }[]>`
    select u.id, u.email, p.full_name, m.role
    from auth.users u join public.user_profiles p on p.id = u.id
    join public.memberships m on m.user_id = u.id and m.is_active
    join public.organizations o on o.id = m.org_id and o.is_demo
    order by (select sort_order from public.roles r where r.key = m.role), p.full_name`;
  return (
    <div className="mt-6">
      <p className="mb-3 text-[13px] text-muted">Elija con qué rol quiere recorrer la demo:</p>
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id}>
            <form action={demoSignIn}>
              <input type="hidden" name="userId" value={u.id} />
              <button type="submit" data-email={u.email} className="group flex w-full items-center gap-3 rounded-lg border border-line-soft bg-surface px-3.5 py-2.5 text-left hover:border-line hover:bg-elevated">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-medium text-ink">{isRole(u.role) ? ROLE_LABELS[u.role] : u.role}</span>
                  <span className="block truncate text-[12px] text-faint">{u.full_name} · {ROLE_HINT[u.role] ?? ""}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-faint group-hover:text-ink" aria-hidden />
              </button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
