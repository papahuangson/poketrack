// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { expect, test } from "vitest"
import type { CollectionRow } from "@/lib/collection"
import { CollectionList } from "./collection-list"

function row(over: Partial<CollectionRow> = {}): CollectionRow {
  return {
    id: 1,
    cardId: "sv3pt5-25",
    name: "Pikachu",
    setId: "sv3pt5",
    setName: "151",
    number: "25",
    printedTotal: 165,
    imageSmall: "https://images.pokemontcg.io/sv3pt5/25.png",
    variant: "reverseHolofoil",
    condition: "NM",
    quantity: 2,
    paidCents: null,
    acquiredOn: null,
    binder: null,
    cardVariants: ["normal", "reverseHolofoil"],
    marketCents: 410,
    rowTotalCents: 820,
    ...over,
  }
}

test("a row shows the card, its set, variant, condition, quantity and prices", () => {
  render(<CollectionList rows={[row()]} filtered={false} />)
  const item = screen.getByRole("listitem")
  expect(within(item).getByText("Pikachu")).toBeInTheDocument()
  expect(within(item).getByText("151, 25/165")).toBeInTheDocument()
  expect(within(item).getByText("Reverse Holo")).toBeInTheDocument()
  expect(within(item).getByText("NM")).toBeInTheDocument()
  expect(within(item).getByText("×2")).toBeInTheDocument()
  expect(within(item).getByText("$4.10")).toBeInTheDocument()
  expect(within(item).getByText("$8.20")).toBeInTheDocument()
})

test("an unpriced row shows a dash for both prices, with a spoken label", () => {
  render(<CollectionList rows={[row({ marketCents: null, rowTotalCents: null })]} filtered={false} />)
  expect(screen.getAllByText("—")).toHaveLength(2)
  expect(screen.getAllByLabelText("No price yet")).toHaveLength(2)
})

test("an empty collection invites the first add", () => {
  render(<CollectionList rows={[]} filtered={false} />)
  expect(screen.getByText("No cards yet. Search above to add your first card.")).toBeInTheDocument()
})

test("an empty filtered list says the filters matched nothing", () => {
  render(<CollectionList rows={[]} filtered />)
  expect(screen.getByText("No cards match these filters.")).toBeInTheDocument()
})

test("each row renders the menu it is given", () => {
  render(<CollectionList rows={[row()]} filtered={false} renderMenu={(r) => <button>Actions for {r.name}</button>} />)
  expect(screen.getByRole("button", { name: "Actions for Pikachu" })).toBeInTheDocument()
})
