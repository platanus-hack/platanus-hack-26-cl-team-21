"use client";

import { type ReactNode, useActionState } from "react";
import { type ActionState, IDLE } from "@/lib/enrollment/action-state";
import { EnrollmentCodeNotice } from "@/lib/enrollment/enrollment-code-notice";
import { dangerButtonClass, focusRing, primaryButtonClass } from "@/lib/enrollment/ui";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  /** Opens the confirmation step ("Regenerar código…"). */
  summary: string;
  /** The button that runs the action ("Sí, regenerar el código"). */
  confirmLabel: string;
  tone: "neutral" | "danger";
  /** What the action does and what can't be undone, plus any field the action needs. */
  children: ReactNode;
};

// Two-step action: the summary opens a panel that explains the consequences, and only its
// confirm button submits. A native <details>, so it works and stays keyboard-accessible without
// extra script. The result is announced in a live region; a new enrollment code is shown once.
export function ConfirmAction({ action, summary, confirmLabel, tone, children }: Props) {
  const [state, formAction, pending] = useActionState(action, IDLE);

  return (
    <details className="group rounded-lg border border-zinc-200">
      <summary className={`cursor-pointer rounded-lg px-4 py-3 text-sm font-medium select-none hover:bg-paper-deep ${focusRing}`}>
        {summary}
      </summary>
      <form action={formAction} className="flex flex-col gap-3 border-t border-zinc-200 px-4 py-3">
        <div className="flex flex-col gap-2 text-sm text-ink-muted">{children}</div>
        <div>
          <button type="submit" disabled={pending} className={tone === "danger" ? dangerButtonClass : primaryButtonClass}>
            {pending ? "Guardando…" : confirmLabel}
          </button>
        </div>
        <div aria-live="polite" className="flex flex-col gap-3">
          {state.status === "error" && <p className="text-sm text-red-700">{state.message}</p>}
          {state.status === "done" && <p className="text-sm text-emerald-800">{state.message}</p>}
        </div>
        {state.status === "done" && state.pseudonym && state.enrollmentCode && (
          <EnrollmentCodeNotice pseudonym={state.pseudonym} code={state.enrollmentCode} />
        )}
      </form>
    </details>
  );
}
