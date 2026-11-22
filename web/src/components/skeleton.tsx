import type { ReactNode } from "react";

// Plain placeholders for loading.tsx (GUIDELINES: no spinners for server-rendered content). They
// mirror the real layout so content replaces them without shifting the page.

export function SkeletonBar({ className }: { className: string }) {
  return <div className={`rounded bg-paper-deep ${className}`} />;
}

export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-rule">
      <div className="h-9 bg-paper-deep" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-t border-rule px-3">
          <SkeletonBar className="h-3 w-24" />
          <SkeletonBar className="h-3 w-40" />
          <SkeletonBar className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

/** Wraps a skeleton so screen readers hear one status message instead of empty boxes. */
export function Loading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden className="flex flex-col gap-6">
        {children}
      </div>
    </div>
  );
}
