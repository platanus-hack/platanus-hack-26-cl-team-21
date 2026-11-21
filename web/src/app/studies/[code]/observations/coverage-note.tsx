import { formatDuration, formatShare } from "@/lib/format";
import { COVERAGE_STATUS_LABELS } from "@/lib/labels";
import type { CoverageSummary } from "@/lib/queries/observations";

// Shown above the list so it is never read as complete: episodes can only be detected in observed
// time, and every non-observed hour of the study period is listed with its reason.
export function CoverageNote({ coverage, scope }: { coverage: CoverageSummary; scope: string }) {
  const { observedSeconds: observed, totalSeconds, notObserved: reasons, participantsWithoutPeriod } = coverage;
  const notObserved = totalSeconds - observed;
  const partial = totalSeconds === 0 || reasons.length > 0 || participantsWithoutPeriod > 0;

  return (
    <section
      aria-labelledby="coverage-title"
      className={`rounded-lg border p-4 text-sm ${partial ? "border-warning bg-warning/20 text-ink" : "border-rule bg-paper-deep text-ink"}`}
    >
      <h2 id="coverage-title" className="font-semibold">
        Cobertura del alcance filtrado <span className="font-normal">({scope})</span>
      </h2>
      {totalSeconds === 0 ? (
        <p className="mt-1">
          Este alcance no tiene tiempo dentro del periodo de estudio de ningún participante. No se sabe qué parte del tiempo fue
          observada, así que esta lista no puede leerse como completa.
        </p>
      ) : (
        <>
          <p className="mt-1">
            {observed > 0 ? (
              <>
                <strong>Observado: {formatDuration(observed)}</strong> de {formatDuration(totalSeconds)} ({formatShare(observed, totalSeconds)}).
              </>
            ) : (
              <>
                <strong>Sin tiempo observado</strong> en {formatDuration(totalSeconds)} de periodo de estudio.
              </>
            )}{" "}
            {reasons.length > 0 ? (
              <>
                <strong>No observado: {formatDuration(notObserved)}</strong>. En ese tiempo no se detectan episodios, lo que no significa
                que no hayan ocurrido: la lista solo cubre el tiempo observado.
              </>
            ) : participantsWithoutPeriod === 0 ? (
              "Todo el periodo de estudio del alcance fue observado."
            ) : null}
          </p>
          {reasons.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {reasons.map((reason) => (
                <li key={reason.status}>
                  {COVERAGE_STATUS_LABELS[reason.status]}: <span className="tabular-nums">{formatDuration(reason.seconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {participantsWithoutPeriod > 0 && (
        <p className="mt-2">
          <strong>
            {participantsWithoutPeriod === 1
              ? "1 participante no tiene"
              : `${participantsWithoutPeriod} participantes no tienen`}{" "}
            periodo de estudio
          </strong>{" "}
          (sin protocolo asignado o aún no comienza): su tiempo no observado no se puede cuantificar y no está incluido en el total anterior.
        </p>
      )}
      <p className="mt-2 text-xs opacity-80">
        El periodo de estudio de cada participante va desde su primera asignación a un protocolo hasta el fin de la última, su retiro
        u hoy, lo que ocurra primero; “Sin registro” es tiempo de ese periodo sin datos subidos. La cobertura depende del
        participante y la fecha, no del tipo de evento ni del estado de revisión. Las observaciones rechazadas en revisión humana no
        se muestran.
      </p>
    </section>
  );
}
