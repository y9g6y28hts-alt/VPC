"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  ArrowLeftRight, Calculator, CarFront, ChartColumn, HandCoins, Handshake, Landmark, LayoutDashboard, Menu,
  Receipt, Settings, ShieldCheck, Stamp, Truck, Users, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui/cn";
import { GROUP_LABELS, type NavItem } from "./nav";

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, Stamp, CarFront, Handshake, Users, ArrowLeftRight, Calculator, HandCoins, Truck, Receipt,
  Landmark, ChartColumn, ShieldCheck, Settings,
};

export function Sidebar({
  items,
  badges,
  brand,
  footer,
}: {
  items: NavItem[];
  badges: Record<string, number>;
  brand: ReactNode;
  footer: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // Cierra el menú móvil al navegar (estado derivado de la ruta, sin efecto).
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  const groups = (Object.keys(GROUP_LABELS) as NavItem["group"][])
    .map((g) => ({ g, list: items.filter((i) => i.group === g) }))
    .filter((x) => x.list.length);

  const nav = (
    <nav aria-label="Módulos" className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
      {groups.map(({ g, list }) => (
        <div key={g} className="mb-4">
          <p className="mb-1 px-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">{GROUP_LABELS[g]}</p>
          <ul className="space-y-0.5">
            {list.map((item) => {
              const Icon = ICONS[item.icon] ?? LayoutDashboard;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const badge = badges[item.key];
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] transition-colors",
                      active ? "bg-elevated text-ink" : "text-muted hover:bg-elevated/60 hover:text-ink-2",
                    )}
                  >
                    {active ? <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-r bg-brand" /> : null}
                    <Icon className={cn("size-[17px] shrink-0", active ? "text-ink" : "text-faint group-hover:text-muted")} aria-hidden />
                    <span className="truncate">{item.label}</span>
                    {badge ? (
                      <span className="num ml-auto rounded-sm bg-brand px-1.5 py-px text-[11px] font-semibold text-brand-ink">{badge}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* Barra superior móvil */}
      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line-soft bg-carbon/95 px-4 backdrop-blur lg:hidden">
        {brand}
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          aria-expanded={open}
          className="rounded-md p-2 text-muted hover:bg-elevated hover:text-ink"
        >
          <Menu className="size-5" />
        </button>
      </div>

      {/* Escritorio */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line-soft bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">{brand}</div>
        {nav}
        <div className="border-t border-line-soft p-2.5">{footer}</div>
      </aside>

      {/* Móvil: panel */}
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menú">
          <button type="button" aria-label="Cerrar menú" className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <aside className="relative flex h-full w-[84vw] max-w-[300px] flex-col border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between px-4">
              {brand}
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded-md p-2 text-muted hover:text-ink">
                <X className="size-5" />
              </button>
            </div>
            {nav}
            <div className="border-t border-line-soft p-2.5">{footer}</div>
          </aside>
        </div>
      ) : null}
    </>
  );
}
