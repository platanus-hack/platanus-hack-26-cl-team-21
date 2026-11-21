// Entry point for drizzle-kit and for `@observatorio/db`. One module per domain area; database
// objects Drizzle can't express (EXCLUDE constraints, triggers, functions, views) live in the
// custom migration `db/migrations/*_db_rules.sql`.
export * from "./schema/jobs";
export * from "./schema/studies";
export * from "./schema/protocols";
export * from "./schema/participants";
export * from "./schema/devices";
export * from "./schema/sensors";
export * from "./schema/capture";
export * from "./schema/pipeline";
export * from "./schema/self-report";
export * from "./schema/research";
