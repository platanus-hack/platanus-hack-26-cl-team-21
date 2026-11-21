import { db, jobs, eq, inArray } from "@observatorio/db";

// SKIP LOCKED lets several worker instances poll the same table without double-claiming.
export async function claimJob() {
  const next = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(eq(jobs.status, "pending"))
    .orderBy(jobs.id)
    .limit(1)
    .for("update", { skipLocked: true });
  const [job] = await db
    .update(jobs)
    .set({ status: "running", updatedAt: new Date() })
    .where(inArray(jobs.id, next))
    .returning();
  return job;
}

export async function finishJob(id: number, error?: unknown) {
  await db
    .update(jobs)
    .set({ status: error ? "failed" : "done", error: error ? String(error) : null, updatedAt: new Date() })
    .where(eq(jobs.id, id));
}
