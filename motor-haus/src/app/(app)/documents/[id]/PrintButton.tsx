"use client";

export function PrintButton({ className, children }: { className: string; children: React.ReactNode }) {
  return <button type="button" className={className} onClick={() => window.print()}>{children}</button>;
}
