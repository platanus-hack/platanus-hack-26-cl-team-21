import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { findExportStudy, listParticipantPseudonyms, listStudyExports } from "@/lib/export/queries";
import { ExportForm } from "./export-form";
import { ExportHistory } from "./export-history";

type Props = PageProps<"/studies/[code]/export">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  return { title: `Exportar · ${code}` };
}

export default async function ExportPage({ params }: Props) {
  await connection();
  const { code } = await params;
  const study = await findExportStudy(code);
  if (!study) notFound();
  const [participants, history] = await Promise.all([listParticipantPseudonyms(study.id), listStudyExports(study.id)]);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-lg font-medium">Exportar datos</h2>
        <p className="max-w-3xl text-sm text-ink-muted">Genera un archivo con las observaciones actuales y los intervalos de cobertura del estudio.</p>
        <ul className="max-w-3xl list-disc space-y-1 pl-5 text-sm text-ink-muted">
          <li>
            Cada fila trae su procedencia: versión del protocolo, modelo y pipeline, dispositivo y firmware, y los clips de evidencia con su
            sha256.
          </li>
          <li>El tiempo no observado está en los intervalos de cobertura: la ausencia de una observación en ese tiempo no es un cero.</li>
          <li>
            La confianza se exporta como <code className="font-mono" translate="no">model_confidence</code>: es la salida del modelo, no una
            probabilidad calibrada.
          </li>
        </ul>
      </section>
      <ExportForm action={`/api/studies/${encodeURIComponent(study.code)}/export`} participants={participants} />
      <section className="flex flex-col gap-2">
        <h2 className="font-serif text-lg font-medium">Exportaciones anteriores</h2>
        <p className="max-w-3xl text-sm text-ink-muted">
          Los archivos todavía no se guardan en el servidor: para obtener uno de nuevo, vuelve a generarlo con los mismos parámetros. El sha256
          permite verificar que una copia guardada no fue modificada.
        </p>
        <ExportHistory items={history} />
      </section>
    </div>
  );
}
