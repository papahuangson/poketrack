import { jobRuns, type Db } from "@poketrack/db"
import { desc } from "drizzle-orm"

type JobRun = typeof jobRuns.$inferSelect

async function recentRuns(db: Db, limit = 14): Promise<JobRun[]> {
  return db.select().from(jobRuns).orderBy(desc(jobRuns.runDate), desc(jobRuns.id)).limit(limit)
}

function nasBehind(runs: JobRun[], siteSha: string | undefined): { nas: string; site: string } | null {
  const nas = runs
    .filter((run) => run.runner === "nas" && run.status === "ok")
    .sort((a, b) => b.runDate.localeCompare(a.runDate))[0]?.gitSha
  if (!nas || !siteSha || nas === "unknown" || nas === siteSha) return null
  return { nas, site: siteSha }
}

function formatDuration(run: JobRun): string {
  if (!run.finishedAt) return run.status === "running" ? "In progress" : "—"
  const seconds = Math.max(0, Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000))
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}

export { formatDuration, recentRuns, nasBehind }
export type { JobRun }
