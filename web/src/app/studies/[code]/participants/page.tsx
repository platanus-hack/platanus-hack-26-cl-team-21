import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { listParticipants, type ParticipantListItem } from "@/lib/enrollment/queries";
import { EnrollmentSummary, focusRing, formatInstant, primaryButtonClass } from "@/lib/enrollment/ui";
import { label, PARTICIPANT_STATUS_LABELS } from "@/lib/labels";
import { getStudyByCode } from "@/lib/queries/studies";

type Props = PageProps<"/studies/[code]/participants">;

export default function ParticipantsPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-ink-muted">Cargando participantes…</p>}>
      <Participants params={params} />
    </Suspense>
  );
}

async function Participants({ params }: Pick<Props, "params">) {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const items = await listParticipants(study.id);
  const base = `/studies/${encodeURIComponent(study.code)}/participants`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Participantes</h2>
        <Link href={`${base}/new`} className={primaryButtonClass}>
          Nuevo participante
        </Link>
      </div>
      <p className="max-w-3xl text-sm text-ink-muted">
        Solo seudónimos: la identidad real de cada participante no se guarda en el portal. El código de inscripción se muestra una
        sola vez al crearlo o regenerarlo; aquí solo ves si la app ya lo canjeó y si su token sigue activo.
      </p>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-ink-muted">
          Este estudio todavía no tiene participantes. Crea el primero con “Nuevo participante”.
        </p>
      ) : (
        <ParticipantsTable items={items} base={base} />
      )}
    </section>
  );
}

function ParticipantsTable({ items, base }: { items: ParticipantListItem[]; base: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-zinc-200 text-ink-muted">
          <tr>
            <th scope="col" className="py-2 pr-4 font-medium">Participante</th>
            <th scope="col" className="py-2 pr-4 font-medium">Grupo</th>
            <th scope="col" className="py-2 pr-4 font-medium">Estado</th>
            <th scope="col" className="py-2 pr-4 font-medium">Zona horaria</th>
            <th scope="col" className="py-2 pr-4 font-medium">Protocolo actual</th>
            <th scope="col" className="py-2 pr-4 font-medium">Inscripción en la app</th>
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const href = `${base}/${encodeURIComponent(item.pseudonym)}`;
            return (
              <tr key={item.pseudonym} className="border-b border-zinc-100 align-top">
                <th scope="row" className="py-2 pr-4 font-mono font-normal" translate="no">
                  <Link href={href} className={`underline underline-offset-2 ${focusRing}`}>
                    {item.pseudonym}
                  </Link>
                </th>
                <td className="py-2 pr-4">{item.arm ?? <span className="text-ink-muted">—</span>}</td>
                <td className="py-2 pr-4">
                  {label(PARTICIPANT_STATUS_LABELS, item.status)}
                  {item.withdrawnAt && (
                    <span className="block text-xs text-ink-muted">{formatInstant(item.withdrawnAt, item.timezone)}</span>
                  )}
                </td>
                <td className="py-2 pr-4 font-mono" translate="no">{item.timezone}</td>
                <td className="py-2 pr-4 font-mono" translate="no">
                  {item.protocolLabel ?? <span className="font-sans text-ink-muted">Sin protocolo vigente</span>}
                </td>
                <td className="py-2 pr-4">
                  <EnrollmentSummary state={item.enrollment} timeZone={item.timezone} />
                </td>
                <td className="py-2 whitespace-nowrap">
                  <Link href={`${href}/manage`} className={`underline underline-offset-2 ${focusRing}`} aria-label={`Gestionar ${item.pseudonym}`}>
                    Gestionar
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
