import type { Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test, vi } from "vitest"
import { seedCards, seedScan } from "@/lib/scan-fixtures"

let db: Db
const priceIfMissing = vi.fn()
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error("NEXT_REDIRECT"), { to })
})
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }))
vi.mock("@/lib/db", () => ({ getDb: () => db }))
vi.mock("@/lib/price-on-add", () => ({ priceIfMissing: (...a: unknown[]) => priceIfMissing(...a) }))

const { commitScanAction } = await import("./actions")

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
  priceIfMissing.mockReset()
})

test("commit prices each distinct card once, then goes to the collection", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }, { card: "base1-58" }, { card: "sv3pt5-151" }] })
  await expect(commitScanAction(scanId)).rejects.toMatchObject({ to: `/?scanned=${scanId}` })
  expect(priceIfMissing.mock.calls.map((c) => c[0]).sort()).toEqual(["base1-58", "sv3pt5-151"])
})

test("a price failure doesn't undo the add", async () => {
  priceIfMissing.mockRejectedValue(new Error("down"))
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58" }] })
  await expect(commitScanAction(scanId)).rejects.toMatchObject({ to: `/?scanned=${scanId}` })
})

test("a validation failure comes back as a message", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ card: "base1-58", decision: "pending" }] })
  expect(await commitScanAction(scanId)).toMatchObject({ ok: false, field: "scan" })
})
