import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import {
  type FilterOptions,
  findStudyByCode,
  getCoverageSummary,
  getObservationFilterOptions,
  listObservations,
  type ObservationFilters,
  type ObservationRow,
  VISIBLE_REVIEW_STATUSES,
  type VisibleReviewStatus,
} from "@/lib/queries/observations";
import { CoverageNote } from "./coverage-note";
import { FILTER_PARAMS, ObservationFiltersForm } from "./filters";
import { eventTypeLabel, formatAttributes, formatConfidence, formatDuration, REVIEW_STATUS_LABEL } from "./format";

type Props = PageProps<"/studies/[code]/observations">;
type SearchParams = Awaited<Props["searchParams"]>;

export default function ObservationsPage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Observaciones</h1>
      <Suspense fallback={<p className="text-sm text-zinc-500">Cargando observaciones…</p>}>
        <ObservationsContent params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function ObservationsContent({ params, searchParams }: Props) {
  await connection();
  const { code } = await params;
  const study = await findStudyByCode(code);
  if (!study) notFound();

  const [options, query] = await Promise.all([getObservationFilterOptions(study.id), searchParams]);
  const filters = parseFilters(query, options);
  const [rows, coverage] = await Promise.all([listObservations(study.id, filters), getCoverageSummary(study.id, filters)]);
  const basePath = `/studies/${encodeURIComponent(study.code)}`;

  return (
    <>
      <p className="-mt-4 text-sm text-zinc-600">
        {study.title} <span className="font-mono text-xs">({study.code})</span>
      </p>
      <ObservationFiltersForm action={`${basePath}/observations`} options={options} filters={filters} />
      <CoverageNote coverage={coverage} scope={describeScope(filters, coverage.participantCount)} />
      <p className="text-sm text-zinc-600">
        {rows.length === 1 ? "1 observación" : `${rows.length} observaciones`} en tiempo observado, ordenadas por hora de inicio. Hora
        local de cada participante.
      </p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600">
          No hay observaciones actuales para estos filtros. Revisa la cobertura: sin tiempo observado no se pueden detectar episodios.
        </p>
      ) : (
        <ObservationTable rows={rows} basePath={basePath} />
      )}
    </>
  );
}

function ObservationTable({ rows, basePath }: { rows: ObservationRow[]; basePath: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs text-zinc-600">
          <tr>
            <th className="px-3 py-2 font-medium">Participante</th>
            <th className="px-3 py-2 font-medium">Fecha</th>
            <th className="px-3 py-2 font-medium">Horario</th>
            <th className="px-3 py-2 font-medium">Duración</th>
            <th className="px-3 py-2 font-medium">Tipo de evento</th>
            <th className="px-3 py-2 font-medium">Atributos</th>
            <th className="px-3 py-2 font-medium" title="Puntaje que entrega el modelo (0 a 1). No es una probabilidad calibrada.">
              Confianza del modelo
              <span className="block font-normal">salida del modelo, no calibrada</span>
            </th>
            <th className="px-3 py-2 font-medium">Revisión humana</th>
            <th className="px-3 py-2 font-medium">Ejecución</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <tr key={row.id} className="align-top hover:bg-zinc-50">
              <td className="px-3 py-2">
                <Link
                  href={`${basePath}/participants/${encodeURIComponent(row.pseudonym)}`}
                  className="font-medium text-blue-700 underline-offset-2 hover:underline"
                  title="Ver línea de tiempo del participante"
                >
                  {row.pseudonym}
                </Link>
                <span className="block text-xs text-zinc-500">{row.timezone}</span>
              </td>
              <td className="px-3 py-2 tabular-nums whitespace-nowrap">{row.local_date}</td>
              <td className="px-3 py-2 tabular-nums whitespace-nowrap">
                {row.local_start}–{row.local_end}
                {row.local_end_date !== row.local_date && <span className="text-xs text-zinc-500"> ({row.local_end_date})</span>}
              </td>
              <td className="px-3 py-2 tabular-nums whitespace-nowrap">{formatDuration(row.duration_s)}</td>
              <td className="px-3 py-2">{eventTypeLabel(row.event_type_key, row.event_type_label)}</td>
              <td className="px-3 py-2">
                <dl className="grid grid-cols-[auto_1fr] gap-x-2 text-xs">
                  {formatAttributes(row.attributes).map((item) => (
                    <div key={item.label} className="contents">
                      <dt className="text-zinc-500">{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </td>
              <td className="px-3 py-2 tabular-nums">{formatConfidence(row.confidence)}</td>
              <td className="px-3 py-2">
                <ReviewBadge status={row.human_review_status} />
              </td>
              <td className="px-3 py-2 text-xs text-zinc-600">
                <span className="block whitespace-nowrap">Modelo {row.model_version}</span>
                <span className="block whitespace-nowrap">Pipeline {row.pipeline_version}</span>
                <span className="block whitespace-nowrap">Protocolo {row.protocol_version}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const REVIEW_BADGE_CLASS: Record<VisibleReviewStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  confirmed: "bg-emerald-100 text-emerald-800",
  corrected: "bg-sky-100 text-sky-800",
};

function ReviewBadge({ status }: { status: VisibleReviewStatus }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${REVIEW_BADGE_CLASS[status]}`}>{REVIEW_STATUS_LABEL[status]}</span>;
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

function describeScope(filters: ObservationFilters, participantCount: number) {
  const who = filters.participant ?? (participantCount === 1 ? "1 participante" : `${participantCount} participantes`);
  const when = filters.date ? `día local ${filters.date}` : "todo el periodo registrado";
  return `${who}, ${when}`;
}
