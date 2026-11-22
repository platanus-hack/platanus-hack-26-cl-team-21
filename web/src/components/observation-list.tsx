import type { PlacedObservation, SensorStat } from "@/lib/queries/timeline";
import { formatConfidence, formatDuration, formatNumber, formatRange, plural } from "@/lib/format";
import {
  COVERAGE_STATUS_LABELS,
  eventTypeLabel,
  formatAttributes,
  label,
  REVIEW_STATUS_BADGE_CLASS,
  REVIEW_STATUS_LABELS,
  sensorInfo,
} from "@/lib/labels";
import { isHollowMarker } from "@/components/day-timeline";

function SensorContext({ stats }: { stats: SensorStat[] }) {
  const withReadings = stats.filter((s) => s.n > 0 && s.mean !== null);
  if (withReadings.length === 0) {
    return <p className="text-ink-muted">Sin lecturas de sensores en este intervalo.</p>;
  }
  return (
    <table className="w-full text-left text-sm">
      <caption className="sr-only">Lecturas de sensores durante el episodio</caption>
      <thead className="text-ink-muted">
        <tr>
          <th scope="col" className="py-0.5 pr-3 font-normal">Sensor</th>
          <th scope="col" className="py-0.5 pr-3 text-right font-normal">Media</th>
          <th scope="col" className="py-0.5 pr-3 text-right font-normal">Mín–máx</th>
          <th scope="col" className="py-0.5 text-right font-normal">Lecturas</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {withReadings.map((s) => {
          const info = sensorInfo(s.sensorType, s.unit);
          const fmt = (v: number | null) => (v === null ? "—" : formatNumber(v, info.decimals));
          return (
            <tr key={s.sensorType}>
              <td className="py-0.5 pr-3">
                {info.label} <span className="text-ink-muted">({info.unit})</span>
              </td>
              <td className="py-0.5 pr-3 text-right">{fmt(s.mean)}</td>
              <td className="py-0.5 pr-3 text-right whitespace-nowrap">
                {fmt(s.min)}–{fmt(s.max)}
              </td>
              <td className="py-0.5 text-right">{s.n}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ObservationList({
  observations,
  timeZone,
  unobserved = false,
}: {
  observations: PlacedObservation[];
  timeZone: string;
  unobserved?: boolean;
}) {
  if (observations.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        {unobserved
          ? "Sin tiempo observado este día: no se puede afirmar que no hubo episodios."
          : "Sin observaciones vigentes este día."}
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {observations.map((o) => {
        const reviewClass = REVIEW_STATUS_BADGE_CLASS[o.reviewStatus] ?? REVIEW_STATUS_BADGE_CLASS.pending;
        return (
          <li
            key={o.id}
            id={`obs-${o.id}`}
            className="scroll-mt-6 rounded-lg border border-rule p-4 text-sm transition-[box-shadow,background-color] duration-150 ease-out target:bg-paper-deep target:ring-2 target:ring-secondary"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                aria-hidden
                className={`inline-block h-4 w-2 rounded-sm ${
                  isHollowMarker(o.eventKey) ? "border-2 border-ink" : "bg-ink"
                }`}
              />
              <span className="font-mono tabular-nums">{formatRange(o.startMs, o.endMs, timeZone)}</span>
              <span className="text-ink-muted">({formatDuration((o.endMs - o.startMs) / 1000)})</span>
              <span className="font-medium">{eventTypeLabel(o.eventKey, o.eventLabel)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${reviewClass}`}>
                Revisión humana: {label(REVIEW_STATUS_LABELS, o.reviewStatus).toLowerCase()}
              </span>
            </div>

            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {formatAttributes(o.attributes).map((item) => (
                <div key={item.key} className="contents">
                  <dt className="text-ink-muted">{item.label}</dt>
                  <dd className="[overflow-wrap:anywhere]">{item.value}</dd>
                </div>
              ))}
              <dt className="text-ink-muted">Confianza del modelo</dt>
              <dd>
                <span className="tabular-nums">{formatConfidence(o.confidence)}</span>{" "}
                <span className="text-ink-muted">(0 a 1, no calibrada)</span>
              </dd>
              <dt className="text-ink-muted">Evidencia</dt>
              <dd>{plural(o.evidenceCount, "clip de video original", "clips de video original")}</dd>
              <dt className="text-ink-muted">Procedencia</dt>
              <dd className="text-ink-muted">
                Protocolo {o.protocolVersion} · modelo {o.modelVersion} · pipeline {o.pipelineVersion}
              </dd>
            </dl>

            {o.overlapsNotObserved.length > 0 && (
              <p className="mt-3 rounded-r-lg border-l-4 border-warning bg-paper-deep px-3 py-2 text-ink">
                Parte de este episodio cae en tiempo no observado (
                {o.overlapsNotObserved.map((s) => COVERAGE_STATUS_LABELS[s].toLowerCase()).join(", ")}).
                {o.observedMs <= 0 && " No se cuenta en el resumen del día."}
              </p>
            )}

            <div className="mt-3">
              <h4 className="mb-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">Contexto de sensores durante el episodio</h4>
              <SensorContext stats={o.sensorContext} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
