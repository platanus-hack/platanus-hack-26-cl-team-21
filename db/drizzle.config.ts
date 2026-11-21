import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

// One shared .env at the repo root; never overrides vars already set (e.g. on Render).
if (existsSync("../.env")) process.loadEnvFile("../.env");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  casing: "snake_case",
  dbCredentials: { url: process.env.DATABASE_URL! },
});
