import type { PlacedObservation, SensorStat } from "@/lib/queries/timeline";
import { formatDuration, formatNumber, formatRange } from "./format";
import { REVIEW_STATUS, STATUS, attributeLabel, attributeValue, eventLabel, isHollowMarker, plural, sensorInfo, sortedAttributes } from "./labels";

function SensorContext({ stats }: { stats: SensorStat[] }) {
  const withReadings = stats.filter((s) => s.n > 0 && s.mean !== null);
  if (withReadings.length === 0) {
    return <p className="text-zinc-500">Sin lecturas de sensores en este intervalo.</p>;
  }
  return (
    <table className="w-full text-left text-xs">
      <thead className="text-zinc-500">
        <tr>
          <th className="py-0.5 pr-3 font-normal">Sensor</th>
          <th className="py-0.5 pr-3 font-normal">Media</th>
          <th className="py-0.5 pr-3 font-normal">Mín–máx</th>
          <th className="py-0.5 font-normal">Lecturas</th>
        </tr>
      </thead>
      <tbody className="tabular-nums">
        {withReadings.map((s) => {
          const info = sensorInfo(s.sensorType, s.unit);
          const fmt = (v: number | null) => (v === null ? "—" : formatNumber(v, info.decimals));
          return (
            <tr key={s.sensorType}>
              <td className="py-0.5 pr-3">
                {info.label} <span className="text-zinc-500">({info.unit})</span>
              </td>
              <td className="py-0.5 pr-3">{fmt(s.mean)}</td>
              <td className="py-0.5 pr-3">
                {fmt(s.min)}–{fmt(s.max)}
              </td>
              <td className="py-0.5">{s.n}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ObservationList({ observations, timeZone }: { observations: PlacedObservation[]; timeZone: string }) {
  if (observations.length === 0) {
    return <p className="text-sm text-zinc-500">Sin observaciones vigentes este día.</p>;
  }
  return (
    <ol className="space-y-3">
      {observations.map((o) => {
        const review = REVIEW_STATUS[o.reviewStatus] ?? { label: o.reviewStatus, className: "bg-zinc-100 text-zinc-700" };
        const attributes = sortedAttributes(o.attributes);
        return (
          <li
            key={o.id}
            id={`obs-${o.id}`}
            className="scroll-mt-6 rounded-lg border border-black/10 p-4 text-sm target:ring-2 target:ring-zinc-900 dark:border-white/10 dark:target:ring-white"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span
                aria-hidden
                className={`inline-block h-4 w-2 rounded-sm ${
                  isHollowMarker(o.eventKey) ? "border-2 border-zinc-950 dark:border-white" : "bg-zinc-950 dark:bg-white"
                }`}
              />
              <span className="font-mono tabular-nums">{formatRange(o.startMs, o.endMs, timeZone)}</span>
              <span className="text-zinc-500">({formatDuration(o.endMs - o.startMs)})</span>
              <span className="font-medium">{eventLabel(o.eventKey, o.eventLabel)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs ${review.className}`}>{review.label}</span>
            </div>

            <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
              {attributes.map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-zinc-500">{attributeLabel(key)}</dt>
                  <dd>{attributeValue(key, value)}</dd>
                </div>
              ))}
              <dt className="text-zinc-500">Confianza del modelo</dt>
              <dd>
                {o.confidence === null ? "—" : <span className="tabular-nums">{formatNumber(o.confidence, 2)}</span>}{" "}
                <span className="text-xs text-zinc-500">(salida del modelo en escala 0–1, no es una probabilidad calibrada)</span>
              </dd>
              <dt className="text-zinc-500">Evidencia</dt>
              <dd>{plural(o.evidenceCount, "clip de video original", "clips de video original")}</dd>
              <dt className="text-zinc-500">Procedencia</dt>
              <dd className="text-xs text-zinc-600 dark:text-zinc-400">
                Protocolo {o.protocolVersion} · modelo {o.modelVersion} · pipeline {o.pipelineVersion}
              </dd>
            </dl>

            {o.overlapsNotObserved.length > 0 && (
              <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                Parte de este episodio cae en tiempo no observado (
                {o.overlapsNotObserved.map((s) => STATUS[s].label.toLowerCase()).join(", ")}).
                {o.observedMs <= 0 && " No se cuenta en el resumen del día."}
              </p>
            )}

            <div className="mt-3">
              <h5 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Contexto de sensores durante el episodio</h5>
              <SensorContext stats={o.sensorContext} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}
