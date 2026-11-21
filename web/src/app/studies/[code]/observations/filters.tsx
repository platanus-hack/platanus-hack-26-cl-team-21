import Form from "next/form";
import Link from "next/link";
import { formatLocalDay } from "@/lib/format";
import { eventTypeLabel, REVIEW_STATUS_LABELS, VISIBLE_REVIEW_STATUSES } from "@/lib/labels";
import type { FilterOptions, ObservationFilters } from "@/lib/queries/observations";

// Search param names of the observation list.
export const FILTER_PARAMS = { participant: "participant", eventType: "event", reviewStatus: "review", date: "date" } as const;

const selectClass = "min-h-10 rounded-lg border border-hairline bg-paper px-3 text-sm text-ink";

// Plain GET form: filters live in the URL and are applied on the server.
export function ObservationFiltersForm({ action, options, filters }: { action: string; options: FilterOptions; filters: ObservationFilters }) {
  return (
    // Keyed by the active filters so the uncontrolled selects reset after navigating (e.g. "Limpiar").
    <Form key={JSON.stringify(filters)} action={action} className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        Participante
        <select name={FILTER_PARAMS.participant} defaultValue={filters.participant ?? ""} className={selectClass}>
          <option value="">Todos</option>
          {options.participants.map((p) => (
            <option key={p.pseudonym} value={p.pseudonym}>
              {p.pseudonym}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        Tipo de evento
        <select name={FILTER_PARAMS.eventType} defaultValue={filters.eventType ?? ""} className={selectClass}>
          <option value="">Todos</option>
          {options.eventTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {eventTypeLabel(type.key, type.label)}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        Revisión humana
        <select name={FILTER_PARAMS.reviewStatus} defaultValue={filters.reviewStatus ?? ""} className={selectClass}>
          <option value="">Todas</option>
          {VISIBLE_REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {REVIEW_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        Fecha (hora local)
        <select name={FILTER_PARAMS.date} defaultValue={filters.date ?? ""} className={selectClass}>
          <option value="">Todas</option>
          {options.dates.map((date) => (
            <option key={date} value={date}>
              {formatLocalDay(date)} ({date})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="min-h-10 rounded-lg bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary/90">
        Filtrar
      </button>
      <Link href={action} className="inline-flex min-h-10 items-center px-1 text-sm text-ink-muted underline hover:text-ink">
        Limpiar
      </Link>
    </Form>
  );
}
