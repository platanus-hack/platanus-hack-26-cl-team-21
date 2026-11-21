import Link from "next/link";
import type { ParticipantTimeline } from "@/lib/queries/timeline";
import { formatDate } from "@/lib/format";
import { label, PARTICIPANT_STATUS_LABELS } from "@/lib/labels";

function validity(fromMs: number, toMs: number | null, timeZone: string) {
  return toMs === null ? `desde ${formatDate(fromMs, timeZone)}` : `${formatDate(fromMs, timeZone)} – ${formatDate(toMs, timeZone)}`;
}

export function ParticipantHeader({ data }: { data: ParticipantTimeline }) {
  const { participant, study, period, protocols, devices, runs } = data;
  const tz = participant.timezone;
  return (
    <header className="space-y-4">
      {/* The study layout already shows the study and its tabs; participant pages have no tab of their own. */}
      <nav aria-label="Ruta" className="text-sm text-ink-muted">
        <Link href={`/studies/${encodeURIComponent(study.code)}`} className="hover:underline">
          Resumen
        </Link>{" "}
        <span aria-hidden>/</span> Participante
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-mono text-3xl font-semibold" translate="no">
          {participant.pseudonym}
        </h2>
        <span className="rounded-full bg-paper-deep px-2.5 py-0.5 text-sm text-ink-muted">
          {label(PARTICIPANT_STATUS_LABELS, participant.status)}
        </span>
        {participant.arm && <span className="text-sm text-ink-muted">Grupo: {participant.arm}</span>}
      </div>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Protocolo</dt>
          <dd>
            {protocols.length === 0
              ? "Sin protocolo asignado"
              : protocols.map((p) => (
                  <div key={`${p.label}-${p.fromMs}`}>
                    <span className="font-mono">{p.label}</span> <span className="text-ink-muted">({validity(p.fromMs, p.toMs, tz)})</span>
                  </div>
                ))}
            {period && (
              <div className="text-xs text-ink-muted">
                Periodo de estudio: {formatDate(period.fromMs, tz)} – {period.ongoing ? "hoy (en curso)" : formatDate(period.toMs, tz)}
              </div>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Dispositivo y firmware</dt>
          <dd>
            {devices.length === 0
              ? "Sin dispositivo asignado"
              : devices.map((d) => (
                  <div key={`${d.serial}-${d.fromMs}`}>
                    <span className="font-mono">{d.serial}</span> · firmware{" "}
                    <span className="font-mono">{d.firmwareVersions.length ? d.firmwareVersions.join(", ") : "sin datos"}</span>
                    <div className="text-xs text-ink-muted">
                      {d.hardwareRevision} · {validity(d.fromMs, d.toMs, tz)}
                    </div>
                  </div>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Modelo y pipeline</dt>
          <dd>
            {runs.length === 0
              ? "Sin observaciones"
              : runs.map((r) => (
                  <div key={`${r.modelVersion}|${r.pipelineVersion}`} className="font-mono">
                    {r.modelVersion} · {r.pipelineVersion}
                  </div>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Zona horaria</dt>
          <dd>
            <span className="font-mono">{tz}</span>
            <div className="text-xs text-ink-muted">Días y horas en la hora local del participante</div>
          </dd>
        </div>
      </dl>
    </header>
  );
}
