import { Loading, SkeletonBar } from "@/components/skeleton";

export default function ParticipantLoading() {
  return (
    <Loading label="Cargando línea de tiempo…">
      <SkeletonBar className="h-4 w-40" />
      <SkeletonBar className="h-8 w-56" />
      <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <SkeletonBar key={i} className="h-12" />
        ))}
      </div>
      <SkeletonBar className="h-28 w-full" />
      {[0, 1].map((i) => (
        <div key={i} className="space-y-4 border-t border-rule pt-6">
          <SkeletonBar className="h-6 w-72" />
          <SkeletonBar className="h-11 w-full" />
          <div className="grid gap-4 md:grid-cols-2">
            <SkeletonBar className="h-32" />
            <SkeletonBar className="h-32" />
          </div>
        </div>
      ))}
    </Loading>
  );
}
