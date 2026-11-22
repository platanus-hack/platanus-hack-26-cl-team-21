"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { protocolsHref } from "../helpers";

// Client component only to read the study code from the URL (not-found receives no params).
export default function ProtocolVersionNotFound() {
  const { code } = useParams<{ code: string }>();
  return (
    <div className="flex flex-col gap-2 py-8">
      <h2 className="text-xl font-semibold">Versión no encontrada</h2>
      <p className="text-ink-muted">
        Este estudio no tiene una versión de protocolo con esa etiqueta. Puede que un borrador se haya renombrado o eliminado.
      </p>
      <Link href={protocolsHref(decodeURIComponent(code))} className="w-fit underline underline-offset-2">
        Ver las versiones del protocolo
      </Link>
    </div>
  );
}
