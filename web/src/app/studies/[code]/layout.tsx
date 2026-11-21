import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { label, STUDY_STATUS_LABELS } from "@/components/format";
import { StudyTabs } from "@/components/study-tabs";
import { getStudyByCode } from "@/lib/queries/studies";

export default function StudyLayout({ children, params }: LayoutProps<"/studies/[code]">) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<div className="h-24" aria-hidden />}>
        <StudyHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function StudyHeader({ params }: { params: LayoutProps<"/studies/[code]">["params"] }) {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  return (
    <header className="flex flex-col gap-3">
      <div>
        <p className="font-mono text-xs text-neutral-500">
          {study.code} · {label(STUDY_STATUS_LABELS, study.status)}
        </p>
        <h1 className="text-2xl font-semibold">{study.title}</h1>
      </div>
      <StudyTabs code={study.code} />
    </header>
  );
}
