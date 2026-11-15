import { sets, type Db } from "@poketrack/db"
import { upsertCards } from "../catalog-sync"
import type { CatalogCard, CatalogSet } from "../types"

async function seedCatalog(db: Db, catalogSets: CatalogSet[], catalogCards: CatalogCard[]): Promise<void> {
  if (catalogSets.length > 0) {
    await db.insert(sets).values(
      catalogSets.map((s) => ({
        id: s.id,
        name: s.name,
        series: s.series,
        printedTotal: s.printedTotal,
        releaseDate: s.releaseDate,
        ptcgoCode: s.ptcgoCode,
        symbolUrl: s.symbolUrl,
        providerUpdatedAt: s.updatedAt,
      })),
    )
  }
  await upsertCards(db, catalogCards)
}

export { seedCatalog }
