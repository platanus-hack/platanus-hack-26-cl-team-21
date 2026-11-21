import Link from "next/link";

export default function ParticipantNotFound() {
  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16">
      <h1 className="text-2xl font-semibold">Participante no encontrado</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">El estudio o el seudónimo no existen.</p>
      <Link href="/" className="mt-4 inline-block underline">
        Volver al inicio
      </Link>
    </div>
  );
}
