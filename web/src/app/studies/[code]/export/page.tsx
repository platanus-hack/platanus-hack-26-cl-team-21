import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { findExportStudy, listParticipantPseudonyms, listStudyExports } from "@/lib/export/queries";
import { ExportForm } from "./export-form";
import { ExportHistory } from "./export-history";

type Props = PageProps<"/studies/[code]/export">;

export default function ExportPage({ params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Exportar datos</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Genera un archivo con las observaciones actuales y los intervalos de cobertura del estudio. Cada fila trae su procedencia:
          versión del protocolo, modelo y pipeline, dispositivo y firmware, y los clips de evidencia con su sha256. El tiempo no
          observado está en los intervalos de cobertura: la ausencia de una observación en ese tiempo no es un cero. La confianza se
          exporta como <span className="font-mono" translate="no">model_confidence</span>, salida del modelo, no una probabilidad calibrada.
        </p>
      </section>
      <Suspense fallback={<p className="text-sm text-zinc-500 dark:text-zinc-400">Cargando…</p>}>
        <ExportContent params={params} />
      </Suspense>
    </div>
  );
}

async function ExportContent({ params }: Pick<Props, "params">) {
  await connection();
  const { code } = await params;
  const study = await findExportStudy(code);
  if (!study) notFound();
  const [participants, history] = await Promise.all([listParticipantPseudonyms(study.id), listStudyExports(study.id)]);

  return (
    <>
      <ExportForm action={`/api/studies/${encodeURIComponent(study.code)}/export`} participants={participants} />
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Exportaciones anteriores</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          Los archivos todavía no se guardan en el servidor: para obtener uno de nuevo, vuelve a generarlo con los mismos parámetros. El
          sha256 permite verificar que una copia guardada no fue modificada.
        </p>
        <ExportHistory items={history} />
      </section>
    </>
  );
}
