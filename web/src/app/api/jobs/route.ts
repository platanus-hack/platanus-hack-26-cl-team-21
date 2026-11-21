import { connection } from "next/server";
import { db, jobs } from "@observatorio/db";

// Hello-world enqueue: proves web -> Postgres -> worker. Real job types come later.
export async function POST() {
  await connection();
  const [job] = await db.insert(jobs).values({ type: "hello" }).returning();
  return Response.json(job, { status: 201 });
}
