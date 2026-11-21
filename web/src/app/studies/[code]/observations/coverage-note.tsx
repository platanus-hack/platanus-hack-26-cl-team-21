import { COVERAGE_STATUS } from "@observatorio/db";
import type { CoverageSummary } from "@/lib/queries/observations";
import { COVERAGE_STATUS_LABEL, formatHours, formatShare } from "./format";

// Shown above the list so it is never read as complete: episodes can only be detected in observed
// time, and every non-observed hour is listed with its reason.
export function CoverageNote({ coverage, scope }: { coverage: CoverageSummary; scope: string }) {
  const { byStatus, unrecordedSeconds, totalSeconds, participantsWithoutCoverage } = coverage;
  const observed = byStatus.observed;
  const notObserved = totalSeconds - observed;
  const reasons = [
    ...COVERAGE_STATUS.filter((status) => status !== "observed" && byStatus[status] > 0).map((status) => ({
      label: COVERAGE_STATUS_LABEL[status],
      seconds: byStatus[status],
    })),
    ...(unrecordedSeconds > 0 ? [{ label: "Sin registro de cobertura", seconds: unrecordedSeconds }] : []),
  ];
  const partial = totalSeconds === 0 || notObserved > 0 || participantsWithoutCoverage > 0;

  return (
    <section
      aria-labelledby="coverage-title"
      className={`rounded-lg border p-4 text-sm ${partial ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}
    >
      <h2 id="coverage-title" className="font-semibold">
        Cobertura del alcance filtrado <span className="font-normal">({scope})</span>
      </h2>
      {totalSeconds === 0 ? (
        <p className="mt-1">
          No hay registros de cobertura para este alcance. No se sabe qué parte del tiempo fue observada, así que esta lista no puede
          leerse como completa.
        </p>
      ) : (
        <>
          <p className="mt-1">
            <strong>Observado: {formatHours(observed)}</strong> de {formatHours(totalSeconds)} ({formatShare(observed, totalSeconds)}).{" "}
            {notObserved > 0 ? (
              <>
                <strong>No observado: {formatHours(notObserved)}</strong>. En ese tiempo no se detectan episodios, lo que no significa que
                no hayan ocurrido: la lista solo cubre el tiempo observado.
              </>
            ) : participantsWithoutCoverage === 0 ? (
              "Todo el tiempo registrado del alcance fue observado."
            ) : null}
          </p>
          {reasons.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {reasons.map((reason) => (
                <li key={reason.label}>
                  {reason.label}: <span className="tabular-nums">{formatHours(reason.seconds)}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {totalSeconds > 0 && participantsWithoutCoverage > 0 && (
        <p className="mt-2">
          <strong>
            {participantsWithoutCoverage === 1
              ? "1 participante no tiene"
              : `${participantsWithoutCoverage} participantes no tienen`}{" "}
            ningún registro de cobertura
          </strong>
          : su tiempo no observado no se puede cuantificar y no está incluido en las horas anteriores.
        </p>
      )}
      <p className="mt-2 text-xs opacity-80">
        La cobertura depende del participante y la fecha, no del tipo de evento ni del estado de revisión. Las observaciones rechazadas en
        revisión humana no se muestran.
      </p>
    </section>
  );
}
