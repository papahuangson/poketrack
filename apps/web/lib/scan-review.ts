import {
  and,
  cards,
  collectionItems,
  CONDITIONS,
  DECISIONS,
  eq,
  inArray,
  scanResults,
  scans,
  sets,
  sql,
  type Candidate,
  type Condition,
  type Db,
  type Decision,
  type ScanStatus,
  type SlotBox,
  type SlotCues,
} from "@poketrack/db"
import { claimDefaults, proposeVariant } from "@poketrack/scan"
import { defaultVariant, type CardHit } from "./collection"
import { ValidationError } from "./errors"

type ReviewSlot = {
  id: number
  slot: number
  empty: boolean
  read: { name: string | null; number: string | null; printedTotal: number | null; setCode: string | null; cues: SlotCues | null }
  confidence: number
  box: SlotBox | null
  candidates: (Candidate & CardHit)[]
  chosen: CardHit | null
  variant: string | null
  condition: Condition
  decision: Decision
  claimManual: boolean
  manualLot: { id: number; available: number } | null
  otherPages: { binder: string; page: number }[]
  firstEditionNote: boolean
}

type RescanDiff = {
  replaces: { scanId: number; committedAt: string }
  added: CardHit[]
  removed: CardHit[]
  unchanged: number
} | null

type Review = {
  scan: { id: number; binder: string; page: number; status: ScanStatus; imageUrl: string; width: number; height: number }
  slots: ReviewSlot[]
  diff: RescanDiff
  canCommit: boolean
}

type SlotPatch = {
  chosenCardId?: string | null
  variant?: string
  condition?: Condition
  decision?: Decision
  claimManual?: boolean
}

const pageKey = (binder: string) => binder.trim().toLowerCase()

async function cardHits(db: Db, ids: string[]): Promise<Map<string, CardHit>> {
  if (ids.length === 0) return new Map()
  const found = await db
    .select({
      id: cards.id,
      name: cards.name,
      setName: sets.name,
      number: cards.number,
      printedTotal: cards.printedTotal,
      imageSmall: cards.imageSmall,
      variants: cards.variants,
    })
    .from(cards)
    .innerJoin(sets, eq(sets.id, cards.setId))
    .where(inArray(cards.id, [...new Set(ids)]))
  return new Map(found.map((c) => [c.id, c]))
}

async function manualLots(db: Db, keys: { cardId: string; variant: string }[]): Promise<Map<string, { id: number; quantity: number }>> {
  if (keys.length === 0) return new Map()
  const found = await db
    .select({ id: collectionItems.id, cardId: collectionItems.cardId, variant: collectionItems.variant, quantity: collectionItems.quantity })
    .from(collectionItems)
    .where(
      and(
        inArray(collectionItems.cardId, [...new Set(keys.map((k) => k.cardId))]),
        sql`coalesce(trim(${collectionItems.binder}), '') = ''`,
        sql`${collectionItems.quantity} > 0`,
      ),
    )
    .orderBy(collectionItems.id)
  const lots = new Map<string, { id: number; quantity: number }>()
  for (const lot of found) {
    const key = `${lot.cardId}|${lot.variant}`
    const seen = lots.get(key)
    // Several binder-less lots of one card+variant (different conditions) pool into the first one's id.
    lots.set(key, seen ? { id: seen.id, quantity: seen.quantity + lot.quantity } : { id: lot.id, quantity: lot.quantity })
  }
  return lots
}

async function committedPagesByCard(db: Db, cardIds: string[], binder: string, page: number): Promise<Map<string, { binder: string; page: number }[]>> {
  if (cardIds.length === 0) return new Map()
  const found = await db
    .selectDistinct({ cardId: scanResults.chosenCardId, binder: scans.binder, page: scans.page })
    .from(scanResults)
    .innerJoin(scans, eq(scans.id, scanResults.scanId))
    .where(
      and(
        eq(scans.status, "committed"),
        eq(scanResults.decision, "confirmed"),
        inArray(scanResults.chosenCardId, cardIds),
        sql`not (lower(trim(${scans.binder})) = ${pageKey(binder)} and ${scans.page} = ${page})`,
      ),
    )
    .orderBy(scans.binder, scans.page)
  const byCard = new Map<string, { binder: string; page: number }[]>()
  for (const row of found) {
    if (!row.cardId) continue
    byCard.set(row.cardId, [...(byCard.get(row.cardId) ?? []), { binder: row.binder.trim(), page: row.page }])
  }
  return byCard
}

function countBy(ids: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

async function rescanDiff(db: Db, scan: { id: number; binder: string; page: number; status: ScanStatus }, currentIds: string[]): Promise<RescanDiff> {
  if (scan.status === "committed" || scan.status === "superseded") return null
  const [previous] = await db
    .select({ id: scans.id, committedAt: scans.committedAt })
    .from(scans)
    .where(and(eq(scans.status, "committed"), sql`lower(trim(${scans.binder})) = ${pageKey(scan.binder)}`, eq(scans.page, scan.page)))
    .limit(1)
  if (!previous) return null
  const before = await db
    .select({ cardId: scanResults.chosenCardId })
    .from(scanResults)
    .where(and(eq(scanResults.scanId, previous.id), eq(scanResults.decision, "confirmed"), eq(scanResults.empty, false)))
  const beforeIds = before.flatMap((r) => (r.cardId ? [r.cardId] : []))
  const hits = await cardHits(db, [...beforeIds, ...currentIds])
  const was = countBy(beforeIds)
  const now = countBy(currentIds)
  const added: CardHit[] = []
  const removed: CardHit[] = []
  let unchanged = 0
  for (const id of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(id) ?? 0
    const b = now.get(id) ?? 0
    unchanged += Math.min(a, b)
    const hit = hits.get(id)
    if (!hit) continue
    for (let i = a; i < b; i++) added.push(hit)
    for (let i = b; i < a; i++) removed.push(hit)
  }
  return {
    replaces: { scanId: previous.id, committedAt: (previous.committedAt ?? new Date(0)).toISOString() },
    added,
    removed,
    unchanged,
  }
}

async function loadReview(db: Db, scanId: number): Promise<Review | null> {
  const [scan] = await db.select().from(scans).where(eq(scans.id, scanId))
  if (!scan) return null
  const results = await db.select().from(scanResults).where(eq(scanResults.scanId, scanId)).orderBy(scanResults.slot)
  const editable = scan.status === "ready"

  const hits = await cardHits(db, results.flatMap((r) => [...r.candidates.map((c) => c.cardId), ...(r.chosenCardId ? [r.chosenCardId] : [])]))
  const lots = editable
    ? await manualLots(db, results.flatMap((r) => (r.chosenCardId && r.variant ? [{ cardId: r.chosenCardId, variant: r.variant }] : [])))
    : new Map<string, { id: number; quantity: number }>()
  const chosenIds = results.flatMap((r) => (r.chosenCardId ? [r.chosenCardId] : []))
  const pages = await committedPagesByCard(db, [...new Set(chosenIds)], scan.binder, scan.page)

  // Hand out each binder-less lot's copies to claiming pockets in slot order.
  const claimed = new Map<string, number>()
  const turnOff: number[] = []
  for (const r of results) {
    if (!r.claimManual || r.decision === "rejected" || r.empty || !r.chosenCardId || !r.variant) continue
    const key = `${r.chosenCardId}|${r.variant}`
    const lot = lots.get(key)
    const used = claimed.get(key) ?? 0
    if (editable && (!lot || used >= lot.quantity)) turnOff.push(r.id)
    else claimed.set(key, used + 1)
  }
  if (turnOff.length > 0) await db.update(scanResults).set({ claimManual: false }).where(inArray(scanResults.id, turnOff))

  const slots: ReviewSlot[] = results.map((r) => {
    const key = r.chosenCardId && r.variant ? `${r.chosenCardId}|${r.variant}` : null
    const lot = key ? lots.get(key) : undefined
    const claimManual = r.claimManual && !turnOff.includes(r.id)
    const byOthers = key ? (claimed.get(key) ?? 0) - (claimManual ? 1 : 0) : 0
    return {
      id: r.id,
      slot: r.slot,
      empty: r.empty,
      read: { name: r.readName, number: r.readNumber, printedTotal: r.readPrintedTotal, setCode: r.readSetCode, cues: r.readCues },
      confidence: r.confidence,
      box: r.box,
      candidates: r.candidates.flatMap((c) => {
        const hit = hits.get(c.cardId)
        return hit ? [{ ...hit, ...c }] : []
      }),
      chosen: r.chosenCardId ? (hits.get(r.chosenCardId) ?? null) : null,
      variant: r.variant,
      condition: r.condition,
      decision: r.decision,
      claimManual,
      manualLot: lot ? { id: lot.id, available: Math.max(0, lot.quantity - byOthers) } : null,
      otherPages: r.chosenCardId ? (pages.get(r.chosenCardId) ?? []) : [],
      firstEditionNote: r.readCues?.firstEdition === true,
    }
  })

  const currentIds = results.flatMap((r) => (r.decision === "confirmed" && !r.empty && r.chosenCardId ? [r.chosenCardId] : []))
  return {
    scan: {
      id: scan.id,
      binder: scan.binder,
      page: scan.page,
      status: scan.status,
      imageUrl: scan.imageUrl,
      width: scan.imageWidth,
      height: scan.imageHeight,
    },
    slots,
    diff: await rescanDiff(db, scan, currentIds),
    canCommit: editable && results.every((r) => r.empty || r.decision !== "pending"),
  }
}

async function claimDefaultFor(
  db: Db,
  scan: { id: number; binder: string; page: number },
  resultId: number,
  key: { cardId: string; variant: string },
): Promise<{ claim: boolean; condition: Condition | null }> {
  const pockets = await db.select().from(scanResults).where(eq(scanResults.scanId, scan.id)).orderBy(scanResults.slot)
  const keys = pockets.map((p) =>
    p.id === resultId ? key : !p.empty && p.decision !== "rejected" && p.chosenCardId && p.variant ? { cardId: p.chosenCardId, variant: p.variant } : null,
  )
  const defaults = await claimDefaults(db, { binder: scan.binder, page: scan.page, scanId: scan.id }, keys)
  return defaults[pockets.findIndex((p) => p.id === resultId)] ?? { claim: false, condition: null }
}

async function manualCondition(db: Db, cardId: string, variant: string): Promise<Condition | null> {
  const [lot] = await db
    .select({ condition: collectionItems.condition })
    .from(collectionItems)
    .where(
      and(
        eq(collectionItems.cardId, cardId),
        eq(collectionItems.variant, variant),
        sql`coalesce(trim(${collectionItems.binder}), '') = ''`,
        sql`${collectionItems.quantity} > 0`,
      ),
    )
    .orderBy(collectionItems.id)
    .limit(1)
  return lot?.condition ?? null
}

async function updateSlot(db: Db, resultId: number, patch: SlotPatch): Promise<{ scanId: number }> {
  const [row] = await db
    .select({ result: scanResults, status: scans.status, binder: scans.binder, page: scans.page })
    .from(scanResults)
    .innerJoin(scans, eq(scans.id, scanResults.scanId))
    .where(eq(scanResults.id, resultId))
  if (!row) throw new ValidationError("scan", "That pocket was not found.")
  if (row.status !== "ready") throw new ValidationError("scan", "This scan was already added.")
  const r = row.result
  const scanRef = { id: r.scanId, binder: row.binder, page: row.page }
  const withClaim = async (cardId: string, v: string) => {
    const d = await claimDefaultFor(db, scanRef, resultId, { cardId, variant: v })
    return { claimManual: d.claim, ...(d.condition ? { condition: d.condition } : {}) }
  }

  const next: Partial<typeof scanResults.$inferInsert> = {}
  let chosenId = r.chosenCardId
  let variant = r.variant

  if (patch.chosenCardId !== undefined && patch.chosenCardId !== r.chosenCardId) {
    if (patch.chosenCardId === null) {
      chosenId = null
      variant = null
      Object.assign(next, { chosenCardId: null, variant: null, decision: "pending", claimManual: false })
    } else {
      const [card] = await db.select({ id: cards.id, variants: cards.variants }).from(cards).where(eq(cards.id, patch.chosenCardId))
      if (!card) throw new ValidationError("chosenCardId", "That card is not in the catalog.")
      chosenId = card.id
      variant = proposeVariant(r.readCues ?? { holo: false, reverse: false, firstEdition: false }, card.variants, await defaultVariant(db, card.variants))
      Object.assign(next, { chosenCardId: card.id, variant }, await withClaim(card.id, variant))
    }
  }

  if (patch.variant !== undefined) {
    const [card] = chosenId ? await db.select({ variants: cards.variants }).from(cards).where(eq(cards.id, chosenId)) : []
    if (!card || !card.variants.includes(patch.variant)) throw new ValidationError("variant", "Choose a variant this card comes in.")
    if (patch.variant !== variant) {
      variant = patch.variant
      Object.assign(next, { variant }, await withClaim(chosenId!, variant))
    }
  }

  if (patch.claimManual !== undefined) {
    next.claimManual = patch.claimManual
    if (patch.claimManual && patch.condition === undefined && chosenId && variant) {
      const condition = await manualCondition(db, chosenId, variant)
      if (condition) next.condition = condition
    }
  }

  if (patch.condition !== undefined) {
    if (!CONDITIONS.includes(patch.condition)) throw new ValidationError("condition", "Choose a condition.")
    next.condition = patch.condition
  }

  if (patch.decision !== undefined) {
    if (!DECISIONS.includes(patch.decision)) throw new ValidationError("decision", "Choose confirm or reject.")
    if (patch.decision === "confirmed" && (!chosenId || !variant)) throw new ValidationError("chosenCardId", "Pick the card before confirming.")
    next.decision = patch.decision
  }

  if (Object.keys(next).length > 0) await db.update(scanResults).set(next).where(eq(scanResults.id, resultId))
  return { scanId: r.scanId }
}

export { loadReview, updateSlot }
export type { RescanDiff, Review, ReviewSlot, SlotPatch }
