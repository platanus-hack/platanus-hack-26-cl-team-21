// "Anatomía de un sistema" details from web/design/GUIDELINES.md: key figures laid out like a
// labeled specimen, and corner ticks around the one framed block of a page.

export function Specimen({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs font-medium tracking-wider text-ink-muted uppercase">{label}</dt>
      <dd className="font-serif text-3xl text-ink tabular-nums">{value}</dd>
      <dd className="text-sm text-ink-muted">{unit}</dd>
    </div>
  );
}

export function CornerTicks() {
  const tick = "pointer-events-none absolute size-3 border-ink";
  return (
    <>
      <span aria-hidden className={`${tick} -top-px -left-px border-t-2 border-l-2`} />
      <span aria-hidden className={`${tick} -top-px -right-px border-t-2 border-r-2`} />
      <span aria-hidden className={`${tick} -bottom-px -left-px border-b-2 border-l-2`} />
      <span aria-hidden className={`${tick} -right-px -bottom-px border-r-2 border-b-2`} />
    </>
  );
}
