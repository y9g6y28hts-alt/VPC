import Link from "next/link";
import { LogOut } from "lucide-react";
import { ROLE_LABELS } from "@/domain/permissions";
import type { AppContext } from "@/server/auth/context";
import { signOut, switchOrg } from "@/server/auth/actions";

export function UserMenu({ ctx }: { ctx: AppContext }) {
  return (
    <div className="space-y-2">
      {ctx.orgs.length > 1 ? (
        <form action={switchOrg} className="px-1">
          <label htmlFor="org-switch" className="sr-only">
            Organización
          </label>
          <select
            id="org-switch"
            name="orgId"
            defaultValue={ctx.org.id}
            className="h-8 w-full rounded-md border border-line bg-carbon px-2 text-[12.5px] text-ink-2"
          >
            {ctx.orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
                {o.isDemo ? " (demostración)" : ""}
              </option>
            ))}
          </select>
          <button type="submit" className="mt-1 w-full rounded-md py-1 text-[12px] text-muted hover:bg-elevated hover:text-ink">
            Cambiar organización
          </button>
        </form>
      ) : null}
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <div aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-elevated text-[12px] font-semibold text-ink-2">
          {ctx.fullName
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0])
            .join("")
            .toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <Link href="/cuenta" className="block truncate text-[13px] font-medium text-ink hover:underline" title="Mi cuenta">{ctx.fullName}</Link>
          <p className="truncate text-[11.5px] text-faint">{ROLE_LABELS[ctx.org.role]}</p>
        </div>
        <form action={signOut}>
          <button type="submit" aria-label="Cerrar sesión" title="Cerrar sesión" className="rounded-md p-1.5 text-faint hover:bg-elevated hover:text-ink">
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
