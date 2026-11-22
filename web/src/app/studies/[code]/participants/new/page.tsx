import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { createParticipantAction } from "@/lib/enrollment/actions";
import { getNewParticipantDefaults } from "@/lib/enrollment/queries";
import { DEFAULT_TIME_ZONE, TIME_ZONES } from "@/lib/enrollment/time-zones";
import { focusRing } from "@/lib/enrollment/ui";
import { getStudyByCode } from "@/lib/queries/studies";
import { CreateParticipantForm } from "./create-participant-form";

type Props = PageProps<"/studies/[code]/participants/new">;

export default function NewParticipantPage({ params }: Props) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando…</p>}>
      <NewParticipant params={params} />
    </Suspense>
  );
}

async function NewParticipant({ params }: Pick<Props, "params">) {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  const defaults = await getNewParticipantDefaults(study.id);
  const base = `/studies/${encodeURIComponent(study.code)}/participants`;

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      <nav aria-label="Ruta" className="text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={base} className={`hover:underline ${focusRing}`}>
          Participantes
        </Link>{" "}
        <span aria-hidden>/</span> Nuevo
      </nav>
      <h2 className="text-lg font-semibold">Nuevo participante</h2>
      {defaults.versions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
          Este estudio no tiene ninguna versión de protocolo publicada. Publica una antes de crear participantes: cada participante
          registra bajo qué versión se le observó.
        </p>
      ) : (
        <CreateParticipantForm
          action={createParticipantAction.bind(null, study.code)}
          defaults={defaults}
          defaultTimeZone={DEFAULT_TIME_ZONE}
          timeZones={TIME_ZONES}
          participantsHref={base}
        />
      )}
    </section>
  );
}
