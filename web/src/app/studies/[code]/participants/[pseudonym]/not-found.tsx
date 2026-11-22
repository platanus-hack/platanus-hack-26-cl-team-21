import Link from "next/link";
import { LINK } from "@/lib/ui";

export default function ParticipantNotFound() {
  return (
    <div className="py-8">
      <h2 className="font-serif text-2xl font-medium">Participante no encontrado</h2>
      <p className="mt-2 text-ink-muted">Este estudio no tiene un participante con ese seudónimo.</p>
      <Link href="/studies" className={`mt-4 inline-block ${LINK}`}>
        Ver estudios
      </Link>
    </div>
  );
}
