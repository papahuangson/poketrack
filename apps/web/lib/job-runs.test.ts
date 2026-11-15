import { jobRuns, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { expect, test } from "vitest"
import { formatDuration, recentRuns, nasBehind, type JobRun } from "./job-runs"

function run(over: Partial<JobRun>): JobRun {
  return {
    id: 1,
    job: "nightly",
    runDate: "2026-11-14",
    runner: "nas",
    gitSha: "aaa",
    status: "ok",
    startedAt: new Date("2026-11-14T08:00:00Z"),
    finishedAt: new Date("2026-11-14T08:01:05Z"),
    error: null,
    ...over,
  }
}

test("a NAS that last ran a different version than the site is behind", () => {
  expect(nasBehind([run({ gitSha: "aaa" })], "bbb")).toEqual({ nas: "aaa", site: "bbb" })
})

test("a NAS on the site's version is not behind", () => {
  expect(nasBehind([run({ gitSha: "aaa" })], "aaa")).toBeNull()
})

test("Vercel runs and failed NAS runs are ignored in favor of the latest ok NAS run", () => {
  const runs = [
    run({ runDate: "2026-11-14", runner: "vercel", gitSha: "bbb" }),
    run({ runDate: "2026-11-13", runner: "nas", gitSha: "zzz", status: "failed" }),
    run({ runDate: "2026-11-12", runner: "nas", gitSha: "bbb" }),
  ]
  expect(nasBehind(runs, "bbb")).toBeNull()
})

test("with no NAS run or no known version there is nothing to compare", () => {
  expect(nasBehind([], "bbb")).toBeNull()
  expect(nasBehind([run({ runner: "vercel", gitSha: "aaa" })], "bbb")).toBeNull()
  expect(nasBehind([run({ gitSha: "unknown" })], "bbb")).toBeNull()
  expect(nasBehind([run({ gitSha: "aaa" })], undefined)).toBeNull()
})

test("recentRuns returns the newest runs first, up to the limit", async () => {
  const db: Db = await createTestDb()
  for (let day = 1; day <= 16; day++) {
    await db.insert(jobRuns).values({ job: "nightly", runDate: `2026-11-${String(day).padStart(2, "0")}`, runner: "nas", gitSha: "aaa", status: "ok" })
  }
  const runs = await recentRuns(db)
  expect(runs).toHaveLength(14)
  expect(runs[0]?.runDate).toBe("2026-11-16")
  expect(runs[13]?.runDate).toBe("2026-11-03")
})

test("durations read in seconds or minutes, and running shows as in progress", () => {
  expect(formatDuration(run({}))).toBe("1m 5s")
  expect(formatDuration(run({ finishedAt: new Date("2026-11-14T08:00:42Z") }))).toBe("42s")
  expect(formatDuration(run({ finishedAt: null, status: "running" }))).toBe("In progress")
})
