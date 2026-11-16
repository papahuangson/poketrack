import type { Candidate, Db, SlotCues } from "@poketrack/db"
import { normalizeText } from "@poketrack/jobs"
import { sql, type SQL } from "drizzle-orm"
import { parseNumber } from "./parse"

type SlotRead = {
  name: string | null
  numberAsPrinted: string | null
  setCode: string | null
  cues: SlotCues
  confidence: number
}

type Match = { candidates: Candidate[]; confidence: number }

const MAX_CANDIDATES = 3
const NAME_FLOOR = 0.4
const FUZZY_FLOOR = 0.2

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

const round = (n: number) => Math.round(n * 1000) / 1000

function sameNumber(number: string): SQL {
  return /^\d+$/.test(number)
    ? sql`(c.number ~ '^[0-9]+$' and ltrim(c.number, '0') = ${number})`
    : sql`upper(c.number) = ${number}`
}

const nameSimilarity = (name: string) =>
  sql`greatest(similarity(c.name_search, ${name}), word_similarity(${name}, c.name_search))`

async function bySetCode(db: Db, setCode: string, number: string): Promise<Candidate[]> {
  const found = await rows<{ id: string }>(
    db,
    sql`select c.id from cards c join sets s on s.id = c.set_id
        where lower(s.ptcgo_code) = lower(${setCode.trim()}) and ${sameNumber(number)}
        order by c.id limit ${MAX_CANDIDATES}`,
  )
  return found.map((c) => ({ cardId: c.id, score: 1, via: "code" }))
}

async function byPrintedTotal(db: Db, total: number, number: string, name: string | null): Promise<Candidate[]> {
  const found = await rows<{ id: string; sim: number }>(
    db,
    sql`select c.id, ${name ? nameSimilarity(name) : sql`0`}::float as sim
        from cards c join sets s on s.id = c.set_id
        where s.printed_total = ${total} and ${sameNumber(number)}
        order by sim desc, c.id`,
  )
  if (name !== null && !found.some((c) => c.sim >= NAME_FLOOR)) return []
  if (found.length === 1) return [{ cardId: found[0]!.id, score: 0.9, via: "total" }]
  return found.slice(0, MAX_CANDIDATES).map((c) => ({
    cardId: c.id,
    score: round(c.sim >= NAME_FLOOR || name === null ? 0.5 + 0.3 * c.sim : 0.3 * c.sim),
    via: "total",
  }))
}

async function byName(db: Db, name: string, number: string | null): Promise<Candidate[]> {
  const boost = number ? sql`case when ${sameNumber(number)} then 0.3 else 0 end` : sql`0`
  const found = await rows<{ id: string; sim: number; rank: number }>(
    db,
    sql`select c.id, ${nameSimilarity(name)}::float as sim, (${nameSimilarity(name)} + ${boost})::float as rank
        from cards c
        where ${nameSimilarity(name)} >= ${FUZZY_FLOOR}
        order by rank desc, c.id
        limit ${MAX_CANDIDATES}`,
  )
  return found.map((c) => ({ cardId: c.id, score: round(Math.min(0.7, 0.7 * c.rank)), via: "name" }))
}

async function matchSlot(db: Db, read: SlotRead): Promise<Match> {
  const parsed = parseNumber(read.numberAsPrinted)
  const name = read.name ? normalizeText(read.name) : null

  let candidates: Candidate[] = []
  if (parsed && read.setCode?.trim()) candidates = await bySetCode(db, read.setCode, parsed.number)
  if (candidates.length === 0 && parsed?.printedTotal) {
    candidates = await byPrintedTotal(db, parsed.printedTotal, parsed.number, name || null)
  }
  if (candidates.length === 0 && name) candidates = await byName(db, name, parsed?.number ?? null)

  const best = candidates[0]?.score ?? 0
  return { candidates, confidence: candidates.length === 0 ? 0 : Math.min(read.confidence, best) }
}

function proposeVariant(cues: SlotCues, cardVariants: string[], fallback: string): string {
  if (cues.reverse && cardVariants.includes("reverseHolofoil")) return "reverseHolofoil"
  if (cues.holo && cardVariants.includes("holofoil")) return "holofoil"
  if (cardVariants.includes(fallback)) return fallback
  return cardVariants[0] ?? fallback
}

export { matchSlot, proposeVariant }
export type { Match, SlotRead }
