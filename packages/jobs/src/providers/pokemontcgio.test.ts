import { expect, test } from "vitest"
import { ProviderError } from "../types"
import cardsById from "./fixtures/cards-by-id.json"
import setsFixture from "./fixtures/sets.json"
import { createPokemonTcgIo } from "./pokemontcgio"

type Handler = (url: URL, init?: RequestInit) => Response | Promise<Response>

function stub(handler: Handler) {
  const calls: { url: URL; init?: RequestInit }[] = []
  const fetchStub = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input))
    calls.push({ url, init })
    return handler(url, init)
  }) as typeof fetch
  return { fetch: fetchStub, calls }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

function fakeCard(n: number) {
  return { id: `x-${n}`, name: `Card ${n}`, number: String(n), set: { id: "x", printedTotal: 300 }, images: {} }
}

test("listSets maps the provider fields", async () => {
  const { fetch } = stub(() => json(setsFixture))
  const sets = await createPokemonTcgIo({ fetch }).listSets()
  expect(sets[0]).toEqual({
    id: "sv3pt5",
    name: "151",
    series: "Scarlet & Violet",
    printedTotal: 165,
    releaseDate: "2023-09-22",
    ptcgoCode: "MEW",
    symbolUrl: "https://images.pokemontcg.io/sv3pt5/symbol.png",
    updatedAt: "2023/09/22 15:00:00",
  })
  expect(sets[1]?.ptcgoCode).toBeNull()
})

test("listCardsInSet follows pages until totalCount is reached", async () => {
  const all = Array.from({ length: 300 }, (_, i) => fakeCard(i + 1))
  const { fetch, calls } = stub((url) => {
    const page = Number(url.searchParams.get("page") ?? "1")
    const data = all.slice((page - 1) * 250, page * 250)
    return json({ data, page, pageSize: 250, count: data.length, totalCount: 300 })
  })
  const cards = await createPokemonTcgIo({ fetch }).listCardsInSet("x")
  expect(cards).toHaveLength(300)
  expect(calls).toHaveLength(2)
  expect(calls[0]?.url.searchParams.get("q")).toBe("set.id:x")
  expect(calls[0]?.url.searchParams.get("pageSize")).toBe("250")
})

test("getPrices maps variants and converts dollars to cents", async () => {
  const { fetch } = stub(() => json(cardsById))
  const priced = await createPokemonTcgIo({ fetch }).getPrices(["sv3pt5-199"])
  const charizard = priced.find((p) => p.card.id === "sv3pt5-199")
  expect(charizard?.card.variants).toEqual(["holofoil"])
  expect(charizard?.prices).toEqual([
    { cardId: "sv3pt5-199", variant: "holofoil", marketCents: 9840, lowCents: 8500, cardmarketTrendEurCents: 9237 },
  ])
  expect(charizard?.card).toMatchObject({
    name: "Charizard ex",
    setId: "sv3pt5",
    number: "199",
    printedTotal: 165,
    imageSmall: "https://images.pokemontcg.io/sv3pt5/199.png",
    legalities: { unlimited: "Legal", standard: "Legal", expanded: "Legal" },
  })
  expect(charizard?.card.rulesText).toContain("Brave Wing")
  expect(charizard?.card.rulesText).toContain("Pokémon ex rule")
})

test("reverse holo uses the reverse holo trend, other variants use the trend price", async () => {
  const { fetch } = stub(() => json(cardsById))
  const priced = await createPokemonTcgIo({ fetch }).getPrices(["sv3pt5-25"])
  const prices = priced.find((p) => p.card.id === "sv3pt5-25")?.prices
  expect(prices).toEqual([
    { cardId: "sv3pt5-25", variant: "normal", marketCents: 21, lowCents: 5, cardmarketTrendEurCents: 12 },
    { cardId: "sv3pt5-25", variant: "reverseHolofoil", marketCents: 56, lowCents: 20, cardmarketTrendEurCents: 48 },
  ])
})

test("a card with no tcgplayer block has no variants and no prices", async () => {
  const { fetch } = stub(() => json(cardsById))
  const priced = await createPokemonTcgIo({ fetch }).getPrices(["svp-44"])
  const flabebe = priced.find((p) => p.card.id === "svp-44")
  expect(flabebe?.card.variants).toEqual([])
  expect(flabebe?.prices).toEqual([])
})

test("a missing market price or cardmarket block maps to null", async () => {
  const { fetch } = stub(() => json(cardsById))
  const priced = await createPokemonTcgIo({ fetch }).getPrices(["base1-58"])
  expect(priced.find((p) => p.card.id === "base1-58")?.prices).toEqual([
    { cardId: "base1-58", variant: "normal", marketCents: 410, lowCents: 200, cardmarketTrendEurCents: null },
    { cardId: "base1-58", variant: "1stEditionNormal", marketCents: null, lowCents: 3000, cardmarketTrendEurCents: null },
  ])
})

test("getPrices asks for ids in batches of 50", async () => {
  const ids = Array.from({ length: 120 }, (_, i) => `x-${i + 1}`)
  const { fetch, calls } = stub(() => json({ data: [], page: 1, pageSize: 250, count: 0, totalCount: 0 }))
  await createPokemonTcgIo({ fetch }).getPrices(ids)
  expect(calls).toHaveLength(3)
  expect(calls[0]?.url.searchParams.get("q")).toMatch(/^id:"x-1" OR id:"x-2" OR /)
  expect(calls[2]?.url.searchParams.get("q")?.split(" OR ")).toHaveLength(20)
})

test("getPrices with no ids makes no request", async () => {
  const { fetch, calls } = stub(() => json({}))
  expect(await createPokemonTcgIo({ fetch }).getPrices([])).toEqual([])
  expect(calls).toHaveLength(0)
})

test("a 429 is retried", async () => {
  let n = 0
  const { fetch, calls } = stub(() => (++n === 1 ? json({ error: "slow down" }, 429) : json(setsFixture)))
  const sets = await createPokemonTcgIo({ fetch, retryDelayMs: 1 }).listSets()
  expect(sets).toHaveLength(2)
  expect(calls).toHaveLength(2)
})

test("three 500s in a row reject with the status", async () => {
  const { fetch, calls } = stub(() => json({ error: "boom" }, 500))
  const err = await createPokemonTcgIo({ fetch, retryDelayMs: 1 }).listSets().catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ProviderError)
  expect((err as ProviderError).status).toBe(500)
  expect(calls).toHaveLength(3)
})

test("a 404 is not retried", async () => {
  const { fetch, calls } = stub(() => json({ error: "nope" }, 404))
  await expect(createPokemonTcgIo({ fetch, retryDelayMs: 1 }).listSets()).rejects.toBeInstanceOf(ProviderError)
  expect(calls).toHaveLength(1)
})

test("a network failure is retried, then rejects as a ProviderError", async () => {
  const { fetch, calls } = stub(() => {
    throw new TypeError("fetch failed")
  })
  await expect(createPokemonTcgIo({ fetch, retryDelayMs: 1 }).listSets()).rejects.toBeInstanceOf(ProviderError)
  expect(calls).toHaveLength(3)
})

test("the api key is sent when set", async () => {
  const { fetch, calls } = stub(() => json(setsFixture))
  await createPokemonTcgIo({ fetch, apiKey: "k123" }).listSets()
  expect(new Headers(calls[0]?.init?.headers).get("X-Api-Key")).toBe("k123")
})

test("a 200 whose body cannot be read is retried", async () => {
  let n = 0
  const { fetch, calls } = stub(() => (++n === 1 ? new Response("<html>gateway</html>", { status: 200 }) : json(setsFixture)))
  const sets = await createPokemonTcgIo({ fetch, retryDelayMs: 1 }).listSets()
  expect(sets).toHaveLength(2)
  expect(calls).toHaveLength(2)
})

test("attempts limits how many times a request is tried", async () => {
  const { fetch, calls } = stub(() => json({ error: "boom" }, 500))
  await expect(createPokemonTcgIo({ fetch, retryDelayMs: 1, attempts: 1 }).listSets()).rejects.toBeInstanceOf(ProviderError)
  expect(calls).toHaveLength(1)
})
