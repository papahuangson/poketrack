import { collectionItems, priceSnapshots, watchlist, type Db } from "@poketrack/db"
import { sql } from "drizzle-orm"
import { upsertCards } from "./catalog-sync"
import type { PricedCard, PriceProvider } from "./types"

const dollars = (cents: number | null): number | null => (cents === null ? null : cents / 100)

async function trackedCardIds(db: Db): Promise<string[]> {
  const owned = await db.selectDistinct({ id: collectionItems.cardId }).from(collectionItems)
  const watched = await db.selectDistinct({ id: watchlist.cardId }).from(watchlist)
  return [...new Set([...owned, ...watched].map((r) => r.id))]
}

async function writeSnapshots(db: Db, priced: PricedCard[], date: string): Promise<number> {
  const rows = priced.flatMap((p) =>
    p.prices
      .filter((price) => price.marketCents !== null)
      .map((price) => ({
        cardId: price.cardId,
        variant: price.variant,
        date,
        marketUsd: dollars(price.marketCents),
        lowUsd: dollars(price.lowCents),
        cardmarketTrendEur: dollars(price.cardmarketTrendEurCents),
      })),
  )
  if (rows.length === 0) return 0
  await db
    .insert(priceSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [priceSnapshots.cardId, priceSnapshots.variant, priceSnapshots.date],
      set: {
        marketUsd: sql`excluded.market_usd`,
        lowUsd: sql`excluded.low_usd`,
        cardmarketTrendEur: sql`excluded.cardmarket_trend_eur`,
      },
    })
  return rows.length
}

async function store(db: Db, priced: PricedCard[], date: string): Promise<number> {
  await upsertCards(
    db,
    priced.map((p) => p.card),
  )
  return writeSnapshots(db, priced, date)
}

async function refreshPrices(
  db: Db,
  provider: PriceProvider,
  date: string,
): Promise<{ cardsRequested: number; snapshotsWritten: number }> {
  const ids = await trackedCardIds(db)
  if (ids.length === 0) return { cardsRequested: 0, snapshotsWritten: 0 }
  const priced = await provider.getPrices(ids)
  return { cardsRequested: ids.length, snapshotsWritten: await store(db, priced, date) }
}

async function snapshotCard(db: Db, provider: PriceProvider, cardId: string, date: string): Promise<number> {
  const priced = (await provider.getPrices([cardId])).filter((p) => p.card.id === cardId)
  return store(db, priced, date)
}

export { refreshPrices, snapshotCard }
