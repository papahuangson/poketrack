import { sets, type Db } from "@poketrack/db"
import { upsertCards } from "@poketrack/jobs"

type SeedSet = { id: string; name?: string; printedTotal: number; ptcgoCode?: string | null; releaseDate?: string }
type SeedCard = { id: string; name: string; setId: string; number: string; variants?: string[] }

async function seed(db: Db, seedSets: SeedSet[], seedCards: SeedCard[]): Promise<void> {
  await db.insert(sets).values(
    seedSets.map((s) => ({
      id: s.id,
      name: s.name ?? s.id,
      series: "Test",
      printedTotal: s.printedTotal,
      releaseDate: s.releaseDate ?? "2020-01-01",
      ptcgoCode: s.ptcgoCode ?? null,
    })),
  )
  const totals = new Map(seedSets.map((s) => [s.id, s.printedTotal]))
  await upsertCards(
    db,
    seedCards.map((c) => ({
      id: c.id,
      name: c.name,
      setId: c.setId,
      number: c.number,
      printedTotal: totals.get(c.setId) ?? 0,
      rarity: null,
      imageSmall: null,
      imageLarge: null,
      legalities: {},
      rulesText: "",
      variants: c.variants ?? ["normal"],
    })),
  )
}

export { seed }
export type { SeedCard, SeedSet }
