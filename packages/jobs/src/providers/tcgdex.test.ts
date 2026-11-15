import { expect, test } from "vitest"
import { ProviderError } from "../types"
import live from "./fixtures/tcgdex.json"
import { createTcgdex } from "./tcgdex"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** Serves the captured live responses by path, the way api.tcgdex.net does. */
function api(over: (path: string) => Response | undefined = () => undefined) {
  const paths: string[] = []
  const fetchStub = (async (input: Parameters<typeof fetch>[0]) => {
    const path = decodeURIComponent(new URL(String(input)).pathname.replace("/v2/en", ""))
    paths.push(path)
    const custom = over(path)
    if (custom) return custom
    if (path === "/sets") return json(live.list)
    const [, kind, id] = path.split("/")
    const found = kind === "sets" ? (live.sets as Record<string, unknown>)[id ?? ""] : (live.cards as Record<string, unknown>)[id ?? ""]
    return found ? json(found) : json(live.notFound, 404)
  }) as typeof fetch
  return { fetch: fetchStub, paths }
}

test("listSets maps each set from its detail page", async () => {
  const { fetch } = api()
  const sets = await createTcgdex({ fetch }).listSets()
  expect(sets.find((s) => s.id === "sv03.5")).toEqual({
    id: "sv03.5",
    name: "151",
    series: "Scarlet & Violet",
    printedTotal: 165,
    releaseDate: "2023-09-22",
    ptcgoCode: "MEW",
    symbolUrl: "https://assets.tcgdex.net/univ/sv/sv03.5/symbol.png",
    updatedAt: "cards:207",
  })
  expect(sets.find((s) => s.id === "base1")).toMatchObject({ ptcgoCode: "BS", symbolUrl: null, releaseDate: "1999-01-09" })
})

test("listSets leaves out the digital-only Pokémon TCG Pocket sets", async () => {
  const { fetch } = api()
  const sets = await createTcgdex({ fetch }).listSets()
  expect(sets.map((s) => s.id).sort()).toEqual(["base1", "sv03.5"])
})

test("a set's fingerprint changes when its card count changes", async () => {
  const grown = { ...live.sets["sv03.5"], cardCount: { ...live.sets["sv03.5"].cardCount, total: 208 } }
  const { fetch } = api((path) => (path === "/sets/sv03.5" ? json(grown) : undefined))
  const sets = await createTcgdex({ fetch }).listSets()
  expect(sets.find((s) => s.id === "sv03.5")?.updatedAt).toBe("cards:208")
})

test("listCardsInSet fetches every card in the set in full", async () => {
  const { fetch, paths } = api()
  const cards = await createTcgdex({ fetch }).listCardsInSet("sv03.5")
  expect(cards.map((c) => c.id)).toEqual(["sv03.5-025", "sv03.5-161", "sv03.5-199"])
  expect(cards[2]).toEqual({
    id: "sv03.5-199",
    name: "Charizard ex",
    setId: "sv03.5",
    number: "199",
    printedTotal: 165,
    rarity: "Special illustration rare",
    imageSmall: "https://assets.tcgdex.net/en/sv/sv03.5/199/low.webp",
    imageLarge: "https://assets.tcgdex.net/en/sv/sv03.5/199/high.webp",
    legalities: { expanded: "Legal" },
    rulesText:
      "Brave Wing\nIf this Pokémon has any damage counters on it, this attack does 100 more damage.\nExplosive Vortex\nDiscard 3 Energy from this Pokémon.",
    variants: ["holofoil"],
  })
  expect(paths.filter((p) => p.startsWith("/cards/"))).toHaveLength(3)
})

test("listCardsInSet reuses the set page that listSets already fetched", async () => {
  const { fetch, paths } = api()
  const provider = createTcgdex({ fetch })
  await provider.listSets()
  await provider.listCardsInSet("sv03.5")
  expect(paths.filter((p) => p === "/sets/sv03.5")).toHaveLength(1)
})

test("a card listed by the set but missing from the API is skipped", async () => {
  const { fetch } = api((path) => (path === "/cards/sv03.5-161" ? json(live.notFound, 404) : undefined))
  const cards = await createTcgdex({ fetch }).listCardsInSet("sv03.5")
  expect(cards.map((c) => c.id)).toEqual(["sv03.5-025", "sv03.5-199"])
})

test("variants are the TCGplayer price keys, in the app's naming", async () => {
  const { fetch } = api()
  const priced = await createTcgdex({ fetch }).getPrices(["neo1-9", "sv03.5-025"])
  expect(priced.find((p) => p.card.id === "neo1-9")?.card.variants).toEqual(["1stEditionHolofoil", "unlimitedHolofoil"])
  expect(priced.find((p) => p.card.id === "sv03.5-025")?.card.variants).toEqual(["reverseHolofoil", "normal"])
})

test("getPrices maps market and low prices per variant, with the matching Cardmarket trend", async () => {
  const { fetch } = api()
  const [pikachu] = await createTcgdex({ fetch }).getPrices(["sv03.5-025"])
  expect(pikachu?.prices).toEqual([
    { cardId: "sv03.5-025", variant: "reverseHolofoil", marketCents: 66, lowCents: 20, cardmarketTrendEurCents: 66 },
    { cardId: "sv03.5-025", variant: "normal", marketCents: 29, lowCents: 5, cardmarketTrendEurCents: 13 },
  ])
})

test("a card with no TCGplayer prices keeps its printed variants and has no prices", async () => {
  const { fetch } = api()
  const [promo] = await createTcgdex({ fetch }).getPrices(["svp-500"])
  expect(promo?.card).toMatchObject({ variants: ["normal"], imageSmall: null, imageLarge: null })
  expect(promo?.prices).toEqual([])
})

test("getPrices leaves out ids the API does not know", async () => {
  const { fetch } = api()
  const priced = await createTcgdex({ fetch }).getPrices(["nope-999", "base1-4"])
  expect(priced.map((p) => p.card.id)).toEqual(["base1-4"])
})

test("getPrices with no ids makes no request", async () => {
  const { fetch, paths } = api()
  expect(await createTcgdex({ fetch }).getPrices([])).toEqual([])
  expect(paths).toHaveLength(0)
})

test("rules text covers attacks, abilities and trainer effects", async () => {
  const { fetch } = api()
  const priced = await createTcgdex({ fetch }).getPrices(["base1-4", "sv03.5-161"])
  expect(priced[0]?.card.rulesText).toContain("Fire Spin\nDiscard 2 Energy cards")
  expect(priced[0]?.card.rulesText).toContain("Energy Burn\nAs often as you like")
  expect(priced[1]?.card.rulesText).toBe(
    "Put an Energy attached to your opponent's Active Pokémon into their hand. If you do, attach an Energy card from your hand to your Active Pokémon.",
  )
})

test("a card legal nowhere has no legalities", async () => {
  const { fetch } = api()
  const [charizard] = await createTcgdex({ fetch }).getPrices(["base1-4"])
  expect(charizard?.card.legalities).toEqual({})
})

test("a 500 is retried, and a fifth failure rejects with the status", async () => {
  let n = 0
  const flaky = api((path) => (path === "/sets" && ++n === 1 ? json({ error: "boom" }, 500) : undefined))
  expect(await createTcgdex({ fetch: flaky.fetch, retryDelayMs: 1 }).listSets()).toHaveLength(2)

  const down = api(() => json({ error: "boom" }, 500))
  const err = await createTcgdex({ fetch: down.fetch, retryDelayMs: 1 }).listSets().catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect((err as ProviderError).status).toBe(500)
  expect(down.paths).toHaveLength(5)
})

test("a 503 that says when to retry is retried after that long, not sooner", async () => {
  let n = 0
  const busy = api((path) =>
    path === "/cards/base1-4" && ++n === 1 ? new Response("busy", { status: 503, headers: { "retry-after": "1" } }) : undefined,
  )
  const started = Date.now()
  const priced = await createTcgdex({ fetch: busy.fetch, retryDelayMs: 1 }).getPrices(["base1-4"])
  expect(priced).toHaveLength(1)
  expect(Date.now() - started).toBeGreaterThanOrEqual(950)
})

test("attempts limits how many times a request is tried", async () => {
  const down = api(() => json({ error: "boom" }, 500))
  await expect(createTcgdex({ fetch: down.fetch, retryDelayMs: 1, attempts: 1 }).getPrices(["base1-4"])).rejects.toBeInstanceOf(ProviderError)
  expect(down.paths).toHaveLength(1)
})

test("no more than the configured number of requests are in flight at once", async () => {
  let inFlight = 0
  let peak = 0
  const slow = (async () => {
    inFlight++
    peak = Math.max(peak, inFlight)
    await new Promise((resolve) => setTimeout(resolve, 2))
    inFlight--
    return json(live.cards["base1-4"])
  }) as typeof fetch
  const ids = Array.from({ length: 30 }, (_, i) => `x-${i}`)
  const priced = await createTcgdex({ fetch: slow, concurrency: 4 }).getPrices(ids)
  expect(priced).toHaveLength(30)
  expect(peak).toBe(4)
})
