import { formatDate, formatTime } from "@/lib/format";
import { type EnrollmentState, TOKEN_STATE_LABELS } from "./state";

// Small presentational pieces shared by the participant list and the manage page (server-safe).

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400";
// Native controls get an explicit color scheme in dark mode so the select follows it.
export const inputClass = `rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:[color-scheme:dark] ${focusRing}`;
export const labelClass = "flex flex-col gap-1 text-xs font-medium text-zinc-600 dark:text-zinc-400";
export const hintClass = "text-xs text-zinc-500 dark:text-zinc-400";
export const primaryButtonClass = `rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 ${focusRing}`;
export const dangerButtonClass = `rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500 ${focusRing}`;

/** "21 nov 2026, 14:05" in the participant's time zone. */
export function formatInstant(instant: Date, timeZone: string) {
  return `${formatDate(instant, timeZone)}, ${formatTime(instant.getTime(), timeZone)}`;
}

/** Enrollment state in words: code pending, redeemed (and when) and whether the app token is active. */
export function EnrollmentSummary({ state, timeZone }: { state: EnrollmentState; timeZone: string }) {
  switch (state.code) {
    case "none":
      return <span className="text-zinc-500 dark:text-zinc-400">Sin código vigente</span>;
    case "pending":
      return <span>Código pendiente de canje</span>;
    case "redeemed":
      return (
        <span className="flex flex-col">
          <span>Canjeado el {formatInstant(state.redeemedAt, timeZone)}</span>
          <span className={state.token === "active" ? "text-xs text-emerald-800 dark:text-emerald-400" : "text-xs text-zinc-500 dark:text-zinc-400"}>
            {TOKEN_STATE_LABELS[state.token]}
          </span>
        </span>
      );
  }
}
