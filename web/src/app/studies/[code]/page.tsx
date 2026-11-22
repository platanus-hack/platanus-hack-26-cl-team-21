import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { NUM, TableFrame, TBody, TD, TH, TH_ROW, TR } from "@/components/data-table";
import { ReadingGuide } from "@/components/reading-guide";
import { Loading, SkeletonBar, SkeletonTable } from "@/components/skeleton";
import { Specimen } from "@/components/specimen";
import { formatDate, formatDuration, formatLocalDay, formatNumber, formatShare, spansYears } from "@/lib/format";
import {
  COVERAGE_STATUS_LABELS,
  COVERAGE_STATUS_STYLES,
  eventTypeLabel,
  label,
  PARTICIPANT_STATUS_LABELS,
  PROTOCOL_STATUS_LABELS,
} from "@/lib/labels";
import type { CoverageBreakdown } from "@/lib/queries/coverage";
import { getStudyOverview, type StudyOverview } from "@/lib/queries/studies";
import { LINK } from "@/lib/ui";

/** Days per participant in the daily coverage table; the participant page has the rest. */
const RECENT_DAYS = 14;

export default function StudyOverviewPage({ params }: PageProps<"/studies/[code]">) {
  return (
    <Suspense
      fallback={
        <Loading label="Cargando resumen…">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <SkeletonBar key={i} className="h-20" />
            ))}
          </div>
          <SkeletonTable />
        </Loading>
      }
    >
      <Overview params={params} />
    </Suspense>
  );
}

async function Overview({ params }: { params: PageProps<"/studies/[code]">["params"] }) {
  const { code } = await params;
  await connection();
  const study = await getStudyOverview(code);
  if (!study) notFound();
  const base = `/studies/${encodeURIComponent(study.code)}`;

  return (
    <div className="flex flex-col gap-10">
      {study.description && <p className="max-w-3xl text-ink-muted">{study.description}</p>}

      <KeyFigures study={study} />

      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-lg font-medium">Protocolo en uso</h2>
        {study.protocolsInUse.length === 0 ? (
          <p className="text-sm text-ink-muted">Ningún participante tiene un protocolo asignado actualmente.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {study.protocolsInUse.map((protocol) => (
              <li key={protocol.versionLabel}>
                <span className="font-mono font-medium">{protocol.versionLabel}</span>
                <span className="text-ink-muted">
                  {" · "}
                  {protocol.status === "published"
                    ? protocol.publishedAt && `Publicado el ${formatDate(protocol.publishedAt)}`
                    : label(PROTOCOL_STATUS_LABELS, protocol.status)}
                  {protocol.status !== "published" && protocol.publishedAt && ` · publicado el ${formatDate(protocol.publishedAt)}`}
                  {" · "}
                  {protocol.participantCount} {protocol.participantCount === 1 ? "participante" : "participantes"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-serif text-lg font-medium">Participantes</h2>
          <Link href={`${base}/observations`} className={`text-sm ${LINK}`}>
            Ver todas las observaciones
          </Link>
        </div>
        <ParticipantsTable study={study} base={base} />
        <ul className="max-w-3xl space-y-1 text-sm text-ink-muted">
          <li>
            <span className="font-medium text-ink">sin tiempo observado</span>: no hubo tiempo observado, así que no se puede afirmar que no
            ocurrió.
          </li>
          <li>
            <span className="font-medium text-ink">no medido</span>: el protocolo del participante no define esa variable.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-serif text-lg font-medium">Cobertura diaria</h2>
        <DailyCoverageTable study={study} base={base} />
      </section>

      <ReadingGuide />
    </div>
  );
}

/** Study-wide figures, summed from the per-participant breakdowns the tables below already show. */
function KeyFigures({ study }: { study: StudyOverview }) {
  const total = study.participants.reduce((sum, p) => sum + p.coverage.totalSeconds, 0);
  const observed = study.participants.reduce((sum, p) => sum + p.coverage.observedSeconds, 0);
  return (
    <dl className="grid gap-6 border-y border-rule py-6 sm:grid-cols-2 lg:grid-cols-4">
      <Specimen
        label="Tiempo observado"
        value={total === 0 ? "—" : formatDuration(observed)}
        unit={total === 0 ? "sin periodo de estudio" : `de ${formatDuration(total)} (${formatShare(observed, total)})`}
      />
      {study.eventTypes.map((eventType) => {
        // A count is only read against the observed time that could have produced it: that of the
        // participants whose protocol measures this variable, not the whole study's.
        const measuring = study.participants.filter((p) => p.measuredEventKeys.includes(eventType.key));
        const measuredObserved = measuring.reduce((sum, p) => sum + p.coverage.observedSeconds, 0);
        const count = measuring.reduce((sum, p) => sum + (p.coverage.observedSeconds > 0 ? (p.observationCounts[eventType.key] ?? 0) : 0), 0);
        return (
          <Specimen
            key={eventType.key}
            label={eventTypeLabel(eventType.key, eventType.label)}
            value={measuring.length === 0 || measuredObserved === 0 ? "—" : formatNumber(count, 0)}
            unit={
              measuring.length === 0
                ? "no medido: ningún protocolo asignado lo define"
                : measuredObserved === 0
                  ? "sin tiempo observado"
                  : `episodios en ${formatDuration(measuredObserved)} de tiempo observado de quienes lo miden`
            }
          />
        );
      })}
      <Specimen
        label="Sin observar"
        value={total === 0 ? "—" : formatDuration(total - observed)}
        unit="sin conteos: no equivale a cero"
      />
      <Specimen
        label="Participantes"
        value={formatNumber(study.participants.length, 0)}
        unit="en el estudio"
      />
    </dl>
  );
}

function ParticipantLink({ base, pseudonym }: { base: string; pseudonym: string }) {
  return (
    <Link href={`${base}/participants/${encodeURIComponent(pseudonym)}`} className={`${LINK} [overflow-wrap:anywhere]`}>
      {pseudonym}
    </Link>
  );
}

function ParticipantsTable({ study, base }: { study: StudyOverview; base: string }) {
  if (study.participants.length === 0) {
    return <p className="text-sm text-ink-muted">Este estudio no tiene participantes.</p>;
  }
  return (
    <TableFrame caption="Participantes del estudio, con conteos en tiempo observado">
      <thead className="text-ink-muted">
        <tr>
          <th scope="col" className={`${TH} left-0 z-20`}>Participante</th>
          <th scope="col" className={TH}>Estado</th>
          <th scope="col" className={TH}>Protocolo</th>
          {study.eventTypes.map((eventType) => (
            <th key={eventType.key} scope="col" className={`${TH} ${NUM}`}>
              {eventTypeLabel(eventType.key, eventType.label)}
            </th>
          ))}
          <th scope="col" className={`${TH} ${NUM}`}>Tiempo observado</th>
          <th scope="col" className={TH}>Tiempo no observado</th>
        </tr>
      </thead>
      <TBody>
        {study.participants.map((participant) => (
          <tr key={participant.id} className={TR}>
            <th scope="row" className={`${TH_ROW} font-mono`}>
              <ParticipantLink base={base} pseudonym={participant.pseudonym} />
            </th>
            <td className={TD}>{label(PARTICIPANT_STATUS_LABELS, participant.status)}</td>
            <td className={`${TD} font-mono`}>{participant.protocolLabel ?? <span className="text-ink-muted">—</span>}</td>
            {study.eventTypes.map((eventType) => (
              <td key={eventType.key} className={`${TD} ${NUM}`}>
                {!participant.measuredEventKeys.includes(eventType.key) ? (
                  <span className="text-ink-muted">no medido</span>
                ) : participant.coverage.observedSeconds > 0 ? (
                  (participant.observationCounts[eventType.key] ?? 0)
                ) : (
                  <span className="text-ink-muted">sin tiempo observado</span>
                )}
              </td>
            ))}
            <td className={`${TD} ${NUM}`}>
              <ObservedTime coverage={participant.coverage} />
            </td>
            <td className={TD}>
              <NotObservedList coverage={participant.coverage} />
            </td>
          </tr>
        ))}
      </TBody>
    </TableFrame>
  );
}

function DailyCoverageTable({ study, base }: { study: StudyOverview; base: string }) {
  const rows = study.participants.flatMap((participant) => participant.days.slice(-RECENT_DAYS).map((day) => ({ participant, day })));
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">Ningún participante tiene un periodo de estudio en curso o pasado (asignación a un protocolo).</p>
    );
  }
  const truncated = study.participants.some((participant) => participant.days.length > RECENT_DAYS);
  const withYear = spansYears(rows.map(({ day }) => day.day));
  return (
    <>
      <TableFrame caption="Cobertura diaria por participante">
        <thead className="text-ink-muted">
          <tr>
            <th scope="col" className={`${TH} left-0 z-20`}>Participante</th>
            <th scope="col" className={TH}>Día</th>
            <th scope="col" className={`${TH} min-w-48`}>Composición del día</th>
            <th scope="col" className={`${TH} ${NUM}`}>Tiempo observado</th>
            <th scope="col" className={TH}>Tiempo no observado</th>
          </tr>
        </thead>
        <TBody>
          {rows.map(({ participant, day }) => (
            <tr key={`${participant.id}:${day.day}`} className={TR}>
              <th scope="row" className={`${TH_ROW} font-mono`}>
                <ParticipantLink base={base} pseudonym={participant.pseudonym} />
              </th>
              <td className={`${TD} whitespace-nowrap`}>
                <time dateTime={day.day}>{formatLocalDay(day.day, "short", withYear)}</time>
              </td>
              <td className={`${TD} align-middle`}>
                <CompositionBar coverage={day} />
              </td>
              <td className={`${TD} ${NUM}`}>
                <ObservedTime coverage={day} />
              </td>
              <td className={TD}>
                <NotObservedList coverage={day} />
              </td>
            </tr>
          ))}
        </TBody>
      </TableFrame>
      <p className="max-w-3xl text-sm text-ink-muted">
        La barra muestra la proporción del día en cada estado, no la hora; la línea de tiempo con horas está en la página de cada
        participante.
        {truncated && ` Se muestran los últimos ${RECENT_DAYS} días de cada participante.`}
      </p>
    </>
  );
}

/**
 * Share of a day's study-period time in each coverage state, observed (solid) first. It repeats the
 * text cells next to it, so it is hidden from assistive tech.
 */
function CompositionBar({ coverage }: { coverage: CoverageBreakdown }) {
  if (coverage.totalSeconds === 0) return null;
  const parts = [
    { status: "observed" as const, seconds: coverage.observedSeconds },
    ...coverage.notObserved.map(({ status, seconds }) => ({ status, seconds })),
  ].filter((part) => part.seconds > 0);
  return (
    <div aria-hidden className="flex h-4 overflow-hidden rounded-sm bg-paper-deep ring-1 ring-ink/15">
      {parts.map((part) => (
        <span
          key={part.status}
          className="h-full min-w-0.5"
          style={{ width: `${(part.seconds / coverage.totalSeconds) * 100}%`, ...COVERAGE_STATUS_STYLES[part.status] }}
        />
      ))}
    </div>
  );
}

function ObservedTime({ coverage }: { coverage: CoverageBreakdown }) {
  if (coverage.totalSeconds === 0) {
    return <span className="text-ink-muted">Sin periodo de estudio</span>;
  }
  if (coverage.observedSeconds === 0) {
    return (
      <span>
        <span className="text-ink-muted">sin tiempo observado</span>
        <span className="block text-ink-muted">de {formatDuration(coverage.totalSeconds)}</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap">
      {formatDuration(coverage.observedSeconds)}
      <span className="text-ink-muted"> de {formatDuration(coverage.totalSeconds)}</span>
    </span>
  );
}

function NotObservedList({ coverage }: { coverage: CoverageBreakdown }) {
  if (coverage.notObserved.length === 0) {
    return <span className="text-ink-muted">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {coverage.notObserved.map(({ status, seconds }) => (
        <li key={status} className="whitespace-nowrap">
          {label(COVERAGE_STATUS_LABELS, status)}
          <span className="text-ink-muted tabular-nums"> · {formatDuration(seconds)}</span>
        </li>
      ))}
    </ul>
  );
}
