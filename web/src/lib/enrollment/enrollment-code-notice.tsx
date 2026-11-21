"use client";

import { useState } from "react";
import { focusRing } from "./ui";

// Shows a freshly generated enrollment code. It only exists in the action's response: reloading
// the page loses it, and the portal never shows it again (regenerate it if it gets lost).
export function EnrollmentCodeNotice({ pseudonym, code }: { pseudonym: string; code: string }) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/40">
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">Código de inscripción de {pseudonym}</p>
      <div className="flex flex-wrap items-center gap-3">
        <output className="font-mono text-2xl font-semibold tracking-wide break-all text-zinc-900 select-all dark:text-zinc-50" translate="no">
          {code}
        </output>
        <button
          type="button"
          onClick={copy}
          className={`rounded-md border border-emerald-400 px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-200 dark:hover:bg-emerald-900 ${focusRing}`}
        >
          Copiar
        </button>
        <span aria-live="polite" className="text-xs text-emerald-900 dark:text-emerald-300">
          {copied === "copied" ? "Copiado" : copied === "failed" ? "No se pudo copiar: selecciónalo y cópialo a mano" : ""}
        </span>
      </div>
      <p className="text-sm text-emerald-900 dark:text-emerald-200">
        <strong>Entrégalo al participante</strong> para que lo ingrese una vez en la app. Solo se muestra ahora: si se pierde, regenéralo
        desde la página de gestión del participante. Sirve una sola vez.
      </p>
    </div>
  );
}
