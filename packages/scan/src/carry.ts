import { and, eq, isNull, scanResults, scans, sql, type Condition, type Db } from "@poketrack/db"

type CarryRow = { slot: number; chosenCardId: string | null; empty: boolean }
type Carried = { variant: string; condition: Condition }

// For a rescan: the variant and condition each pocket already has in the page's current committed scan, when the
// new read found the same card in the same slot. Pocket edits in the binder view keep those values up to date.
async function carryOver(db: Db, page: { binder: string; page: number }, rows: CarryRow[]): Promise<(Carried | null)[]> {
  if (rows.length === 0) return []
  const current = await db
    .select({ slot: scanResults.slot, cardId: scanResults.chosenCardId, variant: scanResults.variant, condition: scanResults.condition })
    .from(scanResults)
    .innerJoin(scans, eq(scans.id, scanResults.scanId))
    .where(
      and(
        eq(scans.status, "committed"),
        sql`lower(trim(${scans.binder})) = ${page.binder.trim().toLowerCase()}`,
        eq(scans.page, page.page),
        eq(scanResults.decision, "confirmed"),
        eq(scanResults.empty, false),
        isNull(scanResults.removedAt),
      ),
    )
  const bySlot = new Map(current.map((p) => [p.slot, p]))
  return rows.map((row) => {
    const held = bySlot.get(row.slot)
    if (row.empty || !row.chosenCardId || !held?.variant || held.cardId !== row.chosenCardId) return null
    return { variant: held.variant, condition: held.condition }
  })
}

export { carryOver }
export type { Carried, CarryRow }
