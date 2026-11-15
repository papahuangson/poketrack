import { jobRuns, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { expect, test } from "vitest"
import { formatDuration, recentRuns, runnerShaMismatch, type JobRun } from "./job-runs"

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

test("different shas on the latest ok run of each runner are a mismatch", () => {
  const runs = [run({ runDate: "2026-11-14", runner: "vercel", gitSha: "bbb" }), run({ runDate: "2026-11-13", runner: "nas", gitSha: "aaa" })]
  expect(runnerShaMismatch(runs)).toEqual({ nas: "aaa", vercel: "bbb" })
})

test("the same sha is not a mismatch", () => {
  const runs = [run({ runner: "vercel", gitSha: "aaa" }), run({ runDate: "2026-11-13", runner: "nas", gitSha: "aaa" })]
  expect(runnerShaMismatch(runs)).toBeNull()
})

test("one runner alone is not a mismatch", () => {
  expect(runnerShaMismatch([run({}), run({ runDate: "2026-11-13" })])).toBeNull()
  expect(runnerShaMismatch([])).toBeNull()
})

test("a failed run is skipped in favor of that runner's latest ok run", () => {
  const runs = [
    run({ runDate: "2026-11-14", runner: "vercel", gitSha: "aaa", status: "failed" }),
    run({ runDate: "2026-11-13", runner: "nas", gitSha: "aaa" }),
    run({ runDate: "2026-11-12", runner: "vercel", gitSha: "old" }),
  ]
  expect(runnerShaMismatch(runs)).toEqual({ nas: "aaa", vercel: "old" })
})

test("an unknown sha is never reported as a mismatch", () => {
  const runs = [run({ runner: "vercel", gitSha: "unknown" }), run({ runDate: "2026-11-13", runner: "nas", gitSha: "aaa" })]
  expect(runnerShaMismatch(runs)).toBeNull()
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
