import type { CatalogCard, CatalogProvider, CatalogSet, PricedCard, PriceProvider } from "../types"

type Calls = { listSets: number; listCardsInSet: string[]; getPrices: string[][] }

type FakeProvider = CatalogProvider &
  PriceProvider & {
    calls: Calls
    sets: CatalogSet[]
    cards: CatalogCard[]
    priced: PricedCard[]
    fail: { listSets?: Error; listCardsInSet?: Record<string, Error>; getPrices?: Error }
  }

function makeSet(id: string, over: Partial<CatalogSet> = {}): CatalogSet {
  return {
    id,
    name: `Set ${id}`,
    series: "Series",
    printedTotal: 100,
    releaseDate: "2023-01-01",
    ptcgoCode: null,
    symbolUrl: null,
    updatedAt: "2023/01/01 00:00:00",
    ...over,
  }
}

function makeCard(id: string, over: Partial<CatalogCard> = {}): CatalogCard {
  const [setId = "s", number = "1"] = id.split("-")
  return {
    id,
    name: `Card ${id}`,
    setId,
    number,
    printedTotal: 100,
    rarity: "Common",
    imageSmall: null,
    imageLarge: null,
    legalities: { unlimited: "Legal" },
    rulesText: `Attack ${id}`,
    variants: ["normal"],
    ...over,
  }
}

function fakeProvider(init: { sets?: CatalogSet[]; cards?: CatalogCard[]; priced?: PricedCard[] } = {}): FakeProvider {
  const provider: FakeProvider = {
    calls: { listSets: 0, listCardsInSet: [], getPrices: [] },
    sets: init.sets ?? [],
    cards: init.cards ?? [],
    priced: init.priced ?? [],
    fail: {},
    async listSets() {
      provider.calls.listSets++
      if (provider.fail.listSets) throw provider.fail.listSets
      return provider.sets
    },
    async listCardsInSet(setId) {
      provider.calls.listCardsInSet.push(setId)
      const error = provider.fail.listCardsInSet?.[setId]
      if (error) throw error
      return provider.cards.filter((c) => c.setId === setId)
    },
    async getPrices(cardIds) {
      provider.calls.getPrices.push(cardIds)
      if (provider.fail.getPrices) throw provider.fail.getPrices
      return provider.priced.filter((p) => cardIds.includes(p.card.id))
    },
  }
  return provider
}

export { fakeProvider, makeCard, makeSet }
export type { FakeProvider }
