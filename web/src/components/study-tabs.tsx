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
    { href: `${base}/participants`, label: "Participantes", active: pathname === `${base}/participants` || within(`${base}/participants/new`) },
    { href: `${base}/export`, label: "Exportar", active: within(`${base}/export`) },
    { href: `${base}/protocols`, label: "Protocolo", active: within(`${base}/protocols`) },
  ];
  return (
    <nav aria-label="Secciones del estudio" className="flex flex-wrap gap-x-1 border-b border-rule">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.active ? "page" : undefined}
          className={`-mb-px inline-flex min-h-10 items-center border-b-2 px-3 text-sm ${
            tab.active
              ? "border-secondary font-medium"
              : "border-transparent text-ink-muted hover:text-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
