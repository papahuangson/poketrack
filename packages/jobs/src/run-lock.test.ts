import { jobRuns, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test } from "vitest"
import { claimRun, finishRun } from "./run-lock"

let db: Db
const t0 = new Date("2026-11-15T08:00:00Z")
const minutesLater = (m: number) => new Date(t0.getTime() + m * 60_000)
const nas = { job: "nightly", runDate: "2026-11-15", runner: "nas", gitSha: "aaa", now: t0 } as const
const vercel = { ...nas, runner: "vercel", gitSha: "bbb" } as const

beforeEach(async () => {
  db = await createTestDb()
})

test("the first claim wins and records the runner", async () => {
  expect(await claimRun(db, nas)).toBe(true)
  const [row] = await db.select().from(jobRuns)
  expect(row).toMatchObject({ runner: "nas", gitSha: "aaa", status: "running" })
})

test("a second claim for the same date loses", async () => {
  await claimRun(db, nas)
  expect(await claimRun(db, { ...vercel, now: minutesLater(30) })).toBe(false)
})

test("a finished run cannot be claimed again", async () => {
  await claimRun(db, nas)
  await finishRun(db, { job: "nightly", runDate: "2026-11-15", status: "ok", now: minutesLater(5) })
  expect(await claimRun(db, { ...vercel, now: minutesLater(120) })).toBe(false)
  const [row] = await db.select().from(jobRuns)
  expect(row?.finishedAt).toEqual(minutesLater(5))
})

test("a failed run can be taken over, which resets it", async () => {
  await claimRun(db, nas)
  await finishRun(db, { job: "nightly", runDate: "2026-11-15", status: "failed", error: "boom", now: minutesLater(5) })
  expect(await claimRun(db, { ...vercel, now: minutesLater(120) })).toBe(true)
  const [row] = await db.select().from(jobRuns)
  expect(row).toMatchObject({ runner: "vercel", gitSha: "bbb", status: "running", error: null, finishedAt: null })
  expect(row?.startedAt).toEqual(minutesLater(120))
})

test("a run stuck for over an hour can be taken over", async () => {
  await claimRun(db, nas)
  expect(await claimRun(db, { ...vercel, now: minutesLater(61) })).toBe(true)
})

test("a run that started under an hour ago cannot be taken over", async () => {
  await claimRun(db, nas)
  expect(await claimRun(db, { ...vercel, now: minutesLater(59) })).toBe(false)
})

test("a different date is a separate run", async () => {
  await claimRun(db, nas)
  expect(await claimRun(db, { ...nas, runDate: "2026-11-16" })).toBe(true)
})

test("of two simultaneous claims exactly one wins", async () => {
  const results = await Promise.all([claimRun(db, nas), claimRun(db, vercel)])
  expect(results.filter(Boolean)).toHaveLength(1)
})

test("a long error is truncated to 2000 characters", async () => {
  await claimRun(db, nas)
  await finishRun(db, { job: "nightly", runDate: "2026-11-15", status: "failed", error: "x".repeat(5000) })
  const [row] = await db.select().from(jobRuns)
  expect(row?.error).toHaveLength(2000)
})
