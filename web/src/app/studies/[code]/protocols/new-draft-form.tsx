"use client";

import { type ReactNode, useActionState } from "react";
import { createDraftAction } from "@/lib/protocols/actions";
import { IDLE } from "@/lib/protocols/model";
import { ActionFeedback } from "./action-feedback";
import { submitWithoutReset } from "./submit-without-reset";
import { hintClass, inputClass, labelClass, primaryButton } from "./styles";

const LABEL_HINT = "Letras, números, punto, guion o guion bajo, sin espacios. Es única en el estudio.";

/**
 * Creates a draft and opens it. The base control is passed in: a select of versions on the list
 * page (CopySourceSelect), a fixed version on a version page (FixedCopySource).
 */
export function NewDraftForm({
  studyCode,
  suggestedLabel,
  submitLabel,
  children,
}: {
  studyCode: string;
  suggestedLabel: string;
  submitLabel: string;
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState(createDraftAction, IDLE);
  return (
    <form onSubmit={submitWithoutReset(action)} className="flex flex-col gap-3">
      <input type="hidden" name="study_code" value={studyCode} />
      <div className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          Etiqueta de la nueva versión
          <input
            name="version_label"
            required
            defaultValue={suggestedLabel}
            autoComplete="off"
            spellCheck={false}
            maxLength={63}
            pattern="[A-Za-z0-9][A-Za-z0-9._\-]*"
            title={LABEL_HINT}
            className={`${inputClass} font-mono`}
          />
        </label>
        {children}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? "Creando…" : submitLabel}
        </button>
      </div>
      <p className={hintClass}>{LABEL_HINT}</p>
      <ActionFeedback state={state} />
    </form>
  );
}

export function CopySourceSelect({ versions }: { versions: { id: string; versionLabel: string; statusLabel: string }[] }) {
  return (
    <label className={labelClass}>
      Partir de
      <select name="base_version_id" autoComplete="off" defaultValue={versions[0]?.id ?? ""} className={inputClass}>
        {versions.map((version) => (
          <option key={version.id} value={version.id}>
            Copia de {version.versionLabel} ({version.statusLabel.toLowerCase()})
          </option>
        ))}
        <option value="">Desde cero (vacío)</option>
      </select>
    </label>
  );
}

export function FixedCopySource({ versionId }: { versionId: string }) {
  return <input type="hidden" name="base_version_id" value={versionId} />;
}
