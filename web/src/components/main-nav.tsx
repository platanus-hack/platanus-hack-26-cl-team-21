"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

/**
 * The portal's main navigation; the current section is marked for assistive tech, not by color
 * alone. The pathname is runtime data, so with Cache Components it streams in behind a Suspense
 * boundary whose fallback is the same link, unmarked.
 */
export function MainNav() {
  return (
    <nav aria-label="Principal" className="text-sm">
      <Suspense fallback={<StudiesLink current={false} />}>
        <CurrentStudiesLink />
      </Suspense>
    </nav>
  );
}

function CurrentStudiesLink() {
  const pathname = usePathname();
  return <StudiesLink current={pathname === "/studies" || pathname.startsWith("/studies/")} />;
}

function StudiesLink({ current }: { current: boolean }) {
  return (
    <Link
      href="/studies"
      aria-current={current ? "page" : undefined}
      className={`inline-flex min-h-10 items-center ${current ? "font-medium text-ink underline decoration-2 underline-offset-8" : "text-ink-muted hover:text-ink"}`}
    >
      Estudios
    </Link>
  );
}
