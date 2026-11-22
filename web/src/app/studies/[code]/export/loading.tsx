import { Loading, SkeletonBar, SkeletonTable } from "@/components/skeleton";

export default function ExportLoading() {
  return (
    <Loading label="Cargando exportación…">
      <SkeletonBar className="h-6 w-48" />
      <SkeletonBar className="h-20 w-full max-w-3xl" />
      <SkeletonBar className="h-56 w-full" />
      <SkeletonTable rows={3} />
    </Loading>
  );
}
