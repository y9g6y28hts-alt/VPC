"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Banknote, Car, ChartColumn, FileSignature, Files, Gauge, Handshake, Landmark, LogOut, Menu, Receipt, Scale, Settings,
  ShieldCheck, Ship, Stamp, Users, Wallet, Wrench, X,
} from "lucide-react";

const ICONS = {
  gauge: Gauge, chart: ChartColumn, car: Car, ship: Ship, wrench: Wrench, users: Users, handshake: Handshake, scale: Scale,
  file: FileSignature, receipt: Receipt, banknote: Banknote, landmark: Landmark, wallet: Wallet, stamp: Stamp, files: Files,
  shield: ShieldCheck, settings: Settings,
};

export interface NavItem { href: string; label: string; icon: keyof typeof ICONS; show: boolean }
export interface NavGroup { label: string; items: NavItem[] }

export function Sidebar({ groups, org, isDemo, user, role, logout }: {
  groups: NavGroup[]; org: string; isDemo: boolean; user: string; role: string; logout: () => Promise<void>;
}) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      <div className="flex items-center justify-between border-b border-line bg-surface px-4 py-2.5 lg:hidden">
        <span className="text-[11px] uppercase tracking-[0.28em] text-accent">Motor Haus</span>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Menú" className="text-text-2">
          {open ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>
      <aside className={`${open ? "block" : "hidden"} border-r border-line bg-surface lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col`}>
        <div className="hidden px-5 pb-4 pt-5 lg:block">
          <div className="text-[11px] uppercase tracking-[0.28em] text-accent">Motor Haus</div>
          <div className="mt-1 truncate text-xs text-muted">{org}{isDemo && " · demo"}</div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4" aria-label="Principal">
          {groups.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.16em] text-faint">{g.label}</div>
              {g.items.map((i) => {
                const Icon = ICONS[i.icon];
                const on = active(i.href);
                return (
                  <Link key={i.href} href={i.href} onClick={() => setOpen(false)} aria-current={on ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-sm px-3 py-1.5 text-[13px] transition-colors ${on ? "bg-raised text-text" : "text-text-2 hover:bg-raised/60 hover:text-text"}`}>
                    <Icon className={`size-4 shrink-0 ${on ? "text-accent" : "text-faint"}`} strokeWidth={1.75} aria-hidden />
                    {i.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line px-4 py-3">
          <div className="truncate text-[13px] text-text">{user}</div>
          <div className="truncate text-xs text-muted">{role}</div>
          <form action={logout} className="mt-2">
            <button type="submit" className="flex items-center gap-1.5 text-xs text-muted hover:text-text"><LogOut className="size-3.5" />Cerrar sesión</button>
          </form>
        </div>
      </aside>
    </>
  );
}
