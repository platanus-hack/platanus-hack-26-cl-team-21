import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatDate, formatDuration, formatLocalDay } from "@/lib/format";
import { COVERAGE_STATUS_LABELS, eventTypeLabel, label, PARTICIPANT_STATUS_LABELS, PROTOCOL_STATUS_LABELS } from "@/lib/labels";
import type { CoverageBreakdown } from "@/lib/queries/coverage";
import { getStudyOverview, type StudyOverview } from "@/lib/queries/studies";

export default function StudyOverviewPage({ params }: PageProps<"/studies/[code]">) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">Cargando resumen…</p>}>
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
    <div className="flex flex-col gap-8">
      {study.description && <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-400">{study.description}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Protocolo en uso</h2>
        {study.protocolsInUse.length === 0 ? (
          <p className="text-sm text-neutral-500">Ningún participante tiene un protocolo asignado actualmente.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {study.protocolsInUse.map((protocol) => (
              <li key={protocol.versionLabel}>
                <span className="font-mono font-medium">{protocol.versionLabel}</span>
                <span className="text-neutral-500">
                  {" · "}
                  {protocol.status === "published"
                    ? protocol.publishedAt && `Publicado el ${formatDate(protocol.publishedAt)}`
                    : label(PROTOCOL_STATUS_LABELS, protocol.status)}
                  {protocol.status !== "published" &&
                    protocol.publishedAt &&
                    ` · publicado el ${formatDate(protocol.publishedAt)}`}
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
          <h2 className="text-lg font-semibold">Participantes</h2>
          <Link href={`${base}/observations`} className="text-sm underline underline-offset-2">
            Ver todas las observaciones
          </Link>
        </div>
        <ParticipantsTable study={study} base={base} />
        <p className="max-w-3xl text-xs text-neutral-500">
          Los conteos incluyen las observaciones vigentes (no rechazadas en revisión humana) y solo provienen del tiempo
          observado. El tiempo no observado no equivale a ausencia de conducta: se muestra con su motivo. El periodo de
          estudio de cada participante va desde su primera asignación a un protocolo hasta el fin de la última, su retiro
          u hoy, lo que ocurra primero; “Sin registro” es tiempo de ese periodo sin datos subidos.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Cobertura diaria</h2>
        <DailyCoverageTable study={study} base={base} />
        <p className="max-w-3xl text-xs text-neutral-500">Días según la zona horaria de cada participante.</p>
      </section>
    </div>
  );
}

function ParticipantLink({ base, pseudonym }: { base: string; pseudonym: string }) {
  return (
    <Link href={`${base}/participants/${encodeURIComponent(pseudonym)}`} className="underline underline-offset-2">
      {pseudonym}
    </Link>
  );
}

function ParticipantsTable({ study, base }: { study: StudyOverview; base: string }) {
  if (study.participants.length === 0) {
    return <p className="text-sm text-neutral-500">Este estudio no tiene participantes.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 align-bottom text-neutral-500 dark:border-neutral-800">
          <tr>
            <th className="py-2 pr-4 font-medium">Participante</th>
            <th className="py-2 pr-4 font-medium">Estado</th>
            <th className="py-2 pr-4 font-medium">Protocolo</th>
            {study.eventTypes.map((eventType) => (
              <th key={eventType.key} className="py-2 pr-4 text-right font-medium">
                {eventTypeLabel(eventType.key, eventType.label)}
                <span className="block font-mono text-xs font-normal">{eventType.key}</span>
              </th>
            ))}
            <th className="py-2 pr-4 font-medium">Tiempo observado</th>
            <th className="py-2 font-medium">Tiempo no observado</th>
          </tr>
        </thead>
        <tbody>
          {study.participants.map((participant) => (
            <tr key={participant.id} className="border-b border-neutral-100 align-top dark:border-neutral-900">
              <td className="py-2 pr-4 font-mono">
                <ParticipantLink base={base} pseudonym={participant.pseudonym} />
              </td>
              <td className="py-2 pr-4">{label(PARTICIPANT_STATUS_LABELS, participant.status)}</td>
              <td className="py-2 pr-4 font-mono">
                {participant.protocolLabel ?? <span className="text-neutral-500">—</span>}
              </td>
              {study.eventTypes.map((eventType) => (
                <td key={eventType.key} className="py-2 pr-4 text-right tabular-nums">
                  {!participant.measuredEventKeys.includes(eventType.key) ? (
                    <span className="text-xs text-neutral-500" title="Su protocolo no define esta variable">
                      no medido
                    </span>
                  ) : participant.coverage.observedSeconds > 0 ? (
                    (participant.observationCounts[eventType.key] ?? 0)
                  ) : (
                    <NotObservedMark />
                  )}
                </td>
              ))}
              <td className="py-2 pr-4">
                <ObservedTime coverage={participant.coverage} />
              </td>
              <td className="py-2">
                <NotObservedList coverage={participant.coverage} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DailyCoverageTable({ study, base }: { study: StudyOverview; base: string }) {
  const rows = study.participants.flatMap((participant) => participant.days.map((day) => ({ participant, day })));
  if (rows.length === 0) {
    return <p className="text-sm text-neutral-500">Ningún participante tiene un periodo de estudio en curso o pasado (asignación a un protocolo).</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
          <tr>
            <th className="py-2 pr-4 font-medium">Participante</th>
            <th className="py-2 pr-4 font-medium">Día</th>
            <th className="py-2 pr-4 font-medium">Tiempo observado</th>
            <th className="py-2 font-medium">Tiempo no observado</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ participant, day }) => (
            <tr key={`${participant.id}:${day.day}`} className="border-b border-neutral-100 align-top dark:border-neutral-900">
              <td className="py-2 pr-4 font-mono">
                <ParticipantLink base={base} pseudonym={participant.pseudonym} />
              </td>
              <td className="py-2 pr-4 whitespace-nowrap">{formatLocalDay(day.day)}</td>
              <td className="py-2 pr-4">
                <ObservedTime coverage={day} />
              </td>
              <td className="py-2">
                <NotObservedList coverage={day} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotObservedMark() {
  return (
    <span className="text-xs text-neutral-500" title="Sin tiempo observado: no se puede afirmar que no ocurrió">
      sin tiempo observado
    </span>
  );
}

function ObservedTime({ coverage }: { coverage: CoverageBreakdown }) {
  if (coverage.totalSeconds === 0) {
    return <span className="text-neutral-500">Sin periodo de estudio (sin protocolo asignado o aún no comienza)</span>;
  }
  if (coverage.observedSeconds === 0) {
    return (
      <span>
        <NotObservedMark />
        <span className="block text-xs text-neutral-500">de {formatDuration(coverage.totalSeconds)}</span>
      </span>
    );
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatDuration(coverage.observedSeconds)}
      <span className="text-neutral-500"> de {formatDuration(coverage.totalSeconds)}</span>
    </span>
  );
}

function NotObservedList({ coverage }: { coverage: CoverageBreakdown }) {
  if (coverage.notObserved.length === 0) {
    return <span className="text-neutral-500">—</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {coverage.notObserved.map(({ status, seconds }) => (
        <li key={status} className="whitespace-nowrap">
          {label(COVERAGE_STATUS_LABELS, status)}
          <span className="tabular-nums text-neutral-500"> · {formatDuration(seconds)}</span>
        </li>
      ))}
    </ul>
  );
}
