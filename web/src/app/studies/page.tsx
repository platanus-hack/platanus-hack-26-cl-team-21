import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { label, STUDY_STATUS_LABELS } from "@/components/format";
import { listStudies } from "@/lib/queries/studies";

export const metadata: Metadata = { title: "Estudios · Observatorio Longitudinal Multimodal" };

export default function StudiesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Estudios</h1>
      <Suspense fallback={<p className="text-sm text-neutral-500">Cargando estudios…</p>}>
        <StudyList />
      </Suspense>
    </div>
  );
}

async function StudyList() {
  await connection();
  const studies = await listStudies();
  if (studies.length === 0) {
    return <p className="text-sm text-neutral-500">Todavía no hay estudios.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-neutral-200 text-neutral-500 dark:border-neutral-800">
          <tr>
            <th className="py-2 pr-4 font-medium">Código</th>
            <th className="py-2 pr-4 font-medium">Título</th>
            <th className="py-2 pr-4 font-medium">Estado</th>
            <th className="py-2 text-right font-medium">Participantes</th>
          </tr>
        </thead>
        <tbody>
          {studies.map((study) => (
            <tr key={study.code} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-4 font-mono">
                <Link href={`/studies/${encodeURIComponent(study.code)}`} className="underline underline-offset-2">
                  {study.code}
                </Link>
              </td>
              <td className="py-2 pr-4">{study.title}</td>
              <td className="py-2 pr-4">{label(STUDY_STATUS_LABELS, study.status)}</td>
              <td className="py-2 text-right tabular-nums">{study.participantCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
