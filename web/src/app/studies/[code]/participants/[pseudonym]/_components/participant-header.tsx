import Link from "next/link";
import type { ParticipantTimeline } from "@/lib/queries/timeline";
import { formatDate } from "./format";
import { PARTICIPANT_STATUS } from "./labels";

function validity(fromMs: number, toMs: number | null, timeZone: string) {
  return toMs === null ? `desde ${formatDate(fromMs, timeZone)}` : `${formatDate(fromMs, timeZone)} – ${formatDate(toMs, timeZone)}`;
}

export function ParticipantHeader({ data }: { data: ParticipantTimeline }) {
  const { participant, study, protocols, devices, runs } = data;
  const tz = participant.timezone;
  return (
    <header className="space-y-4">
      <nav className="text-sm text-zinc-500">
        <Link href={`/studies/${encodeURIComponent(study.code)}`} className="hover:underline">
          {study.title}
        </Link>{" "}
        <span aria-hidden>/</span> Participante
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-mono text-3xl font-semibold">{participant.pseudonym}</h1>
        <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {PARTICIPANT_STATUS[participant.status] ?? participant.status}
        </span>
        {participant.arm && <span className="text-sm text-zinc-500">Grupo: {participant.arm}</span>}
      </div>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-zinc-500">Protocolo</dt>
          <dd>
            {protocols.length === 0
              ? "Sin protocolo asignado"
              : protocols.map((p) => (
                  <div key={`${p.label}-${p.fromMs}`}>
                    <span className="font-mono">{p.label}</span> <span className="text-zinc-500">({validity(p.fromMs, p.toMs, tz)})</span>
                  </div>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Dispositivo y firmware</dt>
          <dd>
            {devices.length === 0
              ? "Sin dispositivo asignado"
              : devices.map((d) => (
                  <div key={`${d.serial}-${d.fromMs}`}>
                    <span className="font-mono">{d.serial}</span> · firmware{" "}
                    <span className="font-mono">{d.firmwareVersions.length ? d.firmwareVersions.join(", ") : "sin datos"}</span>
                    <div className="text-xs text-zinc-500">
                      {d.hardwareRevision} · {validity(d.fromMs, d.toMs, tz)}
                    </div>
                  </div>
                ))}
          </dd>
        </div>
        <div>
          <dt className="text-zinc-500">Modelo y pipeline</dt>
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
          <dt className="text-zinc-500">Zona horaria</dt>
          <dd>
            <span className="font-mono">{tz}</span>
            <div className="text-xs text-zinc-500">Días y horas en la hora local del participante</div>
          </dd>
        </div>
      </dl>
    </header>
  );
}
