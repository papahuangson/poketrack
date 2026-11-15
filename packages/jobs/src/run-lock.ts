import { jobRuns, type Db, type Runner } from "@poketrack/db"
import { and, eq, lt, or } from "drizzle-orm"

const STALE_MS = 60 * 60 * 1000
const MAX_ERROR = 2000

type Claim = { job: string; runDate: string; runner: Runner; gitSha: string; now?: Date }
type Finish = { job: string; runDate: string; status: "ok" | "failed"; error?: string; now?: Date }

async function claimRun(db: Db, { job, runDate, runner, gitSha, now = new Date() }: Claim): Promise<boolean> {
  const inserted = await db
    .insert(jobRuns)
    .values({ job, runDate, runner, gitSha, status: "running", startedAt: now })
    .onConflictDoNothing({ target: [jobRuns.job, jobRuns.runDate] })
    .returning({ id: jobRuns.id })
  if (inserted.length > 0) return true

  const takenOver = await db
    .update(jobRuns)
    .set({ runner, gitSha, status: "running", startedAt: now, finishedAt: null, error: null })
    .where(
      and(
        eq(jobRuns.job, job),
        eq(jobRuns.runDate, runDate),
        or(
          eq(jobRuns.status, "failed"),
          and(eq(jobRuns.status, "running"), lt(jobRuns.startedAt, new Date(now.getTime() - STALE_MS))),
        ),
      ),
    )
    .returning({ id: jobRuns.id })
  return takenOver.length > 0
}

async function finishRun(db: Db, { job, runDate, status, error, now = new Date() }: Finish): Promise<void> {
  await db
    .update(jobRuns)
    .set({ status, finishedAt: now, error: error ? error.slice(0, MAX_ERROR) : null })
    .where(and(eq(jobRuns.job, job), eq(jobRuns.runDate, runDate)))
}

export { claimRun, finishRun }
