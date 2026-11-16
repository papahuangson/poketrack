// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import type { OwnedHit, Where } from "@/lib/binder-view"

const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }))

const { SearchBox } = await import("./search-box")

const hit = (where: Where, over: Partial<OwnedHit> = {}): OwnedHit => ({
  cardId: "sv3pt5-199",
  name: "Charizard ex",
  setName: "151",
  number: "199",
  printedTotal: 165,
  imageSmall: null,
  variant: "holofoil",
  condition: "NM",
  where,
  ...over,
})

const hits = [
  hit({ kind: "pocket", binder: "Main", page: 3, slot: 2, resultId: 12 }),
  hit({ kind: "unplaced", binder: "Trade & Extras", lotId: 5 }),
  hit({ kind: "loose", lotId: 7 }),
]

const search = vi.fn(async (q: string) => (q === "char" ? hits : []))
const onPickUnplaced = vi.fn()
const show = () => render(<SearchBox search={search} current={{ binder: "Main", page: 4 }} onPickUnplaced={onPickUnplaced} />)
const box = () => screen.getByRole("combobox", { name: "Find a card" })

beforeEach(() => {
  push.mockReset()
  search.mockClear()
  onPickUnplaced.mockReset()
})

test("typing searches once after a pause, not on every key", async () => {
  const user = userEvent.setup()
  show()
  await user.type(box(), "char")
  expect(search).not.toHaveBeenCalled()
  await screen.findAllByRole("option")
  expect(search).toHaveBeenCalledTimes(1)
  expect(search).toHaveBeenCalledWith("char")
})

test("one letter doesn't search", async () => {
  const user = userEvent.setup()
  show()
  await user.type(box(), "c")
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(search).not.toHaveBeenCalled()
})

test("options say what the card is and where it is", async () => {
  const user = userEvent.setup()
  show()
  await user.type(box(), "char")
  const options = await screen.findAllByRole("option")
  expect(options).toHaveLength(3)
  expect(within(options[0]!).getByText("Charizard ex · 151 199/165")).toBeInTheDocument()
  expect(within(options[0]!).getByText("Main · page 3, pocket 2")).toBeInTheDocument()
  expect(within(options[1]!).getByText("Trade & Extras · not on a page")).toBeInTheDocument()
  expect(within(options[2]!).getByText("No binder")).toBeInTheDocument()
})

const pick = async (n: number) => {
  const user = userEvent.setup()
  show()
  await user.type(box(), "char")
  await user.click((await screen.findAllByRole("option"))[n]!)
}

test("picking a pocket jumps to its page with the pocket highlighted", async () => {
  await pick(0)
  expect(push).toHaveBeenCalledWith("/binders?b=Main&p=3&hl=2")
  expect(box()).toHaveValue("")
})

test("picking a card that isn't on a page goes to the strip on the binder's last page", async () => {
  await pick(1)
  expect(push).toHaveBeenCalledWith("/binders?b=Trade%20%26%20Extras&p=last#unplaced-5")
  expect(onPickUnplaced).toHaveBeenCalledWith(5)
})

test("picking a card with no binder opens it over the current page", async () => {
  await pick(2)
  expect(push).toHaveBeenCalledWith("/binders?b=Main&p=4&card=l7", { scroll: false })
})

test("no matches and a failed search each say so", async () => {
  const user = userEvent.setup()
  show()
  await user.type(box(), "zzzz")
  expect(await screen.findByText("None of your cards match.")).toBeInTheDocument()
  search.mockRejectedValueOnce(new Error("boom"))
  await user.clear(box())
  await user.type(box(), "mew")
  expect(await screen.findByText("Search is not working right now. Try again.")).toBeInTheDocument()
})
