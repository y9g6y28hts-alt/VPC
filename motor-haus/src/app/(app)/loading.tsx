export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
      <div className="h-6 w-64 rounded-sm bg-raised" />
      <div className="h-4 w-96 rounded-sm bg-raised/60" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 rounded-md bg-surface" />)}</div>
      <div className="h-80 rounded-md bg-surface" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
