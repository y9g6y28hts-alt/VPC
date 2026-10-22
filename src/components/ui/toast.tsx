"use client";

import { useSyncExternalStore } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";
import { cn } from "./cn";

type ToastItem = { id: number; tone: "success" | "error"; message: string };

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastItem["tone"], message: string) {
  const id = ++seq;
  items = [...items, { id, tone, message }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4000);
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

export const toast = {
  success: (m: string) => push("success", m),
  error: (m: string) => push("error", m),
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-elevated px-3.5 py-3 text-[13px] text-ink shadow-[var(--shadow-pop)]",
            t.tone === "success" ? "border-positive/40" : "border-critical/40",
          )}
        >
          {t.tone === "success" ? (
            <CheckCircle2 className="mt-px size-4 shrink-0 text-positive" aria-hidden />
          ) : (
            <AlertTriangle className="mt-px size-4 shrink-0 text-critical" aria-hidden />
          )}
          <p className="flex-1">{t.message}</p>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Cerrar" className="text-faint hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
