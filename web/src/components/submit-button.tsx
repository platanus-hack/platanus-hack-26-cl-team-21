"use client";

import { useFormStatus } from "react-dom";
import { BUTTON_PRIMARY } from "@/lib/ui";
import { ButtonLabel } from "./button-label";

/** Submit button that says so while its <Form> navigation is pending (next/form runs it as a transition). */
export function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" aria-disabled={pending} className={`${BUTTON_PRIMARY} aria-disabled:cursor-progress`}>
      <ButtonLabel idle={idle} busy={busy} isBusy={pending} />
    </button>
  );
}
