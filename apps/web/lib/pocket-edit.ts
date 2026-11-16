import { cards, collectionItems, eq, scanResults, sql, type Condition, type Db } from "@poketrack/db"
import { LIVE_POCKETS, pocketCounts } from "./binder-view"
import { addItem, checkAcquiredOn, checkLot, checkPaid } from "./collection"
import { ValidationError } from "./errors"

const STALE = "That pocket changed. Reload the page."
const LOT_GONE = "That card is no longer in your collection."

type LivePocket = { resultId: number; binder: string; lotId: number | null; cardId: string; present: boolean }

async function rows<T>(db: Db, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

// Runs `fn` in one transaction holding the page lock commitScan takes, with the pocket re-read under the lock.
// Refuses anything that is no longer a live pocket of a committed scan.
async function withLivePocket<T>(db: Db, resultId: number, fn: (tx: Db, pocket: LivePocket) => Promise<T>): Promise<T> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db
    const [where] = await rows<{ binder: string; page: number }>(
      tx,
      sql`select s.binder, s.page from scan_results r join scans s on s.id = r.scan_id where r.id = ${resultId}`,
    )
    if (!where) throw new ValidationError("pocket", STALE)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(trim(${where.binder}))), ${where.page})`)
    const [pocket] = await rows<LivePocket>(
      tx,
      sql`select l.result_id as "resultId", l.binder, l.lot_id as "lotId", l.card_id as "cardId", l.present
          from (${LIVE_POCKETS}) l where l.result_id = ${resultId}`,
    )
    if (!pocket) throw new ValidationError("pocket", STALE)
    return fn(tx, pocket)
  })
}

// Lowers a lot by one copy and deletes it when none are left.
async function takeCopy(tx: Db, lotId: number): Promise<void> {
  await tx.update(collectionItems).set({ quantity: sql`${collectionItems.quantity} - 1` }).where(eq(collectionItems.id, lotId))
  await tx.delete(collectionItems).where(sql`${collectionItems.id} = ${lotId} and ${collectionItems.quantity} <= 0`)
}

async function checkCardVariant(db: Db, cardId: string, variant: string): Promise<void> {
  const [card] = await db.select({ variants: cards.variants }).from(cards).where(eq(cards.id, cardId))
  if (!card?.variants.includes(variant)) throw new ValidationError("variant", "This card doesn't come in that variant.")
}

async function movePocketCopy(db: Db, resultId: number, to: { variant: string; condition: Condition }): Promise<{ lotId: number }> {
  checkLot(to.variant, to.condition)
  return withLivePocket(db, resultId, async (tx, pocket) => {
    if (!pocket.present || pocket.lotId === null) throw new ValidationError("pocket", STALE)
    await checkCardVariant(tx, pocket.cardId, to.variant)
    const [old] = await tx.select().from(collectionItems).where(eq(collectionItems.id, pocket.lotId))
    if (!old) throw new ValidationError("pocket", STALE)
    if (old.variant === to.variant && old.condition === to.condition) return { lotId: old.id }

    await takeCopy(tx, old.id)
    const { id, merged } = await addItem(tx, { cardId: pocket.cardId, variant: to.variant, condition: to.condition, quantity: 1, binder: pocket.binder })
    if (!merged) {
      await tx.update(collectionItems).set({ paidUsd: old.paidUsd, acquiredOn: old.acquiredOn, source: old.source }).where(eq(collectionItems.id, id))
    }
    await tx.update(scanResults).set({ collectionItemId: id, variant: to.variant, condition: to.condition }).where(eq(scanResults.id, resultId))
    return { lotId: id }
  })
}

async function removePocketCopy(db: Db, resultId: number): Promise<void> {
  await withLivePocket(db, resultId, async (tx, pocket) => {
    if (pocket.present && pocket.lotId !== null) await takeCopy(tx, pocket.lotId)
    await tx.update(scanResults).set({ collectionItemId: null, removedAt: new Date() }).where(eq(scanResults.id, resultId))
  })
}

async function setLotDetails(db: Db, lotId: number, d: { paidCents: number | null; acquiredOn: string | null }): Promise<void> {
  checkPaid(d.paidCents)
  checkAcquiredOn(d.acquiredOn)
  const updated = await db
    .update(collectionItems)
    .set({ paidUsd: d.paidCents === null ? null : d.paidCents / 100, acquiredOn: d.acquiredOn })
    .where(eq(collectionItems.id, lotId))
    .returning({ id: collectionItems.id })
  if (updated.length === 0) throw new ValidationError("lot", LOT_GONE)
}

type SurplusInput = { variant: string; condition: Condition; quantity: number; binder: string | null }

const MAX_QUANTITY = 999
const binderOf = (binder: string | null) => (binder && binder.trim() !== "" ? binder.trim() : null)

// Group-mode edit: acts only on the copies of a lot that no pocket accounts for. `input.quantity` is the new surplus.
async function editSurplus(db: Db, lotId: number, input: SurplusInput): Promise<void> {
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > MAX_QUANTITY) {
    throw new ValidationError("quantity", `Quantity must be a whole number from 0 to ${MAX_QUANTITY}.`)
  }
  checkLot(input.variant, input.condition)
  const binder = binderOf(input.binder)

  await db.transaction(async (raw) => {
    const tx = raw as unknown as Db
    const [lot] = await tx.select().from(collectionItems).where(eq(collectionItems.id, lotId)).for("update")
    if (!lot) throw new ValidationError("lot", LOT_GONE)
    const pocketed = Math.min(lot.quantity, (await pocketCounts(tx, [lotId])).get(lotId) ?? 0)
    const keep = async (quantity: number) => {
      if (quantity > MAX_QUANTITY) throw new ValidationError("quantity", `Quantity must be a whole number from 0 to ${MAX_QUANTITY}.`)
      if (quantity <= 0) await tx.delete(collectionItems).where(eq(collectionItems.id, lotId))
      else await tx.update(collectionItems).set({ quantity }).where(eq(collectionItems.id, lotId))
    }

    if (lot.variant === input.variant && lot.condition === input.condition && binderOf(lot.binder) === binder) {
      await keep(pocketed + input.quantity)
      return
    }

    if (lot.variant !== input.variant) await checkCardVariant(tx, lot.cardId, input.variant)
    await keep(pocketed)
    if (input.quantity === 0) return
    const { id, merged } = await addItem(tx, { cardId: lot.cardId, variant: input.variant, condition: input.condition, quantity: input.quantity, binder })
    if (!merged) {
      await tx.update(collectionItems).set({ paidUsd: lot.paidUsd, acquiredOn: lot.acquiredOn, source: lot.source }).where(eq(collectionItems.id, id))
    }
  })
}

async function removeSurplus(db: Db, lotId: number): Promise<void> {
  const [lot] = await db.select().from(collectionItems).where(eq(collectionItems.id, lotId))
  if (!lot) throw new ValidationError("lot", LOT_GONE)
  await editSurplus(db, lotId, { variant: lot.variant, condition: lot.condition, binder: lot.binder, quantity: 0 })
}

export { editSurplus, movePocketCopy, removePocketCopy, removeSurplus, setLotDetails }
export type { SurplusInput }
