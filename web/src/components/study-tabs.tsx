"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function StudyTabs({ code }: { code: string }) {
  const pathname = usePathname();
  const base = `/studies/${encodeURIComponent(code)}`;
  const within = (path: string) => pathname === path || pathname.startsWith(`${path}/`);
  // Participant pages (/participants/*) have no tab of their own: none is highlighted there, and the
  // page shows a "Resumen / Participante" breadcrumb instead.
  const tabs = [
    { href: base, label: "Resumen", active: pathname === base },
    { href: `${base}/observations`, label: "Observaciones", active: within(`${base}/observations`) },
    { href: `${base}/export`, label: "Exportar", active: within(`${base}/export`) },
  ];
  return (
    <nav aria-label="Secciones del estudio" className="flex gap-1 border-b border-neutral-200 dark:border-neutral-800">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${
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
