"use client";

import { type ReactNode, useActionState, useEffect, useRef, useState } from "react";
import { type ActionState, IDLE } from "@/lib/protocols/model";
import { ActionFeedback } from "../action-feedback";
import { dangerButton, secondaryButton } from "../styles";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * A one-button action on a version (retire, delete a draft) that asks for confirmation inline
 * first. `children` explains what will happen; it is shown with the confirm button.
 */
export function ConfirmActionForm({
  action,
  studyCode,
  versionId,
  triggerLabel,
  confirmLabel,
  pendingLabel,
  success,
  children,
}: {
  action: Action;
  studyCode: string;
  versionId: string;
  triggerLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  success?: string;
  children: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [confirming, setConfirming] = useState(false);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="study_code" value={studyCode} />
      <input type="hidden" name="version_id" value={versionId} />
      {confirming ? (
        <Confirmation confirmLabel={confirmLabel} pendingLabel={pendingLabel} pending={pending} onCancel={() => setConfirming(false)}>
          {children}
        </Confirmation>
      ) : (
        <div>
          <button type="button" onClick={() => setConfirming(true)} className={secondaryButton}>
            {triggerLabel}
          </button>
        </div>
      )}
      <ActionFeedback state={state} success={success} />
    </form>
  );
}

function Confirmation({
  confirmLabel,
  pendingLabel,
  pending,
  onCancel,
  children,
}: {
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  onCancel: () => void;
  children: ReactNode;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  return (
    <div role="group" aria-label={confirmLabel} className="flex flex-col gap-2 rounded-md bg-red-50 px-3 py-3 text-sm text-red-950">
      {children}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={dangerButton}>
          {pending ? pendingLabel : confirmLabel}
        </button>
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={pending} className={secondaryButton}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
