import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { formatLocalDay } from "@/lib/format";
import { getParticipantTimeline } from "@/lib/queries/timeline";
import { LINK } from "@/lib/ui";
import { CoverageLegend } from "@/components/coverage-legend";
import { DaySummary } from "./_components/day-summary";
import { DayTimeline } from "@/components/day-timeline";
import { ObservationList } from "@/components/observation-list";
import { ParticipantHeader } from "./_components/participant-header";

type Props = PageProps<"/studies/[code]/participants/[pseudonym]">;

/** Days rendered by default; `?days=all` shows the whole study period. */
const RECENT_DAYS = 7;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, pseudonym } = await params;
  return { title: `${pseudonym} · ${code}` };
}

export default async function ParticipantPage({ params, searchParams }: Props) {
  const [{ code, pseudonym }, query] = await Promise.all([params, searchParams]);
  await connection();
  const data = await getParticipantTimeline(code, pseudonym);
  if (!data) notFound();

  const tz = data.participant.timezone;
  const showAll = query.days === "all";
  // shortcut: every day is still loaded and only the render is cut; bound the query in SQL once periods reach months.
  const days = showAll ? data.days : data.days.slice(-RECENT_DAYS);
  const showNoRecord = days.some((d) => d.bands.some((b) => b.status === "no_record"));
  const path = `/studies/${encodeURIComponent(data.study.code)}/participants/${encodeURIComponent(data.participant.pseudonym)}`;

  return (
    <div className="space-y-8">
      <ParticipantHeader data={data} />
      {data.days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-hairline p-6 text-sm text-ink-muted">
          Este participante no tiene periodo de estudio (sin protocolo asignado o aún no comienza) ni observaciones. Sin datos no se reporta ningún
          conteo.
        </p>
      ) : (
        <>
          <CoverageLegend showNoRecord={showNoRecord} />
          {data.days.length > RECENT_DAYS && (
            <p className="flex flex-wrap gap-x-3 text-sm text-ink-muted">
              {showAll ? (
                <>
                  <span>Mostrando los {data.days.length} días.</span>
                  <Link href={path} className={LINK}>
                    Ver solo los últimos {RECENT_DAYS}
                  </Link>
                </>
              ) : (
                <>
                  <span>
                    Mostrando los últimos {RECENT_DAYS} de {data.days.length} días.
                  </span>
                  <Link href={`${path}?days=all`} className={LINK}>
                    Ver todos los días
                  </Link>
                </>
              )}
            </p>
          )}
          {days.map((day) => {
            // No count for a day without observed time: an empty list there is not a zero.
            const unobserved = !!day.period && day.summary.observedMs === 0;
            return (
              <section key={day.day} className="space-y-4 border-t border-rule pt-6">
                <h2 className="font-serif text-xl font-medium">{formatLocalDay(day.day, "long")}</h2>
                <DayTimeline day={day} timeZone={tz} />
                <DaySummary day={day} timeZone={tz} />
                <div>
                  <h3 className="mb-2 font-medium">Observaciones{unobserved ? "" : ` (${day.observations.length})`}</h3>
                  <ObservationList observations={day.observations} timeZone={tz} unobserved={unobserved} />
                </div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
