import { connection } from "next/server";
import { db, sql } from "@observatorio/db";

export async function GET() {
  await connection(); // never prerender at build: needs the live DB
  try {
    await db.execute(sql`select 1`);
    return Response.json({ status: "ok", db: "ok" });
  } catch (error) {
    console.error("health: db unreachable", error);
    return Response.json({ status: "error", db: "unreachable" }, { status: 503 });
  }
}
