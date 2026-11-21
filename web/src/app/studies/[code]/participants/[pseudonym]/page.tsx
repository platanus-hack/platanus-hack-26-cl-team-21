import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getParticipantTimeline } from "@/lib/queries/timeline";
import { CoverageLegend } from "./_components/coverage-legend";
import { DaySummary } from "./_components/day-summary";
import { DayTimeline } from "./_components/day-timeline";
import { formatLocalDay } from "@/lib/format";
import { ObservationList } from "./_components/observation-list";
import { ParticipantHeader } from "./_components/participant-header";

export default function ParticipantPage({ params }: PageProps<"/studies/[code]/participants/[pseudonym]">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Cargando línea de tiempo…</p>}>
      <ParticipantTimelineView params={params} />
    </Suspense>
  );
}

async function ParticipantTimelineView({ params }: { params: Promise<{ code: string; pseudonym: string }> }) {
  const { code, pseudonym } = await params;
  await connection();
  const data = await getParticipantTimeline(code, pseudonym);
  if (!data) notFound();

  const tz = data.participant.timezone;
  const showNoRecord = data.days.some((d) => d.bands.some((b) => b.status === "no_record"));

  return (
    <div className="space-y-8">
      <ParticipantHeader data={data} />
      {data.days.length === 0 ? (
        <p className="rounded-lg border border-dashed border-black/20 p-6 text-sm text-zinc-500 dark:border-white/20">
          Este participante no tiene periodo de estudio (sin protocolo asignado o aún no comienza) ni observaciones. Sin datos no se reporta ningún
          conteo.
        </p>
      ) : (
        <>
          <CoverageLegend showNoRecord={showNoRecord} />
          {data.days.map((day) => (
            <section key={day.day} aria-labelledby={`day-${day.day}`} className="space-y-4 border-t border-black/10 pt-6 dark:border-white/10">
              <h2 id={`day-${day.day}`} className="text-xl font-semibold">
                {formatLocalDay(day.day, "long")}
              </h2>
              <DayTimeline day={day} timeZone={tz} />
              <DaySummary day={day} timeZone={tz} />
              <div>
                <h3 className="mb-2 font-medium">Observaciones ({day.observations.length})</h3>
                <ObservationList observations={day.observations} timeZone={tz} />
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
