import { and, collectionItems, eq, ne, scanResults, scans, sql, type Db } from "@poketrack/db"
import { addItem } from "./collection"
import { ValidationError } from "./errors"

type CommitResult = { added: number; replaced: boolean }

async function takeOneCopy(tx: Db, id: number): Promise<{ removed: boolean } | null> {
  const [lot] = await tx.select({ quantity: collectionItems.quantity }).from(collectionItems).where(eq(collectionItems.id, id))
  if (!lot) return null
  const left = Math.max(0, lot.quantity - 1)
  if (left === 0) {
    await tx.delete(collectionItems).where(eq(collectionItems.id, id))
    return { removed: true }
  }
  await tx.update(collectionItems).set({ quantity: left }).where(eq(collectionItems.id, id))
  return { removed: false }
}

async function claimManualCopy(tx: Db, cardId: string, variant: string): Promise<{ id: number; paidUsd: number | null; removed: boolean } | null> {
  const [lot] = await tx
    .select({ id: collectionItems.id, paidUsd: collectionItems.paidUsd })
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
  if (!lot) return null
  const taken = await takeOneCopy(tx, lot.id)
  return taken ? { id: lot.id, paidUsd: lot.paidUsd, removed: taken.removed } : null
}

async function commitScan(db: Db, scanId: number): Promise<CommitResult> {
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db
    const [scan] = await tx.select().from(scans).where(eq(scans.id, scanId)).for("update")
    if (!scan) throw new ValidationError("scan", "That scan was not found.")

    // Serialize commits of the same physical page.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(lower(trim(${scan.binder}))), ${scan.page})`)
    const [current] = await tx.select({ status: scans.status }).from(scans).where(eq(scans.id, scanId))
    if (current?.status === "committed" || current?.status === "superseded") throw new ValidationError("scan", "This scan was already added.")
    if (current?.status !== "ready") throw new ValidationError("scan", "This scan isn't ready to add.")

    const pockets = await tx.select().from(scanResults).where(eq(scanResults.scanId, scanId)).orderBy(scanResults.slot)
    if (pockets.some((p) => !p.empty && p.decision === "pending")) {
      throw new ValidationError("scan", "Confirm or reject every pocket first.")
    }

    // 1. Undo the page's previous scan.
    const [previous] = await tx
      .select({ id: scans.id })
      .from(scans)
      .where(
        and(
          eq(scans.status, "committed"),
          sql`lower(trim(${scans.binder})) = ${scan.binder.trim().toLowerCase()}`,
          eq(scans.page, scan.page),
          ne(scans.id, scanId),
        ),
      )
      .for("update")
    if (previous) {
      const old = await tx
        .select({ itemId: scanResults.collectionItemId })
        .from(scanResults)
        .where(and(eq(scanResults.scanId, previous.id), eq(scanResults.decision, "confirmed"), eq(scanResults.empty, false)))
      for (const { itemId } of old) if (itemId !== null) await takeOneCopy(tx, itemId)
      await tx.update(scans).set({ status: "superseded" }).where(eq(scans.id, previous.id))
    }

    // 2. Apply this scan.
    let added = 0
    for (const pocket of pockets) {
      if (pocket.empty || pocket.decision !== "confirmed" || !pocket.chosenCardId || !pocket.variant) continue
      const claimed = pocket.claimManual ? await claimManualCopy(tx, pocket.chosenCardId, pocket.variant) : null
      const { id, merged } = await addItem(tx, {
        cardId: pocket.chosenCardId,
        variant: pocket.variant,
        condition: pocket.condition,
        quantity: 1,
        binder: scan.binder,
      })
      if (!merged) await tx.update(collectionItems).set({ source: "scan" }).where(eq(collectionItems.id, id))
      if (claimed?.paidUsd != null) {
        await tx
          .update(collectionItems)
          .set({ paidUsd: claimed.paidUsd })
          .where(and(eq(collectionItems.id, id), sql`${collectionItems.paidUsd} is null`))
      }
      await tx
        .update(scanResults)
        .set({ collectionItemId: id, claimedFromItemId: claimed && !claimed.removed ? claimed.id : null })
        .where(eq(scanResults.id, pocket.id))
      added++
    }

    // 3. Mark committed.
    await tx.update(scans).set({ status: "committed", committedAt: new Date() }).where(eq(scans.id, scanId))
    return { added, replaced: previous !== undefined }
  })
}

export { commitScan }
export type { CommitResult }
