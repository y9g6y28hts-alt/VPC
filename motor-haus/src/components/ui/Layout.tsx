import Link from "next/link";

export function PageHeader({ title, subtitle, actions, crumbs }: {
  title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; crumbs?: Array<[string, string]>;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {crumbs && (
          <nav aria-label="Ruta" className="mb-1 flex flex-wrap items-center gap-1 text-xs text-muted">
            {crumbs.map(([href, label], i) => (
              <span key={href} className="flex items-center gap-1">
                {i > 0 && <span className="text-faint">/</span>}
                <Link href={href} className="hover:text-text">{label}</Link>
              </span>
            ))}
          </nav>
        )}
        <h1 className="truncate text-lg font-semibold tracking-tight text-text">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({ title, subtitle, actions, children, className = "", bodyClass = "", id }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode;
  className?: string; bodyClass?: string; id?: string;
}) {
  return (
    <section id={id} className={`rounded-md border border-line bg-surface ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line-soft px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-semibold tracking-tight text-text">{title}</h2>}
            {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={`min-w-0 overflow-x-auto ${bodyClass}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      <p className="text-sm text-text-2">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** Lista de pares etiqueta/valor para fichas y expedientes. */
export function Facts({ items, cols = 2 }: { items: Array<[React.ReactNode, React.ReactNode]>; cols?: 1 | 2 | 3 | 4 }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-2.5 ${grid}`}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wider text-faint">{k}</dt>
          <dd className="mt-0.5 truncate text-sm text-text">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Cifra con etiqueta, nota y procedencia. */
export function Figure({ label, value, note, basis, tone, href }: {
  label: React.ReactNode; value: React.ReactNode; note?: React.ReactNode; basis?: React.ReactNode; tone?: "risk" | "warn" | "good"; href?: string;
}) {
  const color = tone === "risk" ? "text-risk" : tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-text";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted">{label}</span>
        {basis}
      </div>
      <div className={`num mt-1 text-[19px] font-semibold tracking-tight ${color}`}>{value}</div>
      {note && <div className="mt-0.5 text-xs text-muted">{note}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block px-4 py-3 transition-colors hover:bg-raised">{body}</Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

export function Tabs({ tabs, current }: { tabs: Array<{ href: string; label: string; key: string; count?: number }>; current: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line" aria-label="Secciones">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${t.key === current ? "border-accent text-text" : "border-transparent text-muted hover:text-text"}`}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 text-xs text-faint">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
