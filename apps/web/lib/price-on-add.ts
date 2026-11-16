import { and, chicagoDate, eq, priceSnapshots } from "@poketrack/db"
import { createTcgdex, snapshotCard } from "@poketrack/jobs"
import { getDb } from "./db"

async function priceIfMissing(cardId: string): Promise<void> {
  const db = getDb()
  const today = chicagoDate()
  const [existing] = await db
    .select({ cardId: priceSnapshots.cardId })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.cardId, cardId), eq(priceSnapshots.date, today)))
    .limit(1)
  if (existing) return
  try {
    await snapshotCard(db, createTcgdex({ attempts: 1, timeoutMs: 6000 }), cardId, today)
  } catch (error) {
    console.error(`Could not fetch a price for ${cardId}`, error)
  }
}

export { priceIfMissing }
