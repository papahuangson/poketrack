import { scanResults, scans, sets, type Db } from "@poketrack/db"
import { upsertCards } from "@poketrack/jobs"

type CardSeed = { id: string; name: string; setId: string; number: string; variants: string[] }

const CARDS: CardSeed[] = [
  { id: "sv3pt5-199", name: "Charizard ex", setId: "sv3pt5", number: "199", variants: ["normal", "holofoil"] },
  { id: "sv3pt5-151", name: "Mew ex", setId: "sv3pt5", number: "151", variants: ["holofoil"] },
  { id: "base1-58", name: "Pikachu", setId: "base1", number: "58", variants: ["normal"] },
]

async function seedCards(db: Db): Promise<void> {
  await db.insert(sets).values([
    { id: "sv3pt5", name: "151", series: "SV", printedTotal: 165, releaseDate: "2023-09-22", ptcgoCode: "MEW" },
    { id: "base1", name: "Base", series: "Original", printedTotal: 102, releaseDate: "1999-01-09" },
  ])
  await upsertCards(
    db,
    CARDS.map((c) => ({
      ...c,
      printedTotal: c.setId === "base1" ? 102 : 165,
      rarity: null,
      imageSmall: `https://img.test/${c.id}.webp`,
      imageLarge: null,
      legalities: {},
      rulesText: "",
    })),
  )
}

type PocketSeed = {
  card?: string | null
  variant?: string
  decision?: "pending" | "confirmed" | "rejected"
  empty?: boolean
  claimManual?: boolean
  firstEdition?: boolean
  candidates?: string[]
}

async function seedScan(
  db: Db,
  opts: { binder?: string; page?: number; status?: "ready" | "committed" | "superseded"; pockets: PocketSeed[] },
): Promise<{ scanId: number; resultIds: number[] }> {
  const [scan] = await db
    .insert(scans)
    .values({
      imageUrl: "https://x.public.blob.vercel-storage.com/p.jpg",
      imageWidth: 2000,
      imageHeight: 1500,
      binder: opts.binder ?? "Main",
      page: opts.page ?? 3,
      status: opts.status ?? "ready",
      committedAt: opts.status === "committed" ? new Date("2026-11-15T18:00:00Z") : null,
    })
    .returning({ id: scans.id })
  const rows = await db
    .insert(scanResults)
    .values(
      opts.pockets.map((p, i) => {
        const card = p.card === undefined ? null : p.card
        return {
          scanId: scan!.id,
          slot: i + 1,
          empty: p.empty ?? false,
          readName: card ? "read" : null,
          readCues: { holo: false, reverse: false, firstEdition: p.firstEdition ?? false },
          confidence: 0.95,
          candidates: (p.candidates ?? (card ? [card] : [])).map((cardId, n) => ({ cardId, score: 1 - n * 0.1, via: "code" as const })),
          chosenCardId: card,
          variant: card ? (p.variant ?? CARDS.find((c) => c.id === card)!.variants[0]!) : null,
          decision: p.decision ?? (card ? "confirmed" : "pending"),
          claimManual: p.claimManual ?? false,
        }
      }),
    )
    .returning({ id: scanResults.id })
  return { scanId: scan!.id, resultIds: rows.map((r) => r.id) }
}

export { CARDS, seedCards, seedScan }
export type { PocketSeed }
