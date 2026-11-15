type CatalogSet = {
  id: string
  name: string
  series: string
  printedTotal: number
  releaseDate: string
  ptcgoCode: string | null
  symbolUrl: string | null
  updatedAt: string
}

type CatalogCard = {
  id: string
  name: string
  setId: string
  number: string
  printedTotal: number
  rarity: string | null
  imageSmall: string | null
  imageLarge: string | null
  legalities: Record<string, string>
  rulesText: string
  variants: string[]
}

type CardPrice = {
  cardId: string
  variant: string
  marketCents: number | null
  lowCents: number | null
  cardmarketTrendEurCents: number | null
}

type PricedCard = { card: CatalogCard; prices: CardPrice[] }

interface CatalogProvider {
  listSets(): Promise<CatalogSet[]>
  listCardsInSet(setId: string): Promise<CatalogCard[]>
}

interface PriceProvider {
  getPrices(cardIds: string[]): Promise<PricedCard[]>
}

class ProviderError extends Error {
  status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = "ProviderError"
    this.status = status
  }
}

export { ProviderError }
export type { CardPrice, CatalogCard, CatalogProvider, CatalogSet, PricedCard, PriceProvider }
