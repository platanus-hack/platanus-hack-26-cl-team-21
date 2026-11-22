import Form from "next/form";
import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { formatLocalDay } from "@/lib/format";
import { eventTypeLabel, REVIEW_STATUS_LABELS, VISIBLE_REVIEW_STATUSES } from "@/lib/labels";
import { FIELD, FIELD_LABEL } from "@/lib/ui";
import type { FilterOptions, ObservationFilters } from "@/lib/queries/observations";

// Search param names of the observation list.
export const FILTER_PARAMS = { participant: "participant", eventType: "event", reviewStatus: "review", date: "date" } as const;

/** The list is paginated: `page` is 1-based and `size` is one of PAGE_SIZES (default DEFAULT_PAGE_SIZE). */
export const PAGE_PARAM = "page";
export const SIZE_PARAM = "size";
export const PAGE_SIZES = [10, 25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

// Plain GET form: filters live in the URL and are applied on the server.
export function ObservationFiltersForm({
  action,
  options,
  filters,
  pageSize,
}: {
  action: string;
  options: FilterOptions;
  filters: ObservationFilters;
  pageSize: number;
}) {
  return (
    // Keyed by the active filters so the uncontrolled selects reset after navigating (e.g. "Limpiar").
    <Form key={JSON.stringify(filters)} action={action} className="flex flex-wrap items-end gap-3">
      {/* Keeps the chosen page size when the filters change (no `page`: lands on page 1). */}
      {pageSize !== DEFAULT_PAGE_SIZE && <input type="hidden" name={SIZE_PARAM} value={pageSize} />}
      <label className={FIELD_LABEL}>
        Participante
        <select name={FILTER_PARAMS.participant} defaultValue={filters.participant ?? ""} className={FIELD}>
          <option value="">Todos</option>
          {options.participants.map((p) => (
            <option key={p.pseudonym} value={p.pseudonym}>
              {p.pseudonym}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD_LABEL}>
        Tipo de evento
        <select name={FILTER_PARAMS.eventType} defaultValue={filters.eventType ?? ""} className={FIELD}>
          <option value="">Todos</option>
          {options.eventTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {eventTypeLabel(type.key, type.label)}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD_LABEL}>
        Revisión humana
        <select name={FILTER_PARAMS.reviewStatus} defaultValue={filters.reviewStatus ?? ""} className={FIELD}>
          <option value="">Todas</option>
          {VISIBLE_REVIEW_STATUSES.map((status) => (
            <option key={status} value={status}>
              {REVIEW_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>
      <label className={FIELD_LABEL}>
        Fecha (hora local)
        <select name={FILTER_PARAMS.date} defaultValue={filters.date ?? ""} className={FIELD}>
          <option value="">Todas</option>
          {options.dates.map((date) => (
            <option key={date} value={date}>
              {formatLocalDay(date)} ({date})
            </option>
          ))}
        </select>
      </label>
      <SubmitButton idle="Filtrar" busy="Filtrando…" />
      <Link href={action} className="inline-flex min-h-10 items-center px-1 text-sm text-ink-muted underline underline-offset-2 hover:text-ink">
        Limpiar
      </Link>
    </Form>
  );
}
