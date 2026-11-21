import type { TimelineDay } from "@/lib/queries/timeline";
import { formatDuration, formatPercent, formatRange } from "./format";
import { STATUS, eventLabel } from "./labels";

/**
 * Per-day summary. Episodes are counted over observed time only; when nothing was observed no
 * count is shown at all (never a zero for a window that was not observed).
 */
export function DaySummary({ day, timeZone }: { day: TimelineDay; timeZone: string }) {
  const { summary } = day;
  const notObservedMs = summary.dayMs - summary.observedMs;
  const notObservedBands = day.bands.filter((b) => b.status !== "observed");

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
        <h4 className="mb-2 font-medium">Episodios en tiempo observado</h4>
        {summary.observedMs === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            No hubo tiempo observado este día, así que no se reportan conteos. Que no haya detecciones no significa que no haya
            habido episodios.
          </p>
        ) : (
          <>
            <p className="mb-2 text-zinc-600 dark:text-zinc-400">
              Tiempo observado: <strong className="text-foreground">{formatDuration(summary.observedMs)}</strong> (
              {formatPercent(summary.observedMs, summary.dayMs)} del día).
            </p>
            {summary.counts.length === 0 ? (
              <p>Sin episodios detectados durante el tiempo observado.</p>
            ) : (
              <ul className="space-y-1">
                {summary.counts.map((c) => (
                  <li key={c.eventKey} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-lg font-semibold tabular-nums">{c.count}</span>
                    <span>{eventLabel(c.eventKey, c.eventLabel).toLowerCase()}</span>
                    <span className="text-zinc-500">· duración observada {formatDuration(c.observedMs)}</span>
                  </li>
                ))}
              </ul>
            )}
            {summary.uncounted > 0 && (
              <p className="mt-2 text-amber-800 dark:text-amber-300">
                {summary.uncounted} episodio(s) caen fuera del tiempo observado y no se cuentan.
              </p>
            )}
          </>
        )}
      </div>

      <div className="rounded-lg bg-zinc-50 p-4 text-sm dark:bg-zinc-900">
        <h4 className="mb-2 font-medium">Tiempo no observado</h4>
        {notObservedMs === 0 ? (
          <p>Todo el día fue observado.</p>
        ) : (
          <>
            <p className="mb-2 text-zinc-600 dark:text-zinc-400">
              <strong className="text-foreground">{formatDuration(notObservedMs)}</strong> ({formatPercent(notObservedMs, summary.dayMs)}{" "}
              del día) sin observación:
            </p>
            <table className="w-full text-left">
              <thead className="sr-only">
                <tr>
                  <th>Motivo</th>
                  <th>Duración</th>
                  <th>Intervalos</th>
                </tr>
              </thead>
              <tbody>
                {summary.notObserved.map(({ status, ms }) => (
                  <tr key={status} className="align-top">
                    <td className="py-0.5 pr-3">
                      <span className="flex items-center gap-2">
                        <span className="inline-block h-3 w-5 shrink-0 rounded-sm ring-1 ring-black/15" style={STATUS[status].style} aria-hidden />
                        {STATUS[status].label}
                      </span>
                    </td>
                    <td className="py-0.5 pr-3 tabular-nums whitespace-nowrap">{formatDuration(ms)}</td>
                    <td className="py-0.5 tabular-nums text-zinc-500">
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
