import { cards, collectionItems, jobRuns, priceSnapshots, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test } from "vitest"
import { runNightly } from "./nightly"
import { fakeProvider, makeCard, makeSet, type FakeProvider } from "./testing/fake-provider"
import { ProviderError } from "./types"

let db: Db
let provider: FakeProvider
const now = new Date("2026-11-15T08:00:00Z")
const nas = { runner: "nas", gitSha: "aaa", now } as const

beforeEach(async () => {
  db = await createTestDb()
  provider = fakeProvider({
    sets: [makeSet("a")],
    cards: [makeCard("a-1")],
    priced: [
      { card: makeCard("a-1"), prices: [{ cardId: "a-1", variant: "normal", marketCents: 410, lowCents: 200, cardmarketTrendEurCents: null }] },
    ],
  })
})

test("a clean run syncs, prices owned cards and finishes ok", async () => {
  await runNightly(db, provider, nas)
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  const next = new Date("2026-11-16T08:00:00Z")
  expect(await runNightly(db, provider, { ...nas, now: next })).toEqual({ claimed: true, status: "ok" })
  const runs = await db.select().from(jobRuns)
  expect(runs.find((r) => r.runDate === "2026-11-16")).toMatchObject({ status: "ok", runner: "nas", finishedAt: expect.any(Date) })
  expect(await db.select().from(priceSnapshots)).toMatchObject([{ cardId: "a-1", date: "2026-11-16", marketUsd: 4.1 }])
})

test("the run date is the Chicago calendar date", async () => {
  await runNightly(db, provider, nas)
  const [run] = await db.select().from(jobRuns)
  expect(run?.runDate).toBe("2026-11-15")
})

test("a run already claimed today does nothing", async () => {
  await runNightly(db, provider, nas)
  provider.calls.listSets = 0
  expect(await runNightly(db, provider, { runner: "vercel", gitSha: "bbb", now })).toEqual({ claimed: false })
  expect(provider.calls.listSets).toBe(0)
})

test("a provider failure ends the run as failed with the error recorded", async () => {
  provider.fail.listSets = new ProviderError("pokemontcg.io /sets responded 429", 429)
  const result = await runNightly(db, provider, nas)
  expect(result).toEqual({ claimed: true, status: "failed", error: "pokemontcg.io /sets responded 429" })
  const [run] = await db.select().from(jobRuns)
  expect(run).toMatchObject({ status: "failed", error: "pokemontcg.io /sets responded 429" })
})

test("after a failed run the other runner takes over and succeeds", async () => {
  provider.fail.listSets = new ProviderError("down", 503)
  await runNightly(db, provider, nas)
  provider.fail = {}
  const later = new Date(now.getTime() + 2 * 60 * 60 * 1000)
  expect(await runNightly(db, provider, { runner: "vercel", gitSha: "bbb", now: later })).toEqual({ claimed: true, status: "ok" })
  const [run] = await db.select().from(jobRuns)
  expect(run).toMatchObject({ status: "ok", runner: "vercel", gitSha: "bbb", error: null })
})

test("a price failure keeps the catalog rows from the sync step", async () => {
  await runNightly(db, provider, nas)
  await db.insert(collectionItems).values({ cardId: "a-1", variant: "normal" })
  provider.fail.getPrices = new Error("timeout")
  const result = await runNightly(db, provider, { ...nas, now: new Date("2026-11-16T08:00:00Z") })
  expect(result).toMatchObject({ claimed: true, status: "failed" })
  expect(await db.select().from(cards)).toHaveLength(1)
})
