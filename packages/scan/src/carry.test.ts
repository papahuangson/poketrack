import { scanResults, scans, type Condition, type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test } from "vitest"
import { carryOver } from "./carry"
import { seed } from "./testing"

let db: Db

beforeEach(async () => {
  db = await createTestDb()
  await seed(
    db,
    [{ id: "sv3pt5", printedTotal: 165 }, { id: "base1", printedTotal: 102 }],
    [
      { id: "sv3pt5-199", name: "Charizard ex", setId: "sv3pt5", number: "199", variants: ["normal", "holofoil"] },
      { id: "base1-58", name: "Pikachu", setId: "base1", number: "58" },
    ],
  )
})

type Seeded = { card?: string; variant?: string; condition?: Condition; empty?: boolean; decision?: "confirmed" | "rejected"; removed?: boolean }

async function committed(pockets: Seeded[], page = 3, status: "committed" | "superseded" | "ready" = "committed") {
  const [scan] = await db
    .insert(scans)
    .values({ imageUrl: "https://x.test/p.jpg", imageWidth: 10, imageHeight: 10, binder: "Main", page, status })
    .returning({ id: scans.id })
  await db.insert(scanResults).values(
    pockets.map((p, i) => ({
      scanId: scan!.id,
      slot: i + 1,
      empty: p.empty ?? false,
      chosenCardId: p.card ?? null,
      variant: p.card ? (p.variant ?? "normal") : null,
      condition: p.condition ?? ("NM" as const),
      decision: p.decision ?? (p.card ? ("confirmed" as const) : ("pending" as const)),
      removedAt: p.removed ? new Date() : null,
    })),
  )
}

const main = { binder: "Main", page: 3 }
const row = (slot: number, chosenCardId: string | null, empty = false) => ({ slot, chosenCardId, empty })

test("same card in the same slot carries variant and condition", async () => {
  await committed([{ card: "sv3pt5-199", variant: "holofoil", condition: "LP" }, { card: "base1-58", condition: "MP" }])
  expect(await carryOver(db, main, [row(1, "sv3pt5-199"), row(2, "base1-58")])).toEqual([
    { variant: "holofoil", condition: "LP" },
    { variant: "normal", condition: "MP" },
  ])
})

test("results line up with the rows given, not with slot order", async () => {
  await committed([{ card: "sv3pt5-199", variant: "holofoil", condition: "LP" }, { card: "base1-58", condition: "MP" }])
  expect(await carryOver(db, main, [row(2, "base1-58"), row(1, "sv3pt5-199")])).toEqual([
    { variant: "normal", condition: "MP" },
    { variant: "holofoil", condition: "LP" },
  ])
})

test("different card, empty slot, removed pocket or no committed scan gives null", async () => {
  expect(await carryOver(db, main, [row(1, "base1-58")])).toEqual([null])
  await committed([
    { card: "sv3pt5-199", condition: "LP" },
    { empty: true },
    { card: "base1-58", condition: "LP", removed: true },
    { card: "base1-58", condition: "LP", decision: "rejected" },
    { card: "base1-58", condition: "LP" },
  ])
  expect(
    await carryOver(db, main, [row(1, "base1-58"), row(2, "base1-58"), row(3, "base1-58"), row(4, "base1-58"), row(5, null, true), row(6, "base1-58")]),
  ).toEqual([null, null, null, null, null, null])
  expect(await carryOver(db, { binder: "Main", page: 4 }, [row(5, "base1-58")])).toEqual([null])
  expect(await carryOver(db, { binder: "Trade", page: 3 }, [row(5, "base1-58")])).toEqual([null])
  expect(await carryOver(db, main, [])).toEqual([])
})

test("only the committed scan counts", async () => {
  await committed([{ card: "base1-58", condition: "HP" }], 3, "superseded")
  await committed([{ card: "base1-58", condition: "DMG" }], 3, "ready")
  expect(await carryOver(db, main, [row(1, "base1-58")])).toEqual([null])
})

test("binder matches case-insensitively", async () => {
  await committed([{ card: "base1-58", condition: "LP" }])
  expect(await carryOver(db, { binder: " main ", page: 3 }, [row(1, "base1-58")])).toEqual([{ variant: "normal", condition: "LP" }])
})
