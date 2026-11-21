import Link from "next/link";

export default function ParticipantNotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <h2 className="font-serif text-2xl font-medium">Participante no encontrado</h2>
      <p className="mt-2 text-ink-muted">El estudio o el seudónimo no existen.</p>
      <Link href="/" className="mt-4 inline-block underline">
        Volver al inicio
      </Link>
    </div>
  );
}
