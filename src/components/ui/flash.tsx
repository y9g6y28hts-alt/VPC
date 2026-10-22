"use client";

import { useEffect, useRef } from "react";
import { toast } from "./toast";

/** Muestra una vez el mensaje flash recibido del servidor y borra la cookie. */
export function Flash({ value }: { value: string | null }) {
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!value) return;
    try {
      const { id, m } = JSON.parse(value) as { id: string; m: string };
      if (shown.current === id) return;
      shown.current = id;
      toast.success(m);
    } catch {
      // cookie malformada: se descarta
    }
    document.cookie = "ds_flash=; Max-Age=0; path=/; SameSite=Lax";
  }, [value]);
  return null;
}
