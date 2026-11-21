// Enrollment state of a participant, derived from participants.enrollment_code,
// enrollment_code_used_at and token_sha256 (ADR 0002 §4). Pages only ever receive this summary:
// never the token hash, and never the code once it was handed out.

export type EnrollmentRow = {
  hasCode: boolean;
  codeUsedAt: Date | null;
  hasToken: boolean;
};

export type EnrollmentState =
  /** No code: withdrawn before redeeming one (withdrawal invalidates it). */
  | { code: "none" }
  /** A code was handed out and the app has not redeemed it yet. */
  | { code: "pending" }
  /** The app redeemed the code; its token is active until a researcher revokes it. */
  | { code: "redeemed"; redeemedAt: Date; token: "active" | "revoked" };

export function enrollmentState({ hasCode, codeUsedAt, hasToken }: EnrollmentRow): EnrollmentState {
  if (codeUsedAt) return { code: "redeemed", redeemedAt: codeUsedAt, token: hasToken ? "active" : "revoked" };
  return hasCode ? { code: "pending" } : { code: "none" };
}

export const TOKEN_STATE_LABELS = {
  active: "Token de la app activo",
  revoked: "Token de la app revocado",
} as const;

/** Participants in these statuses can still receive codes and protocol changes. */
export const OPEN_STATUSES = ["enrolled", "active"] as const;

export function isOpen(status: string) {
  return (OPEN_STATUSES as readonly string[]).includes(status);
}
