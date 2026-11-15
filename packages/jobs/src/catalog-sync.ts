import { cards, sets, type Db } from "@poketrack/db"
import { eq, sql } from "drizzle-orm"
import { normalizeText, reprintKey } from "./normalize"
import type { CatalogCard, CatalogProvider } from "./types"

const CHUNK = 500

type SyncResult = { setsUpserted: number; setsFetched: number; cardsUpserted: number }

async function upsertCards(db: Db, catalogCards: CatalogCard[]): Promise<number> {
  for (let i = 0; i < catalogCards.length; i += CHUNK) {
    const rows = catalogCards.slice(i, i + CHUNK).map((c) => ({
      id: c.id,
      game: "pokemon",
      name: c.name,
      nameSearch: normalizeText(c.name),
      setId: c.setId,
      number: c.number,
      printedTotal: c.printedTotal,
      rarity: c.rarity,
      imageSmall: c.imageSmall,
      imageLarge: c.imageLarge,
      legalities: c.legalities,
      reprintKey: reprintKey(c.name, c.rulesText),
      variants: c.variants,
    }))
    await db
      .insert(cards)
      .values(rows)
      .onConflictDoUpdate({
        target: cards.id,
        set: {
          name: sql`excluded.name`,
          nameSearch: sql`excluded.name_search`,
          setId: sql`excluded.set_id`,
          number: sql`excluded.number`,
          printedTotal: sql`excluded.printed_total`,
          rarity: sql`excluded.rarity`,
          imageSmall: sql`excluded.image_small`,
          imageLarge: sql`excluded.image_large`,
          legalities: sql`excluded.legalities`,
          reprintKey: sql`excluded.reprint_key`,
          variants: sql`excluded.variants`,
        },
      })
  }
  return catalogCards.length
}

type SyncProgress = { setId: string; cards: number; done: number; total: number }

async function syncCatalog(
  db: Db,
  provider: CatalogProvider,
  opts: { full?: boolean; onSet?: (progress: SyncProgress) => void } = {},
): Promise<SyncResult> {
  const remote = await provider.listSets()
  const stored = new Map(
    (await db.select({ id: sets.id, providerUpdatedAt: sets.providerUpdatedAt }).from(sets)).map((s) => [
      s.id,
      s.providerUpdatedAt,
    ]),
  )
  const result: SyncResult = { setsUpserted: 0, setsFetched: 0, cardsUpserted: 0 }

  for (const set of remote) {
    const details = {
      name: set.name,
      series: set.series,
      printedTotal: set.printedTotal,
      releaseDate: set.releaseDate,
      ptcgoCode: set.ptcgoCode,
      symbolUrl: set.symbolUrl,
    }
    await db
      .insert(sets)
      .values({ id: set.id, ...details })
      .onConflictDoUpdate({ target: sets.id, set: details })
    result.setsUpserted++

    if (!opts.full && stored.get(set.id) === set.updatedAt) continue

    const upserted = await upsertCards(db, await provider.listCardsInSet(set.id))
    result.cardsUpserted += upserted
    await db.update(sets).set({ providerUpdatedAt: set.updatedAt }).where(eq(sets.id, set.id))
    result.setsFetched++
    opts.onSet?.({ setId: set.id, cards: upserted, done: result.setsUpserted, total: remote.length })
  }
  return result
}

export { syncCatalog, upsertCards }
export type { SyncProgress, SyncResult }
