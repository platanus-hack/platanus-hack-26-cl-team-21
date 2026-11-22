import type { TimelineDay } from "@/lib/queries/timeline";
import { dayTicks, formatDuration, formatRange } from "@/lib/format";
import { COVERAGE_STATUS_LABELS, COVERAGE_STATUS_STYLES, eventTypeLabel } from "@/lib/labels";

// A non-observed band this wide (share of the day) has room for its status label inside it.
// Observed bands carry no label: they are the only solid fill, and markers would cover the text.
const LABEL_MIN_PCT = 12;
const MARKER_MIN_PX = 6;

/**
 * One local day as a bar: coverage bands positioned by share of the day, current observations
 * drawn on top. Plain HTML with absolute positioning.
 * Bands are hidden from assistive tech because the day's "Tiempo no observado" table states the
 * same coverage in text (their `title` is a mouse-only extra); markers are labelled links to each
 * observation.
 */
/** `linkMarkers={false}` draws markers as plain marks, for a figure without the observation list (landing). */
export function DayTimeline({ day, timeZone, linkMarkers = true }: { day: TimelineDay; timeZone: string; linkMarkers?: boolean }) {
  const ticks = dayTicks(day.startMs, day.endMs, timeZone);

  return (
    <figure className="@container m-0">
      {linkMarkers && (
        <figcaption className="sr-only">
          Cobertura y observaciones del día. Los episodios detectados son enlaces a su detalle; el tiempo no observado y sus motivos
          están en la tabla «Tiempo no observado» de este día.
        </figcaption>
      )}
      <div className="relative h-11">
        <div className="absolute inset-0 overflow-hidden rounded-lg bg-paper-deep ring-1 ring-ink/15">
          {day.bands.map((band) => {
            const statusLabel = COVERAGE_STATUS_LABELS[band.status];
            const text = `${statusLabel}: ${formatRange(band.startMs, band.endMs, timeZone, day.endMs)} (${formatDuration((band.endMs - band.startMs) / 1000)})`;
            return (
              <div
                key={band.startMs}
                title={text}
                aria-hidden
                // A gap of a few minutes still shows: non-observed bands never shrink below 2 px.
                className={`absolute inset-y-0 ${band.status === "observed" ? "" : "min-w-0.5"}`}
                style={{ left: `${band.leftPct}%`, width: `${band.widthPct}%`, ...COVERAGE_STATUS_STYLES[band.status] }}
              >
                {band.status !== "observed" && band.widthPct >= LABEL_MIN_PCT && (
                  <span className="pointer-events-none absolute top-1/2 left-1.5 max-w-[calc(100%-0.75rem)] -translate-y-1/2 truncate rounded bg-paper/90 px-1.5 py-0.5 text-xs leading-none font-medium text-ink">
                    {statusLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        {/* Markers sit outside the clipped band layer so their 24 px hit area is never cut off. */}
        {day.markers.map((o) => {
          const shape = `absolute inset-y-1.5 rounded-sm ring-2 ring-paper ${isHollowMarker(o.eventKey) ? "border-2 border-ink bg-paper" : "bg-ink"}`;
          const style = { left: `min(${o.leftPct}%, 100% - ${MARKER_MIN_PX}px)`, width: `max(${MARKER_MIN_PX}px, ${o.widthPct}%)` };
          return linkMarkers ? (
            <a
              key={o.id}
              href={`#obs-${o.id}`}
              aria-label={`${eventTypeLabel(o.eventKey, o.eventLabel)}: ${formatRange(o.startMs, o.endMs, timeZone)}`}
              className={`${shape} after:absolute after:inset-y-0 after:left-1/2 after:w-6 after:-translate-x-1/2 after:content-[''] hover:ring-secondary`}
              style={style}
            />
          ) : (
            <span key={o.id} aria-hidden className={shape} style={style} />
          );
        })}
      </div>
      <div className="relative mt-1 min-h-4 text-xs tabular-nums text-ink-muted" aria-hidden>
        {ticks.map((t, i) => {
          const edge = i === 0 ? "translate-x-0" : i === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2";
          // Below 28rem every other inner tick hides, so the labels never collide.
          const thin = i > 0 && i < ticks.length - 1 && i % 2 === 1 ? "@max-md:hidden" : "";
          return (
            <span key={t.ms} className={`absolute ${edge} ${thin}`} style={{ left: `${t.pct}%` }}>
              {t.label}
            </span>
          );
        })}
      </div>
    </figure>
  );
}

/** Drinking is drawn hollow, everything else solid, so the two read apart without colour. */
export const isHollowMarker = (eventKey: string) => eventKey === "drinking_episode";
