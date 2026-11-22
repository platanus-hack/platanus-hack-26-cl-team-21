import type { TimelineDay } from "@/lib/queries/timeline";
import { formatDuration, formatRange, formatShare } from "@/lib/format";
import { COVERAGE_STATUS_LABELS, COVERAGE_STATUS_STYLES, eventCountLabel } from "@/lib/labels";

/**
 * Per-day summary over the part of the day inside the study period. Episodes are counted over
 * observed time only; when nothing was observed no count is shown at all (never a zero for a
 * window that was not observed).
 */
export function DaySummary({ day, timeZone }: { day: TimelineDay; timeZone: string }) {
  const { summary, period } = day;
  if (!period) {
    return (
      <p className="rounded-lg bg-paper-deep p-4 text-sm text-ink-muted">
        Este día está fuera del periodo de estudio del participante: no se reporta cobertura ni conteos. Se muestra solo por sus
        observaciones.
      </p>
    );
  }
  const notObservedMs = summary.periodMs - summary.observedMs;
  const notObservedBands = day.bands.filter((b) => b.status !== "observed");
  const wholeDay = period.startMs === day.startMs && period.endMs === day.endMs;
  const ofDay = wholeDay ? "del día" : "del periodo de estudio de este día";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {!wholeDay && (
        <p className="text-sm text-ink-muted md:col-span-2">
          Periodo de estudio este día: {formatRange(period.startMs, period.endMs, timeZone, day.endMs)}.
        </p>
      )}
      <div className="rounded-lg bg-paper-deep p-4 text-sm">
        <h3 className="mb-2 font-medium">Episodios en tiempo observado</h3>
        {summary.observedMs === 0 ? (
          <p className="text-ink-muted">
            No hubo tiempo observado este día, así que no se reportan conteos. Que no haya detecciones no significa que no haya
            habido episodios.
          </p>
        ) : (
          <>
            <p className="mb-2 text-ink-muted">
              Tiempo observado: <strong className="text-ink">{formatDuration(summary.observedMs / 1000)}</strong> (
              {formatShare(summary.observedMs, summary.periodMs)} {ofDay}).
            </p>
            {summary.counts.length === 0 ? (
              <p>Sin episodios detectados durante el tiempo observado.</p>
            ) : (
              <ul className="space-y-1">
                {summary.counts.map((c) => (
                  <li key={c.eventKey} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-serif text-2xl font-medium tabular-nums">{c.count}</span>
                    <span>{eventCountLabel(c.eventKey, c.eventLabel, c.count)}</span>
                    <span className="text-ink-muted">· duración observada {formatDuration(c.observedMs / 1000)}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.uncounted > 0 && (
              <p className="mt-2 border-l-4 border-warning pl-2 text-ink">
                {summary.uncounted === 1
                  ? "1 episodio cae fuera del tiempo observado y no se cuenta."
                  : `${summary.uncounted} episodios caen fuera del tiempo observado y no se cuentan.`}
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg bg-paper-deep p-4 text-sm">
        <h3 className="mb-2 font-medium">Tiempo no observado</h3>
        {notObservedMs === 0 ? (
          <p>{wholeDay ? "Todo el día fue observado." : "Todo el periodo de estudio de este día fue observado."}</p>
        ) : (
          <>
            <p className="mb-2 text-ink-muted">
              <strong className="text-ink">{formatDuration(notObservedMs / 1000)}</strong> ({formatShare(notObservedMs, summary.periodMs)}{" "}
              {ofDay}) sin observación:
            </p>
            <table className="w-full text-left">
              <caption className="sr-only">Tiempo no observado por motivo</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Motivo</th>
                  <th scope="col">Duración</th>
                  <th scope="col">Intervalos</th>
                </tr>
              </thead>
              <tbody>
                {summary.notObserved.map(({ status, ms }) => (
                  <tr key={status} className="align-top">
                    <td className="py-0.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-5 shrink-0 rounded-sm ring-1 ring-ink/15" style={COVERAGE_STATUS_STYLES[status]} aria-hidden />
                        {COVERAGE_STATUS_LABELS[status]}
                      </span>
                    </td>
                    <td className="py-0.5 pr-3 text-right tabular-nums whitespace-nowrap">{formatDuration(ms / 1000)}</td>
                    <td className="py-0.5 tabular-nums text-ink-muted">
                      {notObservedBands
                        .filter((b) => b.status === status)
                        .map((b) => formatRange(b.startMs, b.endMs, timeZone, day.endMs))
                        .join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}
