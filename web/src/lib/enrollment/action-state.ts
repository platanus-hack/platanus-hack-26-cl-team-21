// Result of a participant/enrollment Server Action, as rendered by the forms. Kept out of
// ./actions.ts because a "use server" module can only export async functions.

export type ActionState =
  | { status: "idle" }
  | { status: "error"; message: string; values?: Record<string, string> }
  /** `enrollmentCode` is only returned right after it is generated: the UI shows it this once. */
  | { status: "done"; message: string; pseudonym?: string; enrollmentCode?: string };

export const IDLE: ActionState = { status: "idle" };
