import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { changeProtocolAction, regenerateCodeAction, revokeTokenAction, withdrawAction } from "@/lib/enrollment/actions";
import { getManagedParticipant, type ManagedParticipant } from "@/lib/enrollment/queries";
import { isOpen } from "@/lib/enrollment/state";
import { EnrollmentSummary, focusRing, formatInstant, inputClass, labelClass } from "@/lib/enrollment/ui";
import { formatDate } from "@/lib/format";
import { label, PARTICIPANT_STATUS_LABELS } from "@/lib/labels";
import { getStudyByCode } from "@/lib/queries/studies";
import { ConfirmAction } from "./_components/confirm-action";

type Props = PageProps<"/studies/[code]/participants/[pseudonym]/manage">;

export default function ManageParticipantPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Cargando participante…</p>}>
      <ManageParticipant params={params} />
    </Suspense>
  );
}

async function ManageParticipant({ params }: Pick<Props, "params">) {
  const { code, pseudonym } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const participant = await getManagedParticipant(study.id, pseudonym);
  if (!participant) notFound();

  const base = `/studies/${encodeURIComponent(study.code)}/participants`;
  const tz = participant.timezone;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-3">
        <nav aria-label="Ruta" className="text-sm text-ink-muted">
          <Link href={base} className={`hover:underline ${focusRing}`}>
            Participantes
          </Link>{" "}
          <span aria-hidden>/</span>{" "}
          <span translate="no">{participant.pseudonym}</span> <span aria-hidden>/</span> Gestión
        </nav>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h2 className="text-2xl font-semibold">
            Gestionar{" "}
            <span className="font-mono" translate="no">
              {participant.pseudonym}
            </span>
          </h2>
          <Link href={`${base}/${encodeURIComponent(participant.pseudonym)}`} className={`text-sm underline underline-offset-2 ${focusRing}`}>
            Ver línea de tiempo
          </Link>
        </div>
        <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-ink-muted">Estado</dt>
            <dd>
              {label(PARTICIPANT_STATUS_LABELS, participant.status)}
              {participant.withdrawnAt && <span className="block text-xs text-ink-muted">desde el {formatInstant(participant.withdrawnAt, tz)}</span>}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Grupo</dt>
            <dd>{participant.arm ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Zona horaria · inscrito el</dt>
            <dd>
              <span className="font-mono" translate="no">{tz}</span>
              <span className="block text-xs text-ink-muted">{formatInstant(participant.enrolledAt, tz)}</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Inscripción en la app</dt>
            <dd>
              <EnrollmentSummary state={participant.enrollment} timeZone={tz} />
            </dd>
          </div>
        </dl>
      </header>

      <ProtocolHistory participant={participant} />

      <section aria-labelledby="actions-heading" className="flex flex-col gap-3">
        <h3 id="actions-heading" className="text-lg font-semibold">
          Acciones
        </h3>
        {participant.status === "withdrawn" ? (
          <p className="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-ink-muted">
            El participante está retirado: no admite más cambios. Sus datos ya recolectados se conservan y su periodo de estudio termina
            en la fecha de retiro.
          </p>
        ) : (
          <Actions studyCode={study.code} participant={participant} />
        )}
      </section>
    </div>
  );
}

function ProtocolHistory({ participant }: { participant: ManagedParticipant }) {
  const tz = participant.timezone;
  return (
    <section aria-labelledby="protocols-heading" className="flex flex-col gap-2">
      <h3 id="protocols-heading" className="text-lg font-semibold">
        Protocolo asignado
      </h3>
      {participant.assignments.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin protocolo asignado: el participante no tiene periodo de estudio.</p>
      ) : (
        <table className="w-full max-w-2xl text-left text-sm">
          <thead className="border-b border-zinc-200 text-ink-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">Versión</th>
              <th scope="col" className="py-2 pr-4 font-medium">Desde</th>
              <th scope="col" className="py-2 font-medium">Hasta</th>
            </tr>
          </thead>
          <tbody>
            {participant.assignments.map((assignment) => (
              <tr key={assignment.validFrom.toISOString()} className="border-b border-zinc-100">
                <td className="py-2 pr-4 font-mono" translate="no">
                  {assignment.label}
                  {assignment.current && <span className="ml-2 font-sans text-xs text-emerald-800">vigente</span>}
                </td>
                <td className="py-2 pr-4">{formatInstant(assignment.validFrom, tz)}</td>
                <td className="py-2">{assignment.validTo ? formatInstant(assignment.validTo, tz) : "sin término"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Unavailable({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 px-4 py-3 text-sm">
      <p className="font-medium">{title}</p>
      <p className="text-ink-muted">{children}</p>
    </div>
  );
}

function Actions({ studyCode, participant }: { studyCode: string; participant: ManagedParticipant }) {
  const { pseudonym, enrollment } = participant;
  const tz = participant.timezone;
  const open = isOpen(participant.status);
  const otherVersions = participant.versions.filter((version) => version.id !== participant.currentVersionId);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {enrollment.code === "redeemed" ? (
        <Unavailable title="Código de inscripción">
          La app canjeó el código el {formatInstant(enrollment.redeemedAt, tz)}: ya no se puede regenerar.
        </Unavailable>
      ) : open ? (
        <ConfirmAction
          action={regenerateCodeAction.bind(null, studyCode, pseudonym)}
          summary={enrollment.code === "pending" ? "Regenerar código de inscripción…" : "Generar código de inscripción…"}
          confirmLabel={enrollment.code === "pending" ? "Sí, regenerar el código" : "Sí, generar un código"}
          tone="neutral"
        >
          <p>
            Se genera un código nuevo de un solo uso y se muestra una sola vez. El código anterior deja de servir de inmediato: úsalo si
            se perdió o no llegó al participante.
          </p>
        </ConfirmAction>
      ) : (
        <Unavailable title="Código de inscripción">Solo se entregan códigos a participantes inscritos o activos.</Unavailable>
      )}

      {enrollment.code === "redeemed" && enrollment.token === "active" ? (
        <ConfirmAction action={revokeTokenAction.bind(null, studyCode, pseudonym)} summary="Revocar token de la app…" confirmLabel="Sí, revocar el token" tone="danger">
          <p>
            La app de este participante deja de poder subir datos desde ahora (recibe 401). Lo ya subido se conserva. No se puede
            deshacer: el código ya fue canjeado, así que no hay forma de volver a inscribir la app en esta versión del portal.
          </p>
        </ConfirmAction>
      ) : (
        <Unavailable title="Token de la app">
          {enrollment.code === "redeemed" ? "El token ya está revocado." : "La app todavía no canjea un código: no hay token que revocar."}
        </Unavailable>
      )}

      {!open ? (
        <Unavailable title="Cambiar protocolo">Solo se cambia el protocolo a participantes inscritos o activos.</Unavailable>
      ) : otherVersions.length === 0 ? (
        <Unavailable title="Cambiar protocolo">No hay otra versión publicada de este estudio a la que cambiarlo.</Unavailable>
      ) : (
        <ConfirmAction action={changeProtocolAction.bind(null, studyCode, pseudonym)} summary="Cambiar versión de protocolo…" confirmLabel="Sí, cambiar desde ahora" tone="neutral">
          <p>
            La asignación vigente se cierra ahora y la nueva rige desde ahora. Lo ya observado sigue asociado a la versión bajo la que se
            registró.
          </p>
          <label className={labelClass}>
            Nueva versión
            <select name="protocolVersionId" required autoComplete="off" defaultValue={otherVersions[0].id} className={`max-w-xs ${inputClass}`}>
              {otherVersions.map((version) => (
                <option key={version.id} value={version.id}>
                  {version.label}
                  {version.publishedAt ? ` · publicada el ${formatDate(version.publishedAt)}` : ""}
                </option>
              ))}
            </select>
          </label>
        </ConfirmAction>
      )}

      <ConfirmAction action={withdrawAction.bind(null, studyCode, pseudonym)} summary="Retirar participante…" confirmLabel="Sí, retirar al participante" tone="danger">
        <p>Desde ahora el participante queda retirado y no se puede deshacer:</p>
        <ul className="list-disc pl-5">
          <li>se revoca el token de la app y, si no lo canjeó, su código deja de servir;</li>
          <li>se cierra su asignación de protocolo y su periodo de estudio termina hoy;</li>
          <li>los datos ya recolectados se conservan; el tiempo posterior no cuenta como observado ni como cero.</li>
        </ul>
      </ConfirmAction>
    </div>
  );
}
