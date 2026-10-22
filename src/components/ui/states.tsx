import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { cn } from "./cn";

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full border border-line text-faint [&_svg]:size-5">
        {icon ?? <Inbox aria-hidden />}
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-md text-[13px] text-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ title = "No se pudo cargar la información", detail, action }: { title?: string; detail?: string; action?: ReactNode }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-lg border border-critical/30 bg-critical-soft px-6 py-12 text-center">
      <AlertTriangle className="mb-3 size-6 text-critical" aria-hidden />
      <p className="text-sm font-medium text-ink">{title}</p>
      {detail ? <p className="mt-1 max-w-lg text-[13px] text-muted">{detail}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-elevated", className)} />;
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="space-y-6">
      <div className="space-y-2 border-b border-line-soft pb-5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[92px]" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "critical"; children: ReactNode }) {
  const map = {
    info: "border-info/30 bg-info-soft text-ink-2",
    warning: "border-warning/30 bg-warning-soft text-ink-2",
    critical: "border-critical/30 bg-critical-soft text-ink-2",
  };
  return <div className={cn("rounded-md border px-3 py-2.5 text-[13px]", map[tone])}>{children}</div>;
}
