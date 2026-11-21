"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StudyTabs({ code }: { code: string }) {
  const pathname = usePathname();
  const base = `/studies/${encodeURIComponent(code)}`;
  const tabs = [
    // Participant pages are reached from the overview, so they keep "Resumen" active.
    { href: base, label: "Resumen", active: pathname === base || pathname.startsWith(`${base}/participants/`) },
    { href: `${base}/observations`, label: "Observaciones", active: pathname.startsWith(`${base}/observations`) },
  ];
  return (
    <nav aria-label="Secciones del estudio" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${
            tab.active
              ? "border-foreground font-medium"
              : "border-transparent text-neutral-500 hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
