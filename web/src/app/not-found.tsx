import type { Metadata } from "next";
import Link from "next/link";
import { LINK } from "@/lib/ui";

export const metadata: Metadata = { title: "Página no encontrada" };

export default function NotFound() {
  return (
    <div className="py-8">
      <h1 className="font-serif text-3xl font-medium text-primary">Página no encontrada</h1>
      <p className="mt-2 text-ink-muted">El estudio o la página que buscas no existe.</p>
      <Link href="/studies" className={`mt-4 inline-block ${LINK}`}>
        Ver estudios
      </Link>
    </div>
  );
}
