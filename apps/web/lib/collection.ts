import { cards, chicagoDate, collectionItems, CONDITIONS, type Condition, type Db } from "@poketrack/db"
import { normalizeText } from "@poketrack/jobs"
import { and, desc, eq, ne, sql, type SQL } from "drizzle-orm"
import { ValidationError } from "./errors"

const MAX_QUANTITY = 999

type CardHit = {
  id: string
  name: string
  setName: string
  number: string
  printedTotal: number
  imageSmall: string | null
  variants: string[]
}

type AddInput = { cardId: string; variant: string; condition: Condition; quantity: number; binder?: string | null }

type EditInput = {
  variant: string
  condition: Condition
  quantity: number
  paidCents: number | null
  acquiredOn: string | null
  binder: string | null
}

type Sort = "value" | "name" | "set" | "added"

type CollectionRow = {
  id: number
  cardId: string
  name: string
  setId: string
  setName: string
  number: string
  printedTotal: number
  imageSmall: string | null
  variant: string
  condition: Condition
  quantity: number
  paidCents: number | null
  acquiredOn: string | null
  binder: string | null
  cardVariants: string[]
  marketCents: number | null
  rowTotalCents: number | null
}

type Filters = { setId?: string; variant?: string; condition?: Condition; sort?: Sort }

type LoadedRow = CollectionRow & { previousCents: number | null; releaseDate: string }

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] }
  return result.rows
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

const numberOrder = (number: string) => {
  const digits = /^\d+/.exec(number)
  return digits ? Number(digits[0]) : Number.MAX_SAFE_INTEGER
}

function parseQuery(q: string): { name: string; number: string | null } {
  const tokens = q.trim().split(/\s+/).filter(Boolean)
  const last = tokens.at(-1) ?? ""
  const numbered = /^(\d+)(?:\/\d+)?$/.exec(last)
  if (!numbered) return { name: normalizeText(q), number: null }
  return { name: normalizeText(tokens.slice(0, -1).join(" ")), number: String(Number(numbered[1])) }
}

async function searchCards(db: Db, q: string, limit = 20): Promise<CardHit[]> {
  const whole = normalizeText(q)
  const { name, number } = parseQuery(q)
  if (whole.length < 2 && number === null) return []

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

  const found = await rows<CardHit & { releaseDate: string }>(
    db,
    sql`
      select c.id, c.name, s.name as "setName", c.number, c.printed_total as "printedTotal",
             c.image_small as "imageSmall", c.variants, s.release_date::text as "releaseDate"
      from cards c
      join sets s on s.id = c.set_id
      where ${where}
      order by
        case when c.name_search = ${rankName} then 0
             when c.name_search like ${`${escapeLike(rankName)}%`} then 1
             else 2 end,
        s.release_date desc,
        c.set_id,
        coalesce(nullif(substring(c.number from '^[0-9]+'), '')::int, 2147483647),
        c.number
      limit ${limit}
    `,
  )
  return found.map(({ releaseDate: _releaseDate, ...hit }) => hit)
}

function checkQuantity(quantity: number): void {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    throw new ValidationError("quantity", `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`)
  }
}

function checkLot(variant: string, condition: string): void {
  if (variant.trim() === "") throw new ValidationError("variant", "Choose a variant.")
  if (!CONDITIONS.includes(condition as Condition)) throw new ValidationError("condition", "Choose a condition.")
}

const binderOf = (binder: string | null | undefined) => (binder && binder.trim() !== "" ? binder.trim() : null)

const sameLot = (cardId: string, variant: string, condition: Condition, binder: string | null) =>
  and(
    eq(collectionItems.cardId, cardId),
    eq(collectionItems.variant, variant),
    eq(collectionItems.condition, condition),
    sql`coalesce(${collectionItems.binder}, '') = ${binder ?? ""}`,
  )

async function addItem(db: Db, input: AddInput): Promise<{ id: number; merged: boolean }> {
  checkQuantity(input.quantity)
  checkLot(input.variant, input.condition)
  const binder = binderOf(input.binder)

  const [card] = await db.select({ id: cards.id }).from(cards).where(eq(cards.id, input.cardId))
  if (!card) throw new ValidationError("cardId", "That card is not in the catalog.")

  const [existing] = await db
    .select({ id: collectionItems.id, quantity: collectionItems.quantity })
    .from(collectionItems)
    .where(sameLot(input.cardId, input.variant, input.condition, binder))
  if (existing) {
    checkQuantity(existing.quantity + input.quantity)
    await db
      .update(collectionItems)
      .set({ quantity: existing.quantity + input.quantity })
      .where(eq(collectionItems.id, existing.id))
    return { id: existing.id, merged: true }
  }

  const [created] = await db
    .insert(collectionItems)
    .values({ cardId: input.cardId, variant: input.variant, condition: input.condition, quantity: input.quantity, binder })
    .returning({ id: collectionItems.id })
  if (!created) throw new Error("Insert returned no row")
  return { id: created.id, merged: false }
}

function isRealDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false
  const parsed = new Date(`${text}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
}

async function updateItem(db: Db, id: number, input: EditInput): Promise<void> {
  checkQuantity(input.quantity)
  checkLot(input.variant, input.condition)
  if (input.paidCents !== null && (!Number.isInteger(input.paidCents) || input.paidCents < 0)) {
    throw new ValidationError("paidCents", "Paid price cannot be negative.")
  }
  if (input.acquiredOn !== null && (!isRealDate(input.acquiredOn) || input.acquiredOn > chicagoDate())) {
    throw new ValidationError("acquiredOn", "Enter a real date that is not in the future.")
  }
  const binder = binderOf(input.binder)

  const [current] = await db.select({ cardId: collectionItems.cardId }).from(collectionItems).where(eq(collectionItems.id, id))
  if (!current) throw new ValidationError("id", "That card is no longer in your collection.")

  const [clash] = await db
    .select({ id: collectionItems.id })
    .from(collectionItems)
    .where(and(sameLot(current.cardId, input.variant, input.condition, binder), ne(collectionItems.id, id)))
  if (clash) {
    throw new ValidationError(
      "variant",
      "You already have this card with that variant and condition. Change its quantity instead.",
    )
  }

  await db
    .update(collectionItems)
    .set({
      variant: input.variant,
      condition: input.condition,
      quantity: input.quantity,
      paidUsd: input.paidCents === null ? null : input.paidCents / 100,
      acquiredOn: input.acquiredOn,
      binder,
    })
    .where(eq(collectionItems.id, id))
}

async function removeItem(db: Db, id: number): Promise<void> {
  await db.delete(collectionItems).where(eq(collectionItems.id, id))
}

function snapshotCents(offset: number): SQL {
  return sql`(
    select round(p.market_usd * 100)::int
    from price_snapshots p
    where p.card_id = ci.card_id and p.variant = ci.variant and p.market_usd is not null
    order by p.date desc
    limit 1 offset ${sql.raw(String(offset))}
  )`
}

async function loadRows(db: Db, f: Omit<Filters, "sort">): Promise<LoadedRow[]> {
  const conditions: SQL[] = [sql`true`]
  if (f.setId) conditions.push(sql`c.set_id = ${f.setId}`)
  if (f.variant) conditions.push(sql`ci.variant = ${f.variant}`)
  if (f.condition) conditions.push(sql`ci.condition = ${f.condition}`)

  const loaded = await rows<Omit<LoadedRow, "rowTotalCents">>(
    db,
    sql`
      select ci.id, ci.card_id as "cardId", c.name, c.set_id as "setId", s.name as "setName", c.number,
             c.printed_total as "printedTotal", c.image_small as "imageSmall", ci.variant, ci.condition,
             ci.quantity, round(ci.paid_usd * 100)::int as "paidCents", ci.acquired_on::text as "acquiredOn",
             ci.binder, c.variants as "cardVariants",
             ${snapshotCents(0)} as "marketCents", ${snapshotCents(1)} as "previousCents",
             s.release_date::text as "releaseDate"
      from collection_items ci
      join cards c on c.id = ci.card_id
      join sets s on s.id = c.set_id
      where ${sql.join(conditions, sql` and `)}
    `,
  )
  return loaded.map((row) => ({
    ...row,
    rowTotalCents: row.marketCents === null ? null : row.marketCents * row.quantity,
  }))
}

const byNumber = (a: LoadedRow, b: LoadedRow) =>
  numberOrder(a.number) - numberOrder(b.number) || a.number.localeCompare(b.number)

const SORTS: Record<Sort, (a: LoadedRow, b: LoadedRow) => number> = {
  value: (a, b) => (b.rowTotalCents ?? -1) - (a.rowTotalCents ?? -1) || a.name.localeCompare(b.name) || b.id - a.id,
  name: (a, b) => a.name.localeCompare(b.name) || b.releaseDate.localeCompare(a.releaseDate) || byNumber(a, b),
  set: (a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.setId.localeCompare(b.setId) || byNumber(a, b),
  added: (a, b) => b.id - a.id,
}

async function listCollection(db: Db, f: Filters): Promise<CollectionRow[]> {
  const loaded = await loadRows(db, f)
  return loaded
    .sort(SORTS[f.sort ?? "value"])
    .map(({ previousCents: _previous, releaseDate: _release, ...row }) => row)
}

async function collectionTotals(db: Db): Promise<{ totalCents: number; changeCents: number | null; unpricedCount: number }> {
  let totalCents = 0
  let changeCents: number | null = null
  let unpricedCount = 0
  for (const row of await loadRows(db, {})) {
    if (row.marketCents === null) {
      unpricedCount++
      continue
    }
    totalCents += row.marketCents * row.quantity
    if (row.previousCents !== null) {
      changeCents = (changeCents ?? 0) + (row.marketCents - row.previousCents) * row.quantity
    }
  }
  return { totalCents, changeCents, unpricedCount }
}

async function collectionFilterOptions(db: Db): Promise<{ sets: { id: string; name: string }[]; variants: string[] }> {
  const loaded = await loadRows(db, {})
  const sets = new Map<string, { id: string; name: string; releaseDate: string }>()
  for (const row of loaded) sets.set(row.setId, { id: row.setId, name: row.setName, releaseDate: row.releaseDate })
  return {
    sets: [...sets.values()]
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.name.localeCompare(b.name))
      .map(({ id, name }) => ({ id, name })),
    variants: [...new Set(loaded.map((row) => row.variant))].sort(),
  }
}

async function defaultVariant(db: Db, cardVariants: string[]): Promise<string> {
  const [latest] = await db
    .select({ variant: collectionItems.variant })
    .from(collectionItems)
    .orderBy(desc(collectionItems.id))
    .limit(1)
  if (latest && cardVariants.includes(latest.variant)) return latest.variant
  return cardVariants[0] ?? "normal"
}

export {
  addItem,
  collectionFilterOptions,
  collectionTotals,
  defaultVariant,
  listCollection,
  removeItem,
  searchCards,
  updateItem,
}
export type { AddInput, CardHit, CollectionRow, EditInput, Filters, Sort }
