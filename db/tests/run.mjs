// Runs tests/rules.sql inside a transaction that is always rolled back, then prints the results.
// Usage: npm run db:test   (needs DATABASE_URL and migrated schema)
import { existsSync, readFileSync } from "node:fs";
import pg from "pg";

if (existsSync("../.env")) process.loadEnvFile("../.env");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let failed = 0;
try {
  await client.query("begin");
  await client.query(readFileSync(new URL("./rules.sql", import.meta.url), "utf8"));
  const { rows } = await client.query("select r from results order by n");
  for (const { r } of rows) console.log(r);
  failed = rows.filter(({ r }) => r.startsWith("FAIL")).length;
  console.log(`\n${rows.length - failed} ok, ${failed} failed`);
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}
process.exitCode = failed ? 1 : 0;
