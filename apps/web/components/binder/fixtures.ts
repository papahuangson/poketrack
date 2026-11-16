import type { BinderPage, PocketView, UnplacedLot } from "@/lib/binder-view"

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

const cardPocket = (slot: number, over: Partial<PocketView> = {}): PocketView => ({
  slot,
  state: "card",
  resultId: 10 + slot,
  lotId: 100 + slot,
  cardId: "base1-58",
  name: "Pikachu",
  setName: "Base",
  number: "58",
  printedTotal: 102,
  imageSmall: "https://img.test/base1-58.webp",
  variant: "normal",
  condition: "NM",
  marketCents: 410,
  ...over,
})

function binderPage(pockets: PocketView[], over: Partial<BinderPage> = {}): BinderPage {
  const bySlot = new Map(pockets.map((p) => [p.slot, p]))
  return {
    binder: "Main",
    page: 3,
    pageCount: 6,
    scanId: 1,
    pockets: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => bySlot.get(slot) ?? emptyPocket(slot)),
    valueCents: 0,
    unpricedCount: 0,
    ...over,
  }
}

const unplacedLot = (over: Partial<UnplacedLot> = {}): UnplacedLot => ({
  lotId: 7,
  cardId: "base1-58",
  name: "Pikachu",
  setName: "Base",
  number: "58",
  printedTotal: 102,
  imageSmall: null,
  variant: "normal",
  condition: "NM",
  surplus: 1,
  marketCents: null,
  ...over,
})

export { binderPage, cardPocket, emptyPocket, unplacedLot }
