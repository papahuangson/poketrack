import {
  ProviderError,
  type CardPrice,
  type CatalogCard,
  type CatalogProvider,
  type CatalogSet,
  type PricedCard,
  type PriceProvider,
} from "../types"

const BASE_URL = "https://api.tcgdex.net/v2/en"
const TIMEOUT_MS = 20_000
const ATTEMPTS = 5
const MAX_RETRY_AFTER_MS = 30_000
const CONCURRENCY = 8
/** Pokémon TCG Pocket is a digital game; its cards cannot be owned or priced. */
const DIGITAL_SERIES = new Set(["tcgp"])

type ApiCardCount = { total?: number; official?: number }

type ApiSetBrief = { id: string }

type ApiSet = {
  id: string
  name: string
  serie?: { id?: string; name?: string }
  releaseDate?: string
  tcgOnline?: string
  abbreviation?: { official?: string }
  symbol?: string
  cardCount?: ApiCardCount
  cards?: { id: string }[]
}

type ApiVariantPrice = { lowPrice?: number | null; marketPrice?: number | null }

type ApiCard = {
  id: string
  localId: string
  name: string
  rarity?: string
  image?: string
  set: { id: string; cardCount?: ApiCardCount }
  variants?: { normal?: boolean; holo?: boolean; reverse?: boolean }
  attacks?: { name?: string; effect?: string }[]
  abilities?: { name?: string; effect?: string }[]
  effect?: string
  legal?: { standard?: boolean; expanded?: boolean }
  pricing?: {
    tcgplayer?: Record<string, unknown> | null
    cardmarket?: { trend?: number | null; "trend-holo"?: number | null } | null
  } | null
}

type Options = { fetch?: typeof fetch; retryDelayMs?: number; attempts?: number; timeoutMs?: number; concurrency?: number }

const cents = (amount: number | null | undefined): number | null =>
  typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) : null

const positiveCents = (amount: number | null | undefined): number | null => {
  const value = cents(amount)
  return value !== null && value > 0 ? value : null
}

/** "reverse-holofoil" → "reverseHolofoil", "1st-edition-holofoil" → "1stEditionHolofoil". */
const camel = (key: string) => key.replace(/-([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())

function tcgplayerPrices(c: ApiCard): [string, ApiVariantPrice][] {
  return Object.entries(c.pricing?.tcgplayer ?? {})
    .filter((entry): entry is [string, ApiVariantPrice] => typeof entry[1] === "object" && entry[1] !== null)
    .map(([key, price]) => [camel(key), price])
}

function printedVariants(c: ApiCard): string[] {
  const variants: string[] = []
  if (c.variants?.normal) variants.push("normal")
  if (c.variants?.holo) variants.push("holofoil")
  if (c.variants?.reverse) variants.push("reverseHolofoil")
  return variants
}

function rulesText(c: ApiCard): string {
  const parts: (string | undefined)[] = []
  for (const attack of c.attacks ?? []) parts.push(attack.name, attack.effect)
  for (const ability of c.abilities ?? []) parts.push(ability.name, ability.effect)
  parts.push(c.effect)
  return parts.filter((part): part is string => Boolean(part)).join("\n")
}

function mapSet(s: ApiSet): CatalogSet {
  return {
    id: s.id,
    name: s.name,
    series: s.serie?.name ?? "",
    printedTotal: s.cardCount?.official ?? 0,
    releaseDate: s.releaseDate ?? "1970-01-01",
    ptcgoCode: s.abbreviation?.official ?? s.tcgOnline ?? null,
    symbolUrl: s.symbol ? `${s.symbol}.png` : null,
    // TCGdex has no per-set "updated" stamp, so a change in card count is what triggers a re-sync.
    updatedAt: `cards:${s.cardCount?.total ?? 0}`,
  }
}

function mapCard(c: ApiCard): CatalogCard {
  const priced = tcgplayerPrices(c).map(([variant]) => variant)
  const legalities: Record<string, string> = {}
  if (c.legal?.standard) legalities.standard = "Legal"
  if (c.legal?.expanded) legalities.expanded = "Legal"
  return {
    id: c.id,
    name: c.name,
    setId: c.set.id,
    number: c.localId,
    printedTotal: c.set.cardCount?.official ?? 0,
    rarity: c.rarity ?? null,
    imageSmall: c.image ? `${c.image}/low.webp` : null,
    imageLarge: c.image ? `${c.image}/high.webp` : null,
    legalities,
    rulesText: rulesText(c),
    variants: priced.length > 0 ? priced : printedVariants(c),
  }
}

function mapPrices(c: ApiCard): CardPrice[] {
  const market = c.pricing?.cardmarket
  return tcgplayerPrices(c).map(([variant, price]) => ({
    cardId: c.id,
    variant,
    marketCents: cents(price.marketPrice),
    lowCents: cents(price.lowPrice),
    cardmarketTrendEurCents: positiveCents(variant === "reverseHolofoil" ? market?.["trend-holo"] : market?.trend),
  }))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function pool<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function createTcgdex(opts: Options = {}): CatalogProvider & PriceProvider {
  const doFetch = opts.fetch ?? fetch
  const retryDelayMs = opts.retryDelayMs ?? 1000
  const attempts = opts.attempts ?? ATTEMPTS
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const concurrency = opts.concurrency ?? CONCURRENCY
  const setPages = new Map<string, ApiSet>()

  /** Resolves to null for a 404, which TCGdex returns for ids it does not know. */
  async function request<T>(path: string): Promise<T | null> {
    let last: ProviderError | undefined
    let retryAfterMs = 0
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(Math.max(retryDelayMs * 2 ** (attempt - 1), retryAfterMs))
      let response: Response
      try {
        response = await doFetch(`${BASE_URL}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
        if (response.ok) return (await response.json()) as T
      } catch (cause) {
        last = new ProviderError(`tcgdex ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)
        continue
      }
      if (response.status === 404) return null
      // TCGdex answers 503 or 429 when it is busy; wait as long as it asks, within reason.
      const retryAfter = Number(response.headers.get("retry-after"))
      retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS) : 0
      last = new ProviderError(`tcgdex ${path} responded ${response.status}`, response.status)
      if (response.status !== 429 && response.status < 500) throw last
    }
    throw last ?? new ProviderError(`tcgdex ${path} failed`)
  }

  async function setPage(setId: string): Promise<ApiSet | null> {
    const known = setPages.get(setId)
    if (known) return known
    const page = await request<ApiSet>(`/sets/${encodeURIComponent(setId)}`)
    if (page) setPages.set(setId, page)
    return page
  }

  async function fullCards(cardIds: string[]): Promise<ApiCard[]> {
    const cards = await pool(cardIds, concurrency, (id) => request<ApiCard>(`/cards/${encodeURIComponent(id)}`))
    return cards.filter((card): card is ApiCard => card !== null)
  }

  return {
    async listSets() {
      const briefs = (await request<ApiSetBrief[]>("/sets")) ?? []
      const pages = await pool(briefs, concurrency, (brief) => setPage(brief.id))
      return pages
        .filter((page): page is ApiSet => page !== null && !DIGITAL_SERIES.has(page.serie?.id ?? ""))
        .map(mapSet)
    },
    async listCardsInSet(setId) {
      const page = await setPage(setId)
      return (await fullCards((page?.cards ?? []).map((card) => card.id))).map(mapCard)
    },
    async getPrices(cardIds) {
      return (await fullCards(cardIds)).map((card): PricedCard => ({ card: mapCard(card), prices: mapPrices(card) }))
    },
  }
}

export { createTcgdex }
