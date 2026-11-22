import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ReadingGuide } from "@/components/reading-guide";
import { Loading, SkeletonBar, SkeletonTable } from "@/components/skeleton";
import { NUM, TableFrame, TBody, TD, TH, TH_ROW, TR } from "@/components/data-table";
import { formatConfidence, formatDuration, formatLocalDay, formatNumber, plural, spansYears } from "@/lib/format";
import {
  eventTypeLabel,
  formatAttributes,
  label,
  REVIEW_STATUS_BADGE_CLASS,
  REVIEW_STATUS_LABELS,
  VISIBLE_REVIEW_STATUSES,
} from "@/lib/labels";
import {
  type FilterOptions,
  getCoverageSummary,
  getObservationFilterOptions,
  listObservations,
  type ObservationFilters,
  type ObservationRow,
} from "@/lib/queries/observations";
import { getStudyByCode } from "@/lib/queries/studies";
import { LINK } from "@/lib/ui";
import { CoverageNote } from "./coverage-note";
import { DEFAULT_PAGE_SIZE, FILTER_PARAMS, ObservationFiltersForm, PAGE_PARAM, PAGE_SIZES, SIZE_PARAM } from "./filters";
import { PageSizeForm } from "./page-size-form";

type Props = PageProps<"/studies/[code]/observations">;
type SearchParams = Awaited<Props["searchParams"]>;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Observaciones · ${code}` };
}

// An inline boundary, not loading.tsx: a route loading.tsx re-shows its skeleton whenever the search
// params change, which would hide "Filtrando…". During
// a router transition this boundary keeps the current list on screen until the new one is ready.
export default function ObservationsPage(props: Props) {
  return (
    <Suspense
      fallback={
        <Loading label="Cargando observaciones…">
          <div className="flex flex-wrap items-end gap-3">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBar key={i} className="h-16 w-40" />
            ))}
          </div>
          <SkeletonBar className="h-24 w-full" />
          <SkeletonTable rows={8} />
        </Loading>
      }
    >
      <ObservationsContent {...props} />
    </Suspense>
  );
}

async function ObservationsContent({ params, searchParams }: Props) {
  await connection();
  const [{ code }, query] = await Promise.all([params, searchParams]);
  const study = await getStudyByCode(code);
  if (!study) notFound();

  const options = await getObservationFilterOptions(study.id);
  const filters = parseFilters(query, options);
  const pageNumber = parsePage(query);
  const pageSize = parsePageSize(query);
  const [result, coverage] = await Promise.all([
    listObservations(study.id, filters, pageSize, (pageNumber - 1) * pageSize),
    getCoverageSummary(study.id, filters),
  ]);
  const { rows, total, counted } = result;
  const basePath = `/studies/${encodeURIComponent(study.code)}`;
  const listPath = `${basePath}/observations`;
  // A stale or hand-edited page past the end: go back to the first page.
  if (rows.length === 0 && pageNumber > 1) redirect(listPath + pageQuery(filters, pageSize, 1));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const timezones = new Set(rows.map((row) => row.timezone));
  const sharedTimezone = timezones.size === 1 ? [...timezones][0] : null;

  return (
    <div className="flex flex-col gap-6">
      <ObservationFiltersForm action={listPath} options={options} filters={filters} pageSize={pageSize} />
      <CoverageNote coverage={coverage} scope={describeScope(filters, coverage.participantCount)} />
      <ReadingGuide />
      {/* Never a count of 0 for a scope with no observed time: nothing could have been detected there. */}
      {(total > 0 || coverage.observedSeconds > 0) && (
        <p className="text-sm text-ink-muted">
          {[
            coverage.observedSeconds > 0 || counted > 0 ? `${plural(counted, "observación", "observaciones")} en tiempo observado` : null,
            counted < total
              ? plural(total - counted, "fuera del tiempo observado (no entra en los conteos)", "fuera del tiempo observado (no entran en los conteos)")
              : null,
          ]
            .filter(Boolean)
            .join(" y ")}
          , ordenadas por hora de inicio. Hora local {sharedTimezone ? `(${sharedTimezone})` : "de cada participante"}.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-ink-muted">
          {coverage.observedSeconds === 0
            ? "No hay observaciones actuales para estos filtros. Revisa la cobertura: sin tiempo observado no se pueden detectar episodios."
            : filters.eventType
              ? // Coverage doesn't depend on the event type: some of that observed time may come from
                // participants whose protocol doesn't measure this type, so no duration is claimed.
                "Ninguna observación coincide con el tipo de evento elegido. El tiempo observado de arriba puede incluir participantes cuyo protocolo no mide este tipo."
              : filters.reviewStatus
                ? // A review filter can empty the list on its own: don't read that as nothing detected.
                  `Ninguna observación tiene el estado de revisión elegido en ${formatDuration(coverage.observedSeconds)} de tiempo observado.`
                : `Sin episodios detectados en ${formatDuration(coverage.observedSeconds)} de tiempo observado.`}
        </p>
      ) : (
        <>
          <ObservationTable rows={rows} basePath={basePath} showTimezone={!sharedTimezone} />
          {total > PAGE_SIZES[0] && (
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <nav aria-label="Paginación" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-muted">
                <span className="tabular-nums">
                  Mostrando {formatNumber((pageNumber - 1) * pageSize + 1, 0)}–{formatNumber((pageNumber - 1) * pageSize + rows.length, 0)} de{" "}
                  {formatNumber(total, 0)}.
                </span>
                {pageCount > 1 && (
                  <ul className="flex flex-wrap items-center gap-1">
                    <li>
                      {pageNumber > 1 ? (
                        <Link href={listPath + pageQuery(filters, pageSize, pageNumber - 1)} className={`${LINK} ${PAGE_ITEM}`} rel="prev" aria-label="Página anterior">
                          ←
                        </Link>
                      ) : (
                        <span className={`${PAGE_ITEM} opacity-40`} aria-hidden>
                          ←
                        </span>
                      )}
                    </li>
                    {pageWindow(pageNumber, pageCount).map((item, i) => (
                      <li key={`${item}-${i}`}>
                        {item === "gap" ? (
                          <span className={PAGE_ITEM} aria-hidden>
                            …
                          </span>
                        ) : item === pageNumber ? (
                          <span aria-current="page" className={`${PAGE_ITEM} bg-primary font-medium text-white`}>
                            {item}
                          </span>
                        ) : (
                          <Link href={listPath + pageQuery(filters, pageSize, item)} className={`${LINK} ${PAGE_ITEM}`} aria-label={`Página ${item}`}>
                            {item}
                          </Link>
                        )}
                      </li>
                    ))}
                    <li>
                      {pageNumber < pageCount ? (
                        <Link href={listPath + pageQuery(filters, pageSize, pageNumber + 1)} className={`${LINK} ${PAGE_ITEM}`} rel="next" aria-label="Página siguiente">
                          →
                        </Link>
                      ) : (
                        <span className={`${PAGE_ITEM} opacity-40`} aria-hidden>
                          →
                        </span>
                      )}
                    </li>
                  </ul>
                )}
              </nav>
              <PageSizeForm
                key={pageSize}
                action={listPath}
                size={pageSize}
                sizes={PAGE_SIZES}
                hidden={[...new URLSearchParams(pageQuery(filters, pageSize, 1)).entries()].filter(([name]) => name !== SIZE_PARAM)}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ObservationTable({ rows, basePath, showTimezone }: { rows: ObservationRow[]; basePath: string; showTimezone: boolean }) {
  const withYear = spansYears(rows.flatMap((row) => [row.local_date, row.local_end_date]));
  // Provenance stays on every row's export; on screen it is stated once when every row shares it.
  const runs = new Set(rows.map((row) => `Modelo ${row.model_version} · pipeline ${row.pipeline_version} · protocolo ${row.protocol_version}`));
  const sharedRun = runs.size === 1 ? [...runs][0] : null;

  return (
    <div className="flex flex-col gap-2">
      {sharedRun && <p className="text-sm text-ink-muted">Ejecución de las filas mostradas: {sharedRun}</p>}
      <TableFrame caption="Observaciones filtradas" paged>
        <thead className="text-ink-muted">
          <tr>
            <th scope="col" className={`${TH} left-0 z-20`}>Participante</th>
            <th scope="col" className={TH}>Fecha</th>
            <th scope="col" className={TH}>Horario</th>
            <th scope="col" className={`${TH} ${NUM}`}>Duración</th>
            <th scope="col" className={TH}>Tipo de evento</th>
            <th scope="col" className={TH}>Atributos</th>
            <th scope="col" className={`${TH} ${NUM}`}>
              Confianza del modelo
              <span className="block font-normal">0 a 1, no calibrada</span>
            </th>
            <th scope="col" className={TH}>Revisión humana</th>
            {!sharedRun && <th scope="col" className={TH}>Ejecución</th>}
          </tr>
        </thead>
        <TBody>
          {rows.map((row) => (
            <tr key={row.id} className={`${TR} hover:bg-paper-deep`}>
              <th scope="row" className={TH_ROW}>
                <Link
                  href={`${basePath}/participants/${encodeURIComponent(row.pseudonym)}`}
                  className={`${LINK} font-medium [overflow-wrap:anywhere]`}
                >
                  {row.pseudonym}
                </Link>
                {showTimezone && <span className="block text-xs text-ink-muted">{row.timezone}</span>}
              </th>
              <td className={`${TD} tabular-nums whitespace-nowrap`}>
                <time dateTime={row.local_date}>{formatLocalDay(row.local_date, "short", withYear)}</time>
              </td>
              <td className={`${TD} tabular-nums whitespace-nowrap`}>
                {/* The evidence behind the observation: clip, source hash, offsets and review. */}
                <Link href={`${basePath}/observations/${row.id}`} className={LINK} aria-label={`Ver evidencia de ${row.pseudonym}, ${row.local_start} a ${row.local_end}`}>
                  {row.local_start}–{row.local_end}
                </Link>
                {row.local_end_date !== row.local_date && (
                  <span className="text-ink-muted"> ({formatLocalDay(row.local_end_date, "short", withYear)})</span>
                )}
              </td>
              <td className={`${TD} ${NUM} whitespace-nowrap`}>{formatDuration(row.duration_s)}</td>
              <td className={TD}>
                {eventTypeLabel(row.event_type_key, row.event_type_label)}
                {!row.in_observed_time && (
                  <span className="mt-1 inline-block rounded-full bg-warning px-2 py-0.5 text-xs font-medium text-ink">Fuera del tiempo observado</span>
                )}
              </td>
              <td className={TD}>
                {/* Model output can be long: clamp here, the participant page shows it in full. */}
                <dl className="grid max-w-xs grid-cols-[auto_1fr] gap-x-2">
                  {formatAttributes(row.attributes).map((item) => (
                    <div key={item.key} className="contents">
                      <dt className="text-ink-muted">{item.label}</dt>
                      <dd className="line-clamp-3 [overflow-wrap:anywhere]">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </td>
              <td className={`${TD} ${NUM}`}>{formatConfidence(row.confidence)}</td>
              <td className={TD}>
                <ReviewBadge status={row.human_review_status} />
              </td>
              {!sharedRun && (
                <td className={`${TD} text-ink-muted`}>
                  <span className="block whitespace-nowrap">Modelo {row.model_version}</span>
                  <span className="block whitespace-nowrap">Pipeline {row.pipeline_version}</span>
                  <span className="block whitespace-nowrap">Protocolo {row.protocol_version}</span>
                </td>
              )}
            </tr>
          ))}
        </TBody>
      </TableFrame>
    </div>
  );
}

function ReviewBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${REVIEW_STATUS_BADGE_CLASS[status] ?? REVIEW_STATUS_BADGE_CLASS.pending}`}>
      {label(REVIEW_STATUS_LABELS, status)}
    </span>
  );
}

function first(value: string | string[] | undefined) {
  const v = Array.isArray(value) ? value[0] : value;
  return v ? v : undefined;
}

// Only values offered in the form are applied; anything else is ignored (treated as "all"), so the
// list always matches what the form shows and nothing unchecked reaches the queries.
function parseFilters(query: SearchParams, options: FilterOptions): ObservationFilters {
  const participant = first(query[FILTER_PARAMS.participant]);
  const eventType = first(query[FILTER_PARAMS.eventType]);
  const reviewStatus = first(query[FILTER_PARAMS.reviewStatus]);
  const date = first(query[FILTER_PARAMS.date]);
  return {
    participant: options.participants.some((p) => p.pseudonym === participant) ? participant : undefined,
    eventType: options.eventTypes.some((t) => t.key === eventType) ? eventType : undefined,
    reviewStatus: VISIBLE_REVIEW_STATUSES.find((status) => status === reviewStatus),
    date: options.dates.find((d) => d === date),
  };
}

/** A positive whole page number; anything else falls back to the first page. */
function parsePage(query: SearchParams) {
  const n = Number(first(query[PAGE_PARAM]));
  return Number.isSafeInteger(n) && n >= 1 ? n : 1;
}

function parsePageSize(query: SearchParams) {
  const n = Number(first(query[SIZE_PARAM]));
  return PAGE_SIZES.find((size) => size === n) ?? DEFAULT_PAGE_SIZE;
}

const PAGE_ITEM = "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg px-2 tabular-nums no-underline";

/** Page numbers to show: first, last, and two either side of the current one, with gaps collapsed. */
function pageWindow(current: number, count: number): (number | "gap")[] {
  const keep = new Set([1, count, ...[-2, -1, 0, 1, 2].map((d) => current + d)]);
  const pages = [...keep].filter((n) => n >= 1 && n <= count).sort((a, b) => a - b);
  return pages.flatMap((n, i) => (i > 0 && n - pages[i - 1] > 1 ? ["gap" as const, n] : [n]));
}

/** Query string (with the leading "?", or empty) for a page of the list; defaults are left out. */
function pageQuery(filters: ObservationFilters, size: number, page: number) {
  const params = new URLSearchParams();
  if (filters.participant) params.set(FILTER_PARAMS.participant, filters.participant);
  if (filters.eventType) params.set(FILTER_PARAMS.eventType, filters.eventType);
  if (filters.reviewStatus) params.set(FILTER_PARAMS.reviewStatus, filters.reviewStatus);
  if (filters.date) params.set(FILTER_PARAMS.date, filters.date);
  if (size !== DEFAULT_PAGE_SIZE) params.set(SIZE_PARAM, String(size));
  if (page > 1) params.set(PAGE_PARAM, String(page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function describeScope(filters: ObservationFilters, participantCount: number) {
  const who = filters.participant ?? (participantCount === 1 ? "1 participante" : `${participantCount} participantes`);
  const when = filters.date ? `día local ${formatLocalDay(filters.date)}` : "todo el periodo de estudio";
  return `${who}, ${when}`;
}
