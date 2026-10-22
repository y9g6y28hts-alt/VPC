import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const control =
  "w-full rounded-md border border-line bg-surface px-3 text-sm text-ink placeholder:text-faint " +
  "transition-colors hover:border-faint focus:border-ink-2 focus:outline-none disabled:opacity-60 " +
  "aria-[invalid=true]:border-critical";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  error?: string | string[] | null;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const message = Array.isArray(error) ? error[0] : error;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-ink-2">
        {label}
        {required ? <span className="ml-0.5 text-brand">*</span> : null}
      </label>
      {children}
      {message ? (
        <p role="alert" className="text-[12px] text-critical">
          {message}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-9", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select className={cn(control, "h-9 appearance-none bg-[length:12px] bg-[right_10px_center] bg-no-repeat pr-8", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a5a8ae' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Checkbox({ label, className, ...props }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2 text-sm text-ink-2", className)}>
      <input type="checkbox" className="size-4 rounded-sm border-line bg-surface accent-[var(--color-brand)]" {...props} />
      {label}
    </label>
  );
}

export function FormGrid({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const map = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" };
  return <div className={cn("grid grid-cols-1 gap-4", map[cols], className)}>{children}</div>;
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-md border border-critical/40 bg-critical-soft px-3 py-2.5 text-sm text-critical">
      {message}
    </div>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="status" className="rounded-md border border-positive/40 bg-positive-soft px-3 py-2.5 text-sm text-positive">
      {message}
    </div>
  );
}
