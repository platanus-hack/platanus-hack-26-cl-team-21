// Errors of the protocol actions, said in Spanish to the researcher.

/** An expected rejection (validation, wrong state): its messages are shown as they are. */
export class ProtocolActionError extends Error {
  constructor(readonly messages: string[]) {
    super(messages.join(" "));
  }
}

export const IMMUTABLE_MESSAGE =
  "Esta versión ya está publicada o retirada y no se puede modificar. Para cambiar el método, cópiala como un nuevo borrador.";

export const STALE_MESSAGE =
  "Este borrador cambió (en otra pestaña o por otra persona) desde que abriste esta página. No se guardó nada: recarga la página para ver la versión guardada.";

type PgError = { code?: string; constraint?: string; message?: string };

// Drizzle wraps the driver error (DrizzleQueryError.cause); walk the chain to the one with a SQLSTATE.
function findPgError(error: unknown): PgError | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current === "object" && typeof (current as PgError).code === "string") return current as PgError;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Turns any error thrown by an action into the messages the form shows. */
export function describeActionError(error: unknown, context: { versionLabel?: string } = {}): string[] {
  if (error instanceof ProtocolActionError) return error.messages;
  const pg = findPgError(error);
  // The constraint is protocol_versions_studyId_versionLabel_unique (Drizzle keeps the camelCase names).
  if (pg?.code === "23505" && /version_?label/i.test(pg.constraint ?? "")) {
    return [`Ya existe una versión con la etiqueta «${context.versionLabel ?? ""}» en este estudio. Elige otra.`];
  }
  // RAISE EXCEPTION in the immutability triggers (db/migrations/0002_db_rules.sql).
  if (pg?.code === "P0001") {
    const message = pg.message ?? "";
    if (message.includes("cannot be deleted")) return ["La base de datos rechazó el cambio: solo se pueden eliminar borradores."];
    if (message.includes("immutable") || message.includes("publish a new version")) {
      return [`La base de datos rechazó el cambio. ${IMMUTABLE_MESSAGE}`];
    }
    if (message.includes("is a draft")) return ["La base de datos rechazó el cambio: un borrador no se puede asignar ni usar en el pipeline."];
  }
  if (pg?.code === "23503") {
    return ["La base de datos rechazó el cambio: hay registros (anotaciones, asignaciones u otros) que dependen de esta versión."];
  }
  console.error("protocol action failed", error);
  return [
    pg?.code
      ? `La base de datos rechazó el cambio (código ${pg.code}). No se guardó nada.`
      : "No se pudo completar la acción. No se guardó nada; intenta de nuevo.",
  ];
}
