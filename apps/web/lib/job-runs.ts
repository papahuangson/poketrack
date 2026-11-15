import { jobRuns, type Db } from "@poketrack/db"
import { desc } from "drizzle-orm"

type JobRun = typeof jobRuns.$inferSelect

async function recentRuns(db: Db, limit = 14): Promise<JobRun[]> {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.runDate), desc(jobRuns.id)).limit(limit)
}

function runnerShaMismatch(runs: JobRun[]): { nas: string; vercel: string } | null {
  const latestOk = (runner: JobRun["runner"]) =>
    runs
      .filter((run) => run.runner === runner && run.status === "ok")
      .sort((a, b) => b.runDate.localeCompare(a.runDate))[0]?.gitSha
  const nas = latestOk("nas")
  const vercel = latestOk("vercel")
  if (!nas || !vercel || nas === "unknown" || vercel === "unknown" || nas === vercel) return null
  return { nas, vercel }
}

function formatDuration(run: JobRun): string {
  if (!run.finishedAt) return run.status === "running" ? "In progress" : "—"
  const seconds = Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export { formatDuration, recentRuns, runnerShaMismatch }
export type { JobRun }
