import { sql, type Condition, type Db, type SQL } from "@poketrack/db"
import { listBinders } from "./binders"

type PocketState = "card" | "empty" | "missing"

type PocketView = {
  slot: number
  state: PocketState
  resultId: number | null
  lotId: number | null
  cardId: string | null
  name: string | null
  setName: string | null
  number: string | null
  printedTotal: number | null
  imageSmall: string | null
  variant: string | null
  condition: Condition | null
  marketCents: number | null
}

type BinderPage = {
  binder: string
  page: number
  pageCount: number
  scanId: number | null
  pockets: PocketView[]
  valueCents: number
  unpricedCount: number
}

type UnplacedLot = {
  lotId: number
  cardId: string
  name: string
  setName: string
  number: string
  printedTotal: number
  imageSmall: string | null
  variant: string
  condition: Condition
  surplus: number
  marketCents: number | null
}

const SLOTS = 9

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

const key = (binder: string) => binder.trim().toLowerCase()

// A live pocket: a confirmed, non-empty, not-removed pocket of a committed scan.
// `present` is true while its lot still has a copy for it: a lot's copies fill its pockets in page, then slot order.
const LIVE_POCKETS = sql`
  select r.id as result_id, r.scan_id, trim(s.binder) as binder, s.page, r.slot,
         r.collection_item_id as lot_id, r.chosen_card_id as card_id, r.variant, r.condition,
         (r.collection_item_id is not null
           and row_number() over (partition by r.collection_item_id order by s.page, r.slot) <= ci.quantity) as present
  from scan_results r
  join scans s on s.id = r.scan_id
  left join collection_items ci on ci.id = r.collection_item_id
  where s.status = 'committed' and r.decision = 'confirmed' and not r.empty and r.removed_at is null
    and r.chosen_card_id is not null`

// Latest market price in cents for a card and variant (same rule as snapshotCents(0) in lib/collection.ts).
const latestCents = (cardId: SQL, variant: SQL) => sql`(
  select round(p.market_usd * 100)::int
  from price_snapshots p
  where p.card_id = ${cardId} and p.variant = ${variant} and p.market_usd is not null
  order by p.date desc
  limit 1
)`

async function resolveBinder(db: Db, name: string): Promise<string | null> {
  if (key(name) === "") return null
  return (await listBinders(db)).find((stored) => key(stored) === key(name)) ?? null
}

async function binderPageCount(db: Db, binder: string): Promise<number> {
  const [row] = await rows<{ pages: number | null }>(
    db,
    sql`select max(page)::int as pages from scans where status = 'committed' and lower(trim(binder)) = ${key(binder)}`,
  )
  return row?.pages ?? 0
}

const emptyPocket = (slot: number): PocketView => ({
  slot,
  state: "empty",
  resultId: null,
  lotId: null,
  cardId: null,
  name: null,
  setName: null,
  number: null,
  printedTotal: null,
  imageSmall: null,
  variant: null,
  condition: null,
  marketCents: null,
})

async function loadBinderPage(db: Db, binder: string, page: number): Promise<BinderPage | null> {
  const pageCount = await binderPageCount(db, binder)
  if (!Number.isInteger(page) || page < 1 || page > pageCount) return null
  const stored = (await resolveBinder(db, binder)) ?? binder.trim()
  const base = { binder: stored, page, pageCount }

  const [scan] = await rows<{ id: number }>(
    db,
    sql`select id from scans where status = 'committed' and lower(trim(binder)) = ${key(binder)} and page = ${page} limit 1`,
  )
  if (!scan) return { ...base, scanId: null, pockets: [], valueCents: 0, unpricedCount: 0 }

  const live = await rows<Omit<PocketView, "state"> & { present: boolean }>(
    db,
    sql`
      select l.slot, l.result_id as "resultId", l.lot_id as "lotId", l.card_id as "cardId", c.name, s.name as "setName",
             c.number, c.printed_total as "printedTotal", c.image_small as "imageSmall", l.variant, l.condition,
             ${latestCents(sql`l.card_id`, sql`l.variant`)} as "marketCents", l.present
      from (${LIVE_POCKETS}) l
      join cards c on c.id = l.card_id
      join sets s on s.id = c.set_id
      where l.scan_id = ${scan.id}
    `,
  )
  const bySlot = new Map(live.map((p) => [p.slot, p]))
  const pockets: PocketView[] = []
  let valueCents = 0
  let unpricedCount = 0
  for (let slot = 1; slot <= SLOTS; slot++) {
    const found = bySlot.get(slot)
    if (!found) {
      pockets.push(emptyPocket(slot))
      continue
    }
    const { present, ...pocket } = found
    if (!present) {
      pockets.push({ ...pocket, state: "missing", lotId: null })
      continue
    }
    pockets.push({ ...pocket, state: "card" })
    if (pocket.marketCents === null) unpricedCount++
    else valueCents += pocket.marketCents
  }
  return { ...base, scanId: scan.id, pockets, valueCents, unpricedCount }
}

async function loadUnplaced(db: Db, binder: string): Promise<UnplacedLot[]> {
  return rows<UnplacedLot>(
    db,
    sql`
      select ci.id as "lotId", ci.card_id as "cardId", c.name, s.name as "setName", c.number,
             c.printed_total as "printedTotal", c.image_small as "imageSmall", ci.variant, ci.condition,
             (ci.quantity - coalesce(n.pockets, 0))::int as surplus,
             ${latestCents(sql`ci.card_id`, sql`ci.variant`)} as "marketCents"
      from collection_items ci
      join cards c on c.id = ci.card_id
      join sets s on s.id = c.set_id
      left join (select lot_id, count(*)::int as pockets from (${LIVE_POCKETS}) l group by lot_id) n on n.lot_id = ci.id
      where lower(trim(ci.binder)) = ${key(binder)} and ci.quantity - coalesce(n.pockets, 0) > 0
      order by c.name, ci.id
    `,
  )
}

async function pocketCounts(db: Db, lotIds: number[]): Promise<Map<number, number>> {
  if (lotIds.length === 0) return new Map()
  const found = await rows<{ lotId: number; pockets: number }>(
    db,
    sql`select lot_id as "lotId", count(*)::int as pockets from (${LIVE_POCKETS}) l
        where lot_id in (${sql.join(lotIds.map((id) => sql`${id}`), sql`, `)}) group by lot_id`,
  )
  return new Map(found.map((r) => [r.lotId, r.pockets]))
}

export { binderPageCount, LIVE_POCKETS, latestCents, loadBinderPage, loadUnplaced, pocketCounts, resolveBinder, rows }
export type { BinderPage, PocketState, PocketView, UnplacedLot }
