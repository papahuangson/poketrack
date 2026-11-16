import { and, collectionItems, eq, inArray, ne, scanResults, scans, sql, type Condition, type Db } from "@poketrack/db"

type PocketKey = { cardId: string; variant: string } | null
type ClaimDefault = { claim: boolean; condition: Condition | null }
type PageRef = { binder: string; page: number; scanId?: number }

const keyOf = (k: { cardId: string; variant: string }) => `${k.cardId}|${k.variant}`

// Default "use the typed-in copy" for each pocket, in slot order. A pocket only claims a binder-less copy
// when the page's previous committed scan didn't already account for that card+variant, and never more
// copies than exist. A claimed pocket takes the typed-in copy's condition.
async function claimDefaults(db: Db, page: PageRef, pockets: PocketKey[]): Promise<ClaimDefault[]> {
  const keys = pockets.filter((p): p is { cardId: string; variant: string } => p !== null)
  if (keys.length === 0) return pockets.map(() => ({ claim: false, condition: null }))
  const cardIds = [...new Set(keys.map((k) => k.cardId))]

  const lots = await db
    .select({ cardId: collectionItems.cardId, variant: collectionItems.variant, quantity: collectionItems.quantity, condition: collectionItems.condition })
    .from(collectionItems)
    .where(and(inArray(collectionItems.cardId, cardIds), sql`coalesce(trim(${collectionItems.binder}), '') = ''`, sql`${collectionItems.quantity} > 0`))
    .orderBy(collectionItems.id)
  const manual = new Map<string, { quantity: number; condition: Condition }>()
  for (const lot of lots) {
    const k = keyOf(lot)
    const seen = manual.get(k)
    manual.set(k, seen ? { ...seen, quantity: seen.quantity + lot.quantity } : { quantity: lot.quantity, condition: lot.condition })
  }

  const previous = await db
    .select({ cardId: scanResults.chosenCardId, variant: scanResults.variant })
    .from(scanResults)
    .innerJoin(scans, eq(scans.id, scanResults.scanId))
    .where(
      and(
        eq(scans.status, "committed"),
        sql`lower(trim(${scans.binder})) = ${page.binder.trim().toLowerCase()}`,
        eq(scans.page, page.page),
        page.scanId === undefined ? sql`true` : ne(scans.id, page.scanId),
        eq(scanResults.decision, "confirmed"),
        eq(scanResults.empty, false),
      ),
    )
  const held = new Map<string, number>()
  for (const p of previous) if (p.cardId && p.variant) held.set(keyOf({ cardId: p.cardId, variant: p.variant }), (held.get(keyOf({ cardId: p.cardId, variant: p.variant })) ?? 0) + 1)

  const seen = new Map<string, number>()
  const claimed = new Map<string, number>()
  return pockets.map((p) => {
    if (!p) return { claim: false, condition: null }
    const k = keyOf(p)
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    const lot = manual.get(k)
    const used = claimed.get(k) ?? 0
    if (!lot || n <= (held.get(k) ?? 0) || used >= lot.quantity) return { claim: false, condition: null }
    claimed.set(k, used + 1)
    return { claim: true, condition: lot.condition }
  })
}

export { claimDefaults }
export type { ClaimDefault, PageRef, PocketKey }
