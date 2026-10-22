import type { ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "./cn";

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("scrollbar-thin overflow-x-auto rounded-lg border border-line-soft bg-surface", className)}>
      {children}
    </div>
  );
}

export function Table({ className, ...props }: ComponentProps<"table">) {
  return <table className={cn("w-full border-collapse text-left text-[13px]", className)} {...props} />;
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-[1] bg-surface">
      <tr className="border-b border-line">{children}</tr>
    </thead>
  );
}

export function Th({ className, numeric, ...props }: ComponentProps<"th"> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-9 whitespace-nowrap px-3 text-[11.5px] font-semibold uppercase tracking-wide text-faint",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

/** Encabezado ordenable mediante parámetros de URL (?orden=campo&dir=asc). */
export function SortTh({
  label,
  field,
  current,
  dir,
  hrefFor,
  numeric,
  className,
}: {
  label: string;
  field: string;
  current?: string;
  dir?: "asc" | "desc";
  hrefFor: (field: string, dir: "asc" | "desc") => string;
  numeric?: boolean;
  className?: string;
}) {
  const active = current === field;
  const nextDir = active && dir === "desc" ? "asc" : "desc";
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <Th numeric={numeric} className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link
        href={hrefFor(field, nextDir)}
        scroll={false}
        className={cn("inline-flex items-center gap-1 hover:text-ink-2", active && "text-ink-2", numeric && "flex-row-reverse")}
      >
        {label}
        <Icon className="size-3" aria-hidden />
      </Link>
    </Th>
  );
}

export function Tr({ className, href, ...props }: ComponentProps<"tr"> & { href?: string }) {
  return (
    <tr
      className={cn("border-b border-line-soft last:border-0 hover:bg-elevated/60", href && "cursor-pointer", className)}
      {...props}
    />
  );
}

export function Td({ className, numeric, muted, ...props }: ComponentProps<"td"> & { numeric?: boolean; muted?: boolean }) {
  return (
    <td
      className={cn(
        "h-11 px-3 align-middle text-ink-2",
        numeric && "num whitespace-nowrap text-right",
        muted && "text-faint",
        className,
      )}
      {...props}
    />
  );
}

/** Fila de totales al pie de una tabla. */
export function TFootRow({ children }: { children: ReactNode }) {
  return (
    <tfoot>
      <tr className="border-t border-line bg-elevated/40 font-semibold text-ink">{children}</tr>
    </tfoot>
  );
}
