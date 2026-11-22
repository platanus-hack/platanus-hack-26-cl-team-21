import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { SkeletonBar } from "@/components/skeleton";
import { StudyTabs } from "@/components/study-tabs";
import { label, STUDY_STATUS_LABELS } from "@/lib/labels";
import { getStudyByCode } from "@/lib/queries/studies";

type Props = LayoutProps<"/studies/[code]">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  return { title: study?.title ?? code };
}

export default function StudyLayout({ children, params }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<StudyHeaderSkeleton />}>
        <StudyHeader params={params} />
      </Suspense>
      {children}
    </div>
  );
}

async function StudyHeader({ params }: { params: Props["params"] }) {
  const { code } = await params;
  await connection();
  const study = await getStudyByCode(code);
  if (!study) notFound();
  return (
    <header className="flex flex-col gap-3">
      <div className="min-w-0">
        <p className="font-mono text-xs text-ink-muted [overflow-wrap:anywhere]" translate="no">
          {study.code} · {label(STUDY_STATUS_LABELS, study.status)}
        </p>
        <h1 className="font-serif text-3xl font-medium text-primary [overflow-wrap:anywhere]">{study.title}</h1>
      </div>
      <StudyTabs code={study.code} />
    </header>
  );
}

/** Same rhythm as the real header (code line, title, tab row), so the tabs don't jump when it loads. */
function StudyHeaderSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <SkeletonBar className="h-3 w-40" />
        <SkeletonBar className="h-8 w-2/3" />
      </div>
      <div className="h-10 border-b border-rule" />
    </div>
  );
}
