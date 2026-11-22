"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, Suspense } from "react";

const BASE = "border-b border-rule";

/**
 * The header floats over the home hero. It keys off the pathname rather than a CSS `:has()` on the
 * hero, because Cache Components keeps the previous route mounted (hidden) after navigating away.
 * The pathname is runtime data, so it streams in behind Suspense; the fallback is the plain header.
 */
export function SiteHeader({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<header className={BASE}>{children}</header>}>
      <PathAwareHeader>{children}</PathAwareHeader>
    </Suspense>
  );
}

function PathAwareHeader({ children }: { children: ReactNode }) {
  const overHero = usePathname() === "/";
  return (
    <header className={BASE} data-over-hero={overHero ? "" : undefined}>
      {children}
    </header>
  );
}
