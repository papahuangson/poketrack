// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import type { CardDetail } from "@/lib/binder-view"
import { binderPage, cardPocket, unplacedLot } from "./fixtures"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }))
vi.mock("@/app/binders/actions", () => ({
  movePocketAction: vi.fn(),
  removePocketAction: vi.fn(),
  setLotDetailsAction: vi.fn(),
  editSurplusAction: vi.fn(),
  removeSurplusAction: vi.fn(),
}))

const { BinderScreen } = await import("./binder-screen")

beforeEach(() => {
  replace.mockReset()
  push.mockReset()
  window.location.hash = ""
})

const base = { binders: ["Main", "Trade"], unplaced: [], highlightSlot: null, detail: null, search: async () => [] }

test("opening a pocket pushes its card onto the URL", async () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(2)])} />)
  await userEvent.click(screen.getByRole("button", { name: "Pocket 2: Pikachu, 58/102" }))
  expect(push).toHaveBeenCalledWith("/binders?b=Main&p=3&card=r12", { scroll: false })
})

test("shows the page value and how many cards have no price", () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(1)], { valueCents: 10250, unpricedCount: 2 })} />)
  expect(screen.getByText("Page 3 of 6")).toBeInTheDocument()
  expect(screen.getByText(/\$102\.50/)).toBeInTheDocument()
  expect(screen.getByText(/2 unpriced/)).toBeInTheDocument()
})

test("a fully priced page doesn't mention unpriced cards", () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(1)], { valueCents: 410 })} />)
  expect(screen.queryByText(/unpriced/)).toBeNull()
})

test("an unscanned page offers to scan it", () => {
  render(<BinderScreen {...base} page={binderPage([], { binder: "Trade & Extras", page: 2, scanId: null, pockets: [] })} />)
  expect(screen.getByRole("link", { name: "Scan this page" })).toHaveAttribute("href", "/scan?binder=Trade%20%26%20Extras&page=2")
  expect(screen.getAllByRole("button", { name: /^Pocket \d: empty$/ })).toHaveLength(9)
  expect(screen.queryByText(/\$/)).toBeNull()
})

test("a scanned page has no scan prompt", () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(1)])} />)
  expect(screen.queryByRole("link", { name: "Scan this page" })).toBeNull()
})

test("unplaced tiles open in group mode and a #unplaced hash highlights its tile", async () => {
  window.location.hash = "#unplaced-8"
  render(<BinderScreen {...base} page={binderPage([cardPocket(1)], { page: 6 })} unplaced={[unplacedLot({ lotId: 7 }), unplacedLot({ lotId: 8, name: "Mew ex" })]} />)
  expect(await screen.findByRole("button", { name: /^Mew ex/ })).toHaveAttribute("data-highlight")
  await userEvent.click(screen.getByRole("button", { name: /^Pikachu, 58\/102, not on a page/ }))
  expect(push).toHaveBeenCalledWith("/binders?b=Main&p=6&card=l7", { scroll: false })
})

test("the search highlight carries to the grid", () => {
  render(<BinderScreen {...base} highlightSlot={2} page={binderPage([cardPocket(2)])} />)
  expect(screen.getByRole("button", { name: "Pocket 2: Pikachu, 58/102" })).toHaveAttribute("data-highlight")
})

const detail: CardDetail = {
  mode: "pocket",
  resultId: 12,
  lotId: 102,
  cardId: "base1-58",
  name: "Pikachu",
  setName: "Base",
  number: "58",
  printedTotal: 102,
  rarity: null,
  imageLarge: null,
  imageSmall: null,
  cardVariants: ["normal"],
  variant: "normal",
  condition: "NM",
  lot: { quantity: 1, pocketed: 1, surplus: 0, paidCents: null, acquiredOn: null, binder: "Main" },
  price: { marketCents: null, previousCents: null, history: [] },
  places: [],
  scanLink: { binder: "Main", page: 3 },
}

test("a card in the URL opens its panel over the page, and closing drops it from the URL", async () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(2)])} detail={detail} />)
  expect(screen.getByRole("dialog", { name: "Pikachu" })).toBeInTheDocument()
  await userEvent.keyboard("{Escape}")
  expect(replace).toHaveBeenCalledWith("/binders?b=Main&p=3", { scroll: false })
})

test("no card in the URL shows no panel", () => {
  render(<BinderScreen {...base} page={binderPage([cardPocket(2)])} />)
  expect(screen.queryByRole("dialog")).toBeNull()
})

test("focus goes back to the pocket when its panel closes", async () => {
  const page = binderPage([cardPocket(2)])
  const view = render(<BinderScreen {...base} page={page} detail={detail} />)
  view.rerender(<BinderScreen {...base} page={page} detail={null} />)
  await vi.waitFor(() => expect(screen.getByRole("button", { name: "Pocket 2: Pikachu, 58/102" })).toHaveFocus())
})

test("focus goes back to an unplaced tile when its panel closes", async () => {
  const props = { ...base, page: binderPage([cardPocket(1)], { page: 6 }), unplaced: [unplacedLot({ lotId: 7 })] }
  const view = render(<BinderScreen {...props} detail={{ ...detail, mode: "group", resultId: null, lotId: 7, scanLink: null }} />)
  view.rerender(<BinderScreen {...props} detail={null} />)
  await vi.waitFor(() => expect(screen.getByRole("button", { name: /^Pikachu, 58\/102, not on a page/ })).toHaveFocus())
})
