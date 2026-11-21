import { claimJob, finishJob } from "./jobs";

const POLL_MS = 5_000;
let stopping = false;
// shortcut: a job running during SIGTERM stays 'running'; add a stale-job reaper once jobs take minutes.
process.on("SIGTERM", () => (stopping = true));

async function handle(job: { id: number; type: string; payload: unknown }) {
  switch (job.type) {
    case "hello":
      console.log(`hello from worker, job ${job.id}`);
      return;
    default:
      throw new Error(`unknown job type: ${job.type}`);
  }
}

console.log("worker started");
while (!stopping) {
  const job = await claimJob().catch((e) => console.error("claim failed", e));
  if (!job) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }
  let error: unknown;
  try {
    await handle(job);
  } catch (e) {
    error = e;
    console.error(`job ${job.id} failed`, e);
  }
  // A DB blip here must neither kill the worker nor flip a succeeded job to failed.
  // shortcut: the job then stays 'running'; the stale-job reaper above will cover it.
  await finishJob(job.id, error).catch((e) => console.error(`job ${job.id}: could not save result`, e));
}
process.exit(0);
