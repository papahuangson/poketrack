import {
  ProviderError,
  type CardPrice,
  type CatalogCard,
  type CatalogProvider,
  type CatalogSet,
  type PricedCard,
  type PriceProvider,
} from "../types"

const BASE_URL = "https://api.pokemontcg.io/v2"
const PAGE_SIZE = 250
const ID_BATCH = 50
const TIMEOUT_MS = 20_000
const ATTEMPTS = 3

type ApiSet = {
  id: string
  name: string
  series?: string
  printedTotal?: number
  releaseDate?: string
  ptcgoCode?: string
  updatedAt?: string
  images?: { symbol?: string }
}

type ApiVariantPrice = { low?: number | null; market?: number | null }

type ApiCard = {
  id: string
  name: string
  number: string
  rarity?: string
  set: { id: string; printedTotal?: number }
  attacks?: { name?: string; text?: string }[]
  abilities?: { name?: string; text?: string }[]
  rules?: string[]
  legalities?: Record<string, string>
  images?: { small?: string; large?: string }
  tcgplayer?: { prices?: Record<string, ApiVariantPrice> }
  cardmarket?: { prices?: { trendPrice?: number | null; reverseHoloTrend?: number | null } }
}

type Page<T> = { data: T[]; page?: number; pageSize?: number; totalCount?: number }

type Options = { apiKey?: string; fetch?: typeof fetch; retryDelayMs?: number }

const cents = (dollars: number | null | undefined): number | null =>
  typeof dollars === "number" && Number.isFinite(dollars) ? Math.round(dollars * 100) : null

const positiveCents = (amount: number | null | undefined): number | null => {
  const value = cents(amount)
  return value === null || value <= 0 ? null : value
}

function mapSet(s: ApiSet): CatalogSet {
  return {
    id: s.id,
    name: s.name,
    series: s.series ?? "",
    printedTotal: s.printedTotal ?? 0,
    releaseDate: (s.releaseDate ?? "1970/01/01").replaceAll("/", "-"),
    ptcgoCode: s.ptcgoCode ?? null,
    symbolUrl: s.images?.symbol ?? null,
    updatedAt: s.updatedAt ?? "",
  }
}

function rulesText(c: ApiCard): string {
  const named = (x: { name?: string; text?: string }) => `${x.name ?? ""} ${x.text ?? ""}`.trim()
  return [...(c.attacks ?? []).map(named), ...(c.abilities ?? []).map(named), ...(c.rules ?? [])].join("\n")
}

function mapCard(c: ApiCard): CatalogCard {
  return {
    id: c.id,
    name: c.name,
    setId: c.set.id,
    number: c.number,
    printedTotal: c.set.printedTotal ?? 0,
    rarity: c.rarity ?? null,
    imageSmall: c.images?.small ?? null,
    imageLarge: c.images?.large ?? null,
    legalities: c.legalities ?? {},
    rulesText: rulesText(c),
    variants: Object.keys(c.tcgplayer?.prices ?? {}),
  }
}

function mapPrices(c: ApiCard): CardPrice[] {
  const market = c.cardmarket?.prices
  return Object.entries(c.tcgplayer?.prices ?? {}).map(([variant, p]) => ({
    cardId: c.id,
    variant,
    marketCents: cents(p.market),
    lowCents: cents(p.low),
    cardmarketTrendEurCents: positiveCents(variant === "reverseHolofoil" ? market?.reverseHoloTrend : market?.trendPrice),
  }))
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function createPokemonTcgIo(opts: Options = {}): CatalogProvider & PriceProvider {
  const doFetch = opts.fetch ?? fetch
  const retryDelayMs = opts.retryDelayMs ?? 1000
  const headers: Record<string, string> = opts.apiKey ? { "X-Api-Key": opts.apiKey } : {}

  async function request<T>(path: string, params: Record<string, string>): Promise<Page<T>> {
    const url = new URL(`${BASE_URL}${path}`)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

    let last: ProviderError | undefined
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(retryDelayMs * 2 ** (attempt - 1))
      let response: Response
      try {
        response = await doFetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
      } catch (cause) {
        last = new ProviderError(`pokemontcg.io ${path}: ${cause instanceof Error ? cause.message : String(cause)}`)
        continue
      }
      if (response.ok) return (await response.json()) as Page<T>
      last = new ProviderError(`pokemontcg.io ${path} responded ${response.status}`, response.status)
      if (response.status !== 429 && response.status < 500) throw last
    }
    throw last ?? new ProviderError(`pokemontcg.io ${path} failed`)
  }

  async function all<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const items: T[] = []
    for (let page = 1; ; page++) {
      const body = await request<T>(path, { ...params, page: String(page), pageSize: String(PAGE_SIZE) })
      items.push(...body.data)
      if (body.data.length === 0 || page * PAGE_SIZE >= (body.totalCount ?? 0)) return items
    }
  }

  return {
    async listSets() {
      return (await all<ApiSet>("/sets", {})).map(mapSet)
    },
    async listCardsInSet(setId) {
      return (await all<ApiCard>("/cards", { q: `set.id:${setId}` })).map(mapCard)
    },
    async getPrices(cardIds) {
      const priced: PricedCard[] = []
      for (let i = 0; i < cardIds.length; i += ID_BATCH) {
        const batch = cardIds.slice(i, i + ID_BATCH)
        const cards = await all<ApiCard>("/cards", { q: `id:(${batch.join(" OR ")})` })
        priced.push(...cards.map((c) => ({ card: mapCard(c), prices: mapPrices(c) })))
      }
      return priced
    },
  }
}

export { createPokemonTcgIo }
