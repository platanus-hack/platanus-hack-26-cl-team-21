"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { BUTTON_PRIMARY } from "@/lib/ui";

// Next 16.4 passes `retry` (re-fetches and re-renders the segment); see node_modules/next/dist/docs error.md.
export default function StudiesError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const digest = error instanceof Error && "digest" in error ? String(error.digest) : null;

  return (
    <div role="alert" className="flex flex-col items-start gap-3 py-8">
      <h2 className="font-serif text-2xl font-medium">No se pudieron cargar los datos</h2>
      <p className="text-ink-muted">Puede ser un problema momentáneo con la base de datos. Vuelve a intentarlo.</p>
      {digest && (
        <p className="text-sm text-ink-muted">
          Código del error: <code className="font-mono">{digest}</code>
        </p>
      )}
      <button type="button" onClick={() => retry()} className={BUTTON_PRIMARY}>
        Reintentar
      </button>
    </div>
  );
}
