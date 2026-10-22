import { cookies } from "next/headers";
import { Brand } from "@/components/shell/brand";
import { Flash } from "@/components/ui/flash";
import { NAV } from "@/components/shell/nav";
import { Sidebar } from "@/components/shell/sidebar";
import { UserMenu } from "@/components/shell/user-menu";
import { requireContext } from "@/server/auth/context";
import { isEmbeddedDemo } from "@/server/db/client";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const items = NAV.filter((i) => ctx.perms.any(...i.anyOf));

  const [pending] = await ctx.db(
    (tx) => tx<{ c: number }[]>`
      select count(*)::int as c from public.approvals
      where org_id = ${ctx.org.id} and status = 'pendiente'
        and app.has_perm(org_id, app.approval_permission(kind))
        and (requested_by <> ${ctx.userId} or ${ctx.org.role} = 'director')`,
  );

  const flashValue = (await cookies()).get("ds_flash")?.value ?? null;

  return (
    <div className="lg:flex">
      <Flash value={flashValue} />
      <Sidebar
        items={items}
        badges={{ aprobaciones: pending?.c ?? 0 }}
        brand={<Brand />}
        footer={<UserMenu ctx={ctx} />}
      />
      <div className="min-w-0 flex-1">
        {ctx.org.isDemo ? (
          <div role="note" className="sticky top-14 z-20 border-b border-brand/40 bg-[#2a1216] px-4 py-2 text-center text-[12.5px] text-ink-2 lg:top-0">
            <strong className="font-semibold text-ink">DATOS DE DEMOSTRACIÓN.</strong> Esta organización contiene datos ficticios
            aislados de las operaciones reales. No los utilice para decisiones.
            {isEmbeddedDemo() ? " Los cambios vuelven al estado inicial cuando el servidor se reinicia." : null}
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
