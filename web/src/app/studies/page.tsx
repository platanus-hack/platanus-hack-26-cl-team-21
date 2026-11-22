import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { Loading, SkeletonTable } from "@/components/skeleton";
import { NUM, TableFrame, TBody, TD, TH, TH_ROW, TR } from "@/components/data-table";
import { label, STUDY_STATUS_LABELS } from "@/lib/labels";
import { LINK } from "@/lib/ui";
import { listStudies } from "@/lib/queries/studies";

export const metadata: Metadata = { title: "Estudios" };

export default function StudiesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-serif text-3xl font-medium text-primary">Estudios</h1>
      <Suspense
        fallback={
          <Loading label="Cargando estudios…">
            <SkeletonTable />
          </Loading>
        }
      >
        <StudyList />
      </Suspense>
    </div>
  );
}

async function StudyList() {
  await connection();
  const studies = await listStudies();
  if (studies.length === 0) {
    return <p className="text-sm text-ink-muted">Todavía no hay estudios.</p>;
  }
  return (
    <TableFrame caption="Estudios">
      <thead className="text-ink-muted">
        <tr>
          <th scope="col" className={TH}>Código</th>
          <th scope="col" className={TH}>Título</th>
          <th scope="col" className={TH}>Estado</th>
          <th scope="col" className={`${TH} ${NUM}`}>Participantes</th>
        </tr>
      </thead>
      <TBody>
        {studies.map((study) => (
          <tr key={study.code} className={TR}>
            <th scope="row" className={`${TH_ROW} font-mono`}>
              <Link href={`/studies/${encodeURIComponent(study.code)}`} className={`${LINK} [overflow-wrap:anywhere]`}>
                {study.code}
              </Link>
            </th>
            <td className={`${TD} [overflow-wrap:anywhere]`}>{study.title}</td>
            <td className={TD}>{label(STUDY_STATUS_LABELS, study.status)}</td>
            <td className={`${TD} ${NUM}`}>{study.participantCount}</td>
          </tr>
        ))}
      </TBody>
    </TableFrame>
  );
}
