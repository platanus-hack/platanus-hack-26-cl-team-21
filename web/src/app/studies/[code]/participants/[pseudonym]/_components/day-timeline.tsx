import type { TimelineDay } from "@/lib/queries/timeline";
import { formatDuration, formatEnd, formatRange, formatTime } from "@/lib/format";
import { COVERAGE_STATUS_LABELS, COVERAGE_STATUS_STYLES, eventTypeLabel } from "@/lib/labels";

const HOUR_MS = 3_600_000;
const TICK_HOURS = 3;
// A non-observed band this wide (share of the day) has room for its status label inside it.
// Observed bands carry no label: they are the only solid fill, and markers would cover the text.
const LABEL_MIN_PCT = 12;

/**
 * One local day as a bar: coverage bands positioned by share of the day, current observations
 * drawn on top. Plain HTML with absolute positioning; native tooltips via `title`.
 * Bands are hidden from assistive tech because the day's "Tiempo no observado" table states the
 * same coverage in text; markers are labelled links to each observation.
 */
export function DayTimeline({ day, timeZone }: { day: TimelineDay; timeZone: string }) {
  const dayMs = day.endMs - day.startMs;
  // Ticks at real instants, so a DST day (23 h / 25 h) keeps them where the clock says.
  const ticks: { ms: number; pct: number }[] = [];
  for (let ms = day.startMs; ms <= day.endMs; ms += TICK_HOURS * HOUR_MS) ticks.push({ ms, pct: ((ms - day.startMs) / dayMs) * 100 });

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Cobertura y observaciones del día. Los episodios detectados son enlaces a su detalle; el tiempo no observado y sus motivos
        están en la tabla «Tiempo no observado» de este día.
      </figcaption>
      <div className="relative h-11 overflow-hidden rounded-md bg-zinc-100 ring-1 ring-black/10 dark:bg-zinc-900 dark:ring-white/10">
        {day.bands.map((band) => {
          const statusLabel = COVERAGE_STATUS_LABELS[band.status];
          const text = `${statusLabel}: ${formatRange(band.startMs, band.endMs, timeZone, day.endMs)} (${formatDuration((band.endMs - band.startMs) / 1000)})`;
          return (
            <div
              key={band.startMs}
              title={text}
              aria-hidden
              className="absolute inset-y-0 border-x border-white/70 dark:border-zinc-950/70"
              style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%`, ...COVERAGE_STATUS_STYLES[band.status] }}
            >
              {band.status !== "observed" && band.widthPct >= LABEL_MIN_PCT && (
                <span className="pointer-events-none absolute left-1.5 top-1/2 max-w-[calc(100%-0.75rem)] -translate-y-1/2 truncate rounded bg-white/90 px-1.5 py-0.5 text-[11px] font-medium leading-none text-zinc-900">
                  {statusLabel}
                </span>
              )}
            </div>
          );
        })}
        {day.markers.map((o) => {
          const text = `${eventTypeLabel(o.eventKey, o.eventLabel)}: ${formatRange(o.startMs, o.endMs, timeZone)}`;
          return (
            <a
              key={o.id}
              href={`#obs-${o.id}`}
              title={text}
              aria-label={text}
              className={`absolute inset-y-1.5 rounded-sm ring-2 ring-white transition-transform hover:scale-y-110 motion-reduce:transition-none motion-reduce:hover:scale-y-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:ring-zinc-950 dark:focus-visible:outline-white ${
                isHollowMarker(o.eventKey) ? "border-2 border-zinc-950 bg-white dark:border-white dark:bg-zinc-950" : "bg-zinc-950 dark:bg-white"
              }`}
              style={{ left: `${o.leftPct}%`, width: `max(6px, ${o.widthPct}%)` }}
            />
          );
        })}
      </div>
      <div className="relative mt-1 h-4 text-[11px] tabular-nums text-zinc-500" aria-hidden>
        {ticks.map((t, i) => (
          <span
            key={t.ms}
            className="absolute -translate-x-1/2 first:translate-x-0 last:-translate-x-full"
            style={{ left: `${t.pct}%` }}
          >
            {i === ticks.length - 1 && t.ms === day.endMs ? formatEnd(t.ms, day.endMs, timeZone) : formatTime(t.ms, timeZone)}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** Drinking is drawn hollow, everything else solid, so the two read apart without colour. */
export const isHollowMarker = (eventKey: string) => eventKey === "drinking_episode";
