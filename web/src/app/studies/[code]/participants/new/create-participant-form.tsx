"use client";

import Link from "next/link";
import { useActionState } from "react";
import { type ActionState, IDLE } from "@/lib/enrollment/action-state";
import { EnrollmentCodeNotice } from "@/lib/enrollment/enrollment-code-notice";
import type { NewParticipantDefaults } from "@/lib/enrollment/queries";
import { focusRing, hintClass, inputClass, labelClass, primaryButtonClass } from "@/lib/enrollment/ui";
import { formatDate } from "@/lib/format";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  defaults: NewParticipantDefaults;
  defaultTimeZone: string;
  timeZones: readonly string[];
  participantsHref: string;
};

export function CreateParticipantForm({ action, defaults, defaultTimeZone, timeZones, participantsHref }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  if (state.status === "done" && state.pseudonym && state.enrollmentCode) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-400">
          {state.message}
        </p>
        <EnrollmentCodeNotice pseudonym={state.pseudonym} code={state.enrollmentCode} />
        <div className="flex flex-wrap gap-4 text-sm">
          <Link href={`${participantsHref}/${encodeURIComponent(state.pseudonym)}/manage`} className={`underline underline-offset-2 ${focusRing}`}>
            Gestionar {state.pseudonym}
          </Link>
          <Link href={participantsHref} className={`underline underline-offset-2 ${focusRing}`}>
            Volver a participantes
          </Link>
        </div>
      </div>
    );
  }

  // After a refused submission the fields keep what was sent.
  const values = state.status === "error" ? state.values : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>
          Seudónimo
          <input
            name="pseudonym"
            required
            defaultValue={values?.pseudonym ?? defaults.suggestedPseudonym}
            pattern="[A-Za-z]{1,4}-[0-9]{2,5}"
            maxLength={10}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="pseudonym-hint"
            className={`font-mono ${inputClass}`}
          />
          <span id="pseudonym-hint" className={`font-normal ${hintClass}`}>
            Sugerido: el siguiente libre. Nunca uses nombres ni otros datos personales.
          </span>
        </label>
        <label className={labelClass}>
          Grupo (opcional)
          <input
            name="arm"
            defaultValue={values?.arm ?? ""}
            maxLength={40}
            list="arm-options"
            autoComplete="off"
            aria-describedby="arm-hint"
            className={inputClass}
          />
          <datalist id="arm-options">
            {defaults.arms.map((arm) => (
              <option key={arm} value={arm} />
            ))}
          </datalist>
          <span id="arm-hint" className={`font-normal ${hintClass}`}>
            Brazo o grupo del estudio, si lo hay.
          </span>
        </label>
        <label className={labelClass}>
          Zona horaria
          <select name="timezone" required autoComplete="off" defaultValue={values?.timezone ?? defaultTimeZone} aria-describedby="timezone-hint" className={inputClass}>
            {timeZones.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
          <span id="timezone-hint" className={`font-normal ${hintClass}`}>
            Define el día local del participante en la línea de tiempo y la exportación.
          </span>
        </label>
        <label className={labelClass}>
          Versión de protocolo
          <select
            name="protocolVersionId"
            autoComplete="off"
            required
            defaultValue={values?.protocolVersionId ?? defaults.versions[0]?.id}
            aria-describedby="protocol-hint"
            className={inputClass}
          >
            {defaults.versions.map((version) => (
              <option key={version.id} value={version.id}>
                {version.label}
                {version.publishedAt ? ` · publicada el ${formatDate(version.publishedAt)}` : ""}
              </option>
            ))}
          </select>
          <span id="protocol-hint" className={`font-normal ${hintClass}`}>
            Solo versiones publicadas. Rige desde ahora.
          </span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Creando…" : "Crear participante y generar código"}
        </button>
        <p className={hintClass}>Se genera un código de inscripción de un solo uso para la app.</p>
      </div>

      <div aria-live="polite">
        {state.status === "error" && <p className="text-sm text-red-700 dark:text-red-400">{state.message}</p>}
      </div>
    </form>
  );
}
