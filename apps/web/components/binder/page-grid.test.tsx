// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"
import { binderPage, cardPocket, unplacedLot } from "./fixtures"
import { PageGrid } from "./page-grid"
import { UnplacedStrip } from "./unplaced-strip"

const page = binderPage([
  cardPocket(1, { name: "Charizard ex", number: "199", printedTotal: 165, cardId: "sv3pt5-199" }),
  cardPocket(3, { imageSmall: null }),
  cardPocket(5, { state: "missing", lotId: null }),
])

test("renders 9 pocket buttons in slot order with their labels", () => {
  render(<PageGrid page={page} highlightSlot={null} onOpen={() => {}} />)
  expect(screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
    "Pocket 1: Charizard ex, 199/165",
    "Pocket 2: empty",
    "Pocket 3: Pikachu, 58/102",
    "Pocket 4: empty",
    "Pocket 5: Pikachu, not in your collection",
    "Pocket 6: empty",
    "Pocket 7: empty",
    "Pocket 8: empty",
    "Pocket 9: empty",
  ])
})

test("a card with an image shows it, and one without shows its name and number", () => {
  render(<PageGrid page={page} highlightSlot={null} onOpen={() => {}} />)
  const withImage = screen.getByRole("button", { name: "Pocket 1: Charizard ex, 199/165" })
  expect(withImage.querySelector("img")).toHaveAttribute("src", "https://img.test/base1-58.webp")
  const plain = screen.getByRole("button", { name: "Pocket 3: Pikachu, 58/102" })
  expect(plain.querySelector("img")).toBeNull()
  expect(within(plain).getByText("Pikachu")).toBeInTheDocument()
  expect(within(plain).getByText("58/102")).toBeInTheDocument()
})

test("a missing pocket is dimmed and says so", () => {
  render(<PageGrid page={page} highlightSlot={null} onOpen={() => {}} />)
  const missing = screen.getByRole("button", { name: "Pocket 5: Pikachu, not in your collection" })
  expect(missing).toHaveAttribute("data-missing")
  expect(within(missing).getByText("Not in your collection")).toBeInTheDocument()
})

test("highlight marks one pocket and dims the rest", () => {
  render(<PageGrid page={page} highlightSlot={3} onOpen={() => {}} />)
  const buttons = screen.getAllByRole("button")
  expect(buttons.filter((b) => b.hasAttribute("data-highlight")).map((b) => b.getAttribute("aria-label"))).toEqual(["Pocket 3: Pikachu, 58/102"])
  expect(buttons.filter((b) => b.hasAttribute("data-dimmed"))).toHaveLength(8)
})

test("no highlight leaves every pocket unmarked", () => {
  render(<PageGrid page={page} highlightSlot={null} onOpen={() => {}} />)
  for (const b of screen.getAllByRole("button")) {
    expect(b).not.toHaveAttribute("data-highlight")
    expect(b).not.toHaveAttribute("data-dimmed")
  }
})

test("clicking a card or missing pocket opens it; an empty pocket does nothing", async () => {
  const onOpen = vi.fn()
  render(<PageGrid page={page} highlightSlot={null} onOpen={onOpen} />)
  await userEvent.click(screen.getByRole("button", { name: "Pocket 1: Charizard ex, 199/165" }))
  expect(onOpen).toHaveBeenLastCalledWith({ resultId: 11 })
  await userEvent.click(screen.getByRole("button", { name: "Pocket 5: Pikachu, not in your collection" }))
  expect(onOpen).toHaveBeenLastCalledWith({ resultId: 15 })
  await userEvent.click(screen.getByRole("button", { name: "Pocket 2: empty" }))
  expect(onOpen).toHaveBeenCalledTimes(2)
})

test("an unscanned page shows nine empty pockets", () => {
  render(<PageGrid page={binderPage([], { scanId: null, pockets: [] })} highlightSlot={null} onOpen={() => {}} />)
  expect(screen.getAllByRole("button", { name: /^Pocket \d: empty$/ })).toHaveLength(9)
})

test("the unplaced strip lists tiles with a count and opens them", async () => {
  const onOpen = vi.fn()
  render(
    <UnplacedStrip
      lots={[unplacedLot({ lotId: 7, surplus: 2 }), unplacedLot({ lotId: 8, name: "Mew ex", number: "151", printedTotal: 165 })]}
      highlightLotId={8}
      onOpen={onOpen}
    />,
  )
  expect(screen.getByRole("heading", { name: "Not on a page yet" })).toBeInTheDocument()
  const pika = screen.getByRole("button", { name: "Pikachu, 58/102, 2 copies not on a page" })
  expect(within(pika).getByText("×2")).toBeInTheDocument()
  const mew = screen.getByRole("button", { name: "Mew ex, 151/165, not on a page" })
  expect(within(mew).queryByText(/×/)).toBeNull()
  expect(mew).toHaveAttribute("data-highlight")
  expect(mew).toHaveAttribute("id", "unplaced-8")
  expect(pika).not.toHaveAttribute("data-highlight")
  await userEvent.click(pika)
  expect(onOpen).toHaveBeenCalledWith({ lotId: 7 })
})

test("the unplaced strip renders nothing without lots", () => {
  const { container } = render(<UnplacedStrip lots={[]} highlightLotId={null} onOpen={() => {}} />)
  expect(container).toBeEmptyDOMElement()
})
