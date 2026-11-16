import { sql, type Condition, type Db, type SQL } from "@poketrack/db"
import { normalizeText } from "@poketrack/jobs"
import { listBinders } from "./binders"
import { escapeLike, parseQuery } from "./collection"

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

type Where =
  | { kind: "pocket"; binder: string; page: number; slot: number; resultId: number }
  | { kind: "unplaced"; binder: string; lotId: number }
  | { kind: "loose"; lotId: number }

type OwnedHit = {
  cardId: string
  name: string
  setName: string
  number: string
  printedTotal: number
  imageSmall: string | null
  variant: string
  condition: Condition
  where: Where
}

type CardRef = { resultId: number } | { lotId: number }

type CardDetail = {
  mode: "pocket" | "group"
  resultId: number | null
  lotId: number | null
  cardId: string
  name: string
  setName: string
  number: string
  printedTotal: number
  rarity: string | null
  imageLarge: string | null
  imageSmall: string | null
  cardVariants: string[]
  variant: string
  condition: Condition
  lot: { quantity: number; pocketed: number; surplus: number; paidCents: number | null; acquiredOn: string | null; binder: string | null } | null
  price: { marketCents: number | null; previousCents: number | null; history: { date: string; cents: number }[] }
  places: { where: Where; thisOne: boolean }[]
  scanLink: { binder: string; page: number } | null
}

const HISTORY_DAYS = 90
const DAY_MS = 24 * 60 * 60 * 1000

// Every place an owned copy is: present pockets (kind 0), copies in a binder that no pocket accounts for (1),
// and copies with no binder (2).
const OWNED_PLACES = sql`
  select 0 as kind, l.card_id, l.variant, l.condition, l.binder, l.page, l.slot, l.result_id, l.lot_id
  from (${LIVE_POCKETS}) l
  where l.present
  union all
  select case when coalesce(trim(ci.binder), '') = '' then 2 else 1 end as kind, ci.card_id, ci.variant, ci.condition,
         nullif(trim(ci.binder), '') as binder, null::int as page, null::int as slot, null::int as result_id, ci.id as lot_id
  from collection_items ci
  left join (select lot_id, count(*)::int as pockets from (${LIVE_POCKETS}) l2 group by lot_id) n on n.lot_id = ci.id
  where ci.quantity - coalesce(n.pockets, 0) > 0`

type PlaceRow = { kind: 0 | 1 | 2; binder: string | null; page: number | null; slot: number | null; resultId: number | null; lotId: number }

function whereOf(row: PlaceRow): Where {
  if (row.kind === 0) return { kind: "pocket", binder: row.binder!, page: row.page!, slot: row.slot!, resultId: row.resultId! }
  if (row.kind === 1) return { kind: "unplaced", binder: row.binder!, lotId: row.lotId }
  return { kind: "loose", lotId: row.lotId }
}

const PLACE_COLUMNS = sql`h.kind, h.binder, h.page, h.slot, h.result_id as "resultId", h.lot_id as "lotId"`
const PLACE_ORDER = sql`h.kind, lower(h.binder), h.page, h.slot, h.lot_id`

async function searchOwned(db: Db, q: string, limit = 20): Promise<OwnedHit[]> {
  const whole = normalizeText(q)
  const { name, number } = parseQuery(q)
  if (whole.length < 2 && number === null) return []

  // Same matching as searchCards in lib/collection.ts.
  const contains = (text: string) => `%${escapeLike(text.replaceAll(" ", ""))}%`
  const compact = sql`replace(c.name_search, ' ', '')`
  const byNumber = sql`ltrim(substring(c.number from '^[0-9]+'), '0') = ${number}`
  const byWholeName = sql`${compact} like ${contains(whole)}`
  let where: SQL
  let rankName = whole
  if (number === null) {
    where = byWholeName
  } else if (name === "") {
    where = whole.length >= 2 ? sql`(${byNumber} or ${byWholeName})` : byNumber
  } else {
    where = sql`(${byNumber} and ${compact} like ${contains(name)})`
    rankName = name
  }

  const found = await rows<Omit<OwnedHit, "where"> & PlaceRow>(
    db,
    sql`
      select c.id as "cardId", c.name, s.name as "setName", c.number, c.printed_total as "printedTotal",
             c.image_small as "imageSmall", h.variant, h.condition, ${PLACE_COLUMNS}
      from (${OWNED_PLACES}) h
      join cards c on c.id = h.card_id
      join sets s on s.id = c.set_id
      where ${where}
      order by
        case when c.name_search = ${rankName} then 0
             when c.name_search like ${`${escapeLike(rankName)}%`} then 1
             else 2 end,
        c.name, c.id, ${PLACE_ORDER}
      limit ${limit}
    `,
  )
  return found.map(({ kind, binder, page, slot, resultId, lotId, ...hit }) => ({ ...hit, where: whereOf({ kind, binder, page, slot, resultId, lotId }) }))
}

async function loadCardDetail(db: Db, ref: CardRef): Promise<CardDetail | null> {
  let opened: { resultId: number | null; lotId: number | null; cardId: string; variant: string; condition: Condition; scanLink: CardDetail["scanLink"] }
  if ("resultId" in ref) {
    const [pocket] = await rows<{ lotId: number | null; cardId: string; variant: string | null; condition: Condition; binder: string; page: number; present: boolean }>(
      db,
      sql`select l.lot_id as "lotId", l.card_id as "cardId", l.variant, l.condition, l.binder, l.page, l.present
          from (${LIVE_POCKETS}) l where l.result_id = ${ref.resultId}`,
    )
    if (!pocket || pocket.variant === null) return null
    opened = {
      resultId: ref.resultId,
      lotId: pocket.present ? pocket.lotId : null,
      cardId: pocket.cardId,
      variant: pocket.variant,
      condition: pocket.condition,
      scanLink: { binder: pocket.binder, page: pocket.page },
    }
  } else {
    const [lot] = await rows<{ cardId: string; variant: string; condition: Condition }>(
      db,
      sql`select card_id as "cardId", variant, condition from collection_items where id = ${ref.lotId}`,
    )
    if (!lot) return null
    opened = { resultId: null, lotId: ref.lotId, ...lot, scanLink: null }
  }

  const [card] = await rows<Pick<CardDetail, "name" | "setName" | "number" | "printedTotal" | "rarity" | "imageLarge" | "imageSmall" | "cardVariants">>(
    db,
    sql`select c.name, s.name as "setName", c.number, c.printed_total as "printedTotal", c.rarity,
               c.image_large as "imageLarge", c.image_small as "imageSmall", c.variants as "cardVariants"
        from cards c join sets s on s.id = c.set_id where c.id = ${opened.cardId}`,
  )
  if (!card) return null

  let lot: CardDetail["lot"] = null
  if (opened.lotId !== null) {
    const [found] = await rows<{ quantity: number; paidCents: number | null; acquiredOn: string | null; binder: string | null }>(
      db,
      sql`select quantity, round(paid_usd * 100)::int as "paidCents", acquired_on::text as "acquiredOn", binder
          from collection_items where id = ${opened.lotId}`,
    )
    if (found) {
      const pocketed = (await pocketCounts(db, [opened.lotId])).get(opened.lotId) ?? 0
      lot = { ...found, pocketed, surplus: Math.max(0, found.quantity - pocketed) }
    }
  }

  const snapshots = await rows<{ date: string; cents: number }>(
    db,
    sql`select date::text as date, round(market_usd * 100)::int as cents from price_snapshots
        where card_id = ${opened.cardId} and variant = ${opened.variant} and market_usd is not null
        order by date desc`,
  )
  const newest = snapshots[0]
  const history = newest
    ? snapshots.filter((s) => Date.parse(newest.date) - Date.parse(s.date) <= HISTORY_DAYS * DAY_MS).reverse()
    : []

  const places = await rows<PlaceRow>(
    db,
    sql`select ${PLACE_COLUMNS} from (${OWNED_PLACES}) h where h.card_id = ${opened.cardId} order by ${PLACE_ORDER}`,
  )

  return {
    mode: opened.resultId !== null ? "pocket" : "group",
    resultId: opened.resultId,
    lotId: lot ? opened.lotId : null,
    cardId: opened.cardId,
    ...card,
    variant: opened.variant,
    condition: opened.condition,
    lot,
    price: { marketCents: newest?.cents ?? null, previousCents: snapshots[1]?.cents ?? null, history },
    places: places.map((row) => ({
      where: whereOf(row),
      thisOne: row.kind === 0 ? row.resultId === opened.resultId : opened.resultId === null && row.lotId === opened.lotId,
    })),
    scanLink: opened.scanLink,
  }
}

export {
  binderPageCount,
  LIVE_POCKETS,
  loadBinderPage,
  loadCardDetail,
  loadUnplaced,
  pocketCounts,
  resolveBinder,
  searchOwned,
}
export type { BinderPage, CardDetail, CardRef, OwnedHit, PocketState, PocketView, UnplacedLot, Where }
