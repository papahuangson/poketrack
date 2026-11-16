// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import type { CardDetail } from "@/lib/binder-view"

const replace = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push: vi.fn() }) }))

const movePocketAction = vi.fn()
const removePocketAction = vi.fn()
const setLotDetailsAction = vi.fn()
const editSurplusAction = vi.fn()
const removeSurplusAction = vi.fn()
vi.mock("@/app/binders/actions", () => ({
  movePocketAction: (...a: unknown[]) => movePocketAction(...a),
  removePocketAction: (...a: unknown[]) => removePocketAction(...a),
  setLotDetailsAction: (...a: unknown[]) => setLotDetailsAction(...a),
  editSurplusAction: (...a: unknown[]) => editSurplusAction(...a),
  removeSurplusAction: (...a: unknown[]) => removeSurplusAction(...a),
}))

const { CardPanel } = await import("./card-panel")

const CLOSE = "/binders?b=Main&p=3"
const STALE = { ok: false, field: "pocket", message: "That pocket changed. Reload the page." }

const pocketDetail = (over: Partial<CardDetail> = {}): CardDetail => ({
  mode: "pocket",
  resultId: 12,
  lotId: 40,
  cardId: "base1-58",
  name: "Pikachu",
  setName: "Base",
  number: "58",
  printedTotal: 102,
  rarity: "Common",
  imageLarge: "https://img.test/large.webp",
  imageSmall: "https://img.test/small.webp",
  cardVariants: ["normal", "holofoil"],
  variant: "normal",
  condition: "NM",
  lot: { quantity: 1, pocketed: 1, surplus: 0, paidCents: null, acquiredOn: null, binder: "Main" },
  price: {
    marketCents: 410,
    previousCents: 370,
    history: [
      { date: "2026-11-13", cents: 370 },
      { date: "2026-11-14", cents: 410 },
    ],
  },
  places: [
    { where: { kind: "pocket", binder: "Main", page: 3, slot: 2, resultId: 12 }, thisOne: true },
    { where: { kind: "pocket", binder: "Main", page: 7, slot: 5, resultId: 31 }, thisOne: false },
    { where: { kind: "unplaced", binder: "Trade", lotId: 44 }, thisOne: false },
    { where: { kind: "loose", lotId: 45 }, thisOne: false },
  ],
  scanLink: { binder: "Main", page: 3 },
  ...over,
})

const groupDetail = (over: Partial<CardDetail> = {}): CardDetail =>
  pocketDetail({
    mode: "group",
    resultId: null,
    lotId: 44,
    lot: { quantity: 3, pocketed: 1, surplus: 2, paidCents: 250, acquiredOn: "2026-10-01", binder: "Main" },
    places: [{ where: { kind: "unplaced", binder: "Main", lotId: 44 }, thisOne: true }],
    scanLink: null,
    ...over,
  })

beforeEach(() => {
  replace.mockReset()
  for (const action of [removePocketAction, setLotDetailsAction, editSurplusAction, removeSurplusAction]) action.mockReset().mockResolvedValue({ ok: true })
  movePocketAction.mockReset().mockResolvedValue({ ok: true, lotId: 41 })
})

const show = (detail: CardDetail) => render(<CardPanel detail={detail} closeHref={CLOSE} />)
const panel = () => screen.getByRole("dialog", { name: "Pikachu" })
const edit = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(within(panel()).getByRole("button", { name: "Edit" }))
}
const choose = async (user: ReturnType<typeof userEvent.setup>, field: string, option: string) => {
  await user.click(within(panel()).getByRole("combobox", { name: field }))
  await user.click(await screen.findByRole("option", { name: option }))
}
const save = (user: ReturnType<typeof userEvent.setup>) => user.click(within(panel()).getByRole("button", { name: "Save" }))

test("shows the card, its price and where the copies are", () => {
  show(pocketDetail())
  const dialog = panel()
  expect(dialog.querySelector("img")).toHaveAttribute("src", "https://img.test/large.webp")
  expect(within(dialog).getByText("Base, 58/102")).toBeInTheDocument()
  for (const fact of ["Common", "Normal", "NM"]) expect(within(dialog).getByText(fact)).toBeInTheDocument()
  expect(within(dialog).getByText("$4.10")).toBeInTheDocument()
  expect(within(dialog).getByText(/\+\$0\.40 since the last price/)).toBeInTheDocument()
  expect(dialog.querySelector("polyline")).not.toBeNull()
  expect(within(dialog).getByText("This pocket · Main page 3")).toBeInTheDocument()
  expect(within(dialog).getByRole("link", { name: "Main · page 7, pocket 5" })).toHaveAttribute("href", "/binders?b=Main&p=7&hl=5")
  expect(within(dialog).getByText("Trade · not on a page")).toBeInTheDocument()
  expect(within(dialog).getByText("No binder")).toBeInTheDocument()
  expect(within(dialog).getByRole("link", { name: "Wrong card? Rescan this page" })).toHaveAttribute("href", "/scan?binder=Main&page=3")
})

test("a price drop reads as a drop, and no previous price shows no change", () => {
  const { unmount } = show(pocketDetail({ price: { marketCents: 300, previousCents: 350, history: [] } }))
  expect(within(panel()).getByText(/−\$0\.50 since the last price/)).toBeInTheDocument()
  unmount()
  show(pocketDetail({ price: { marketCents: 300, previousCents: null, history: [] } }))
  expect(within(panel()).queryByText(/since the last price/)).toBeNull()
})

test("no prices shows No price yet and no chart", () => {
  show(pocketDetail({ price: { marketCents: null, previousCents: null, history: [] } }))
  expect(within(panel()).getByText("No price yet")).toBeInTheDocument()
  expect(panel().querySelector("polyline")).toBeNull()
})

test("image falls back to the small one, then to a name tile", () => {
  const { unmount } = show(pocketDetail({ imageLarge: null }))
  expect(panel().querySelector("img")).toHaveAttribute("src", "https://img.test/small.webp")
  unmount()
  show(pocketDetail({ imageLarge: null, imageSmall: null }))
  expect(panel().querySelector("img")).toBeNull()
  expect(within(panel()).getByText("58/102")).toBeInTheDocument()
})

test("pocket mode edits variant and condition with no quantity or binder field", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  expect(within(panel()).queryByLabelText("Quantity")).toBeNull()
  expect(within(panel()).queryByLabelText("Binder")).toBeNull()
  await choose(user, "Condition", "LP")
  await save(user)
  await waitFor(() => expect(movePocketAction).toHaveBeenCalledWith(12, { variant: "normal", condition: "LP" }))
  expect(setLotDetailsAction).not.toHaveBeenCalled()
  await waitFor(() => expect(within(panel()).getByRole("button", { name: "Edit" })).toBeInTheDocument())
  expect(replace).not.toHaveBeenCalled()
})

test("paid price and date save to the lot without moving the copy", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  await user.type(within(panel()).getByLabelText("Paid per copy"), "5")
  await save(user)
  await waitFor(() => expect(setLotDetailsAction).toHaveBeenCalledWith(40, { paidCents: 500, acquiredOn: null }))
  expect(movePocketAction).not.toHaveBeenCalled()
})

test("changing both moves the copy first, then saves details on the lot it landed in", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  await choose(user, "Variant", "Holo")
  await user.type(within(panel()).getByLabelText("Paid per copy"), "5")
  await save(user)
  await waitFor(() => expect(setLotDetailsAction).toHaveBeenCalledWith(41, { paidCents: 500, acquiredOn: null }))
  expect(movePocketAction).toHaveBeenCalledWith(12, { variant: "holofoil", condition: "NM" })
  expect(movePocketAction.mock.invocationCallOrder[0]).toBeLessThan(setLotDetailsAction.mock.invocationCallOrder[0]!)
})

test("saving with nothing changed calls nothing", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  await save(user)
  await waitFor(() => expect(within(panel()).getByRole("button", { name: "Edit" })).toBeInTheDocument())
  expect(movePocketAction).not.toHaveBeenCalled()
  expect(setLotDetailsAction).not.toHaveBeenCalled()
})

test("the paid field says how many copies it applies to", async () => {
  const user = userEvent.setup()
  const lot = pocketDetail().lot!
  const first = show(pocketDetail({ lot: { ...lot, quantity: 2 } }))
  await edit(user)
  expect(within(panel()).getByText("Applies to both copies in Main")).toBeInTheDocument()
  first.unmount()
  const second = show(pocketDetail({ lot: { ...lot, quantity: 3 } }))
  await edit(user)
  expect(within(panel()).getByText("Applies to all 3 copies in Main")).toBeInTheDocument()
  second.unmount()
  show(pocketDetail())
  await edit(user)
  expect(within(panel()).queryByText(/Applies to/)).toBeNull()
})

test("a stale pocket shows the message and stays in the form", async () => {
  movePocketAction.mockResolvedValue(STALE)
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  await choose(user, "Condition", "LP")
  await save(user)
  expect(await within(panel()).findByRole("alert")).toHaveTextContent("That pocket changed. Reload the page.")
  expect(setLotDetailsAction).not.toHaveBeenCalled()
  expect(within(panel()).getByRole("button", { name: "Save" })).toBeInTheDocument()
})

test("a paid price that isn't money is caught before saving", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await edit(user)
  await user.type(within(panel()).getByLabelText("Paid per copy"), "abc")
  await save(user)
  expect(await within(panel()).findByRole("alert")).toHaveTextContent("Enter a price like 12.50.")
  expect(setLotDetailsAction).not.toHaveBeenCalled()
})

test("removing a pocket asks first, then removes and closes", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await user.click(within(panel()).getByRole("button", { name: "Remove" }))
  const confirm = await screen.findByRole("alertdialog", { name: "Remove this Pikachu from page 3?" })
  expect(removePocketAction).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole("button", { name: "Remove" }))
  await waitFor(() => expect(removePocketAction).toHaveBeenCalledWith(12))
  await waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE, { scroll: false }))
})

test("a remove that fails shows why and doesn't close", async () => {
  removePocketAction.mockResolvedValue(STALE)
  const user = userEvent.setup()
  show(pocketDetail())
  await user.click(within(panel()).getByRole("button", { name: "Remove" }))
  const confirm = await screen.findByRole("alertdialog")
  await user.click(within(confirm).getByRole("button", { name: "Remove" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("That pocket changed. Reload the page.")
  expect(replace).not.toHaveBeenCalled()
})

test("a missing pocket offers only Remove and the rescan link", () => {
  show(pocketDetail({ lot: null, lotId: null, places: [] }))
  expect(within(panel()).getByText("Not in your collection")).toBeInTheDocument()
  expect(within(panel()).queryByRole("button", { name: "Edit" })).toBeNull()
  expect(within(panel()).getByRole("button", { name: "Remove" })).toBeInTheDocument()
  expect(within(panel()).getByRole("link", { name: "Wrong card? Rescan this page" })).toBeInTheDocument()
})

test("group mode edits the copies that aren't on a page", async () => {
  const user = userEvent.setup()
  show(groupDetail())
  expect(within(panel()).getByText("These copies · Main, not on a page")).toBeInTheDocument()
  expect(within(panel()).queryByRole("link", { name: /Rescan/ })).toBeNull()
  await edit(user)
  expect(within(panel()).getByLabelText("Quantity")).toHaveValue("2")
  expect(within(panel()).getByLabelText("Binder")).toHaveValue("Main")
  expect(within(panel()).getByLabelText("Paid per copy")).toHaveValue("2.50")
  await user.click(within(panel()).getByRole("button", { name: "Increase quantity" }))
  await save(user)
  await waitFor(() => expect(editSurplusAction).toHaveBeenCalledWith(44, { variant: "normal", condition: "NM", quantity: 3, binder: "Main" }))
  expect(setLotDetailsAction).not.toHaveBeenCalled()
  await waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE, { scroll: false }))
})

test("group mode saves lot details before moving copies", async () => {
  const user = userEvent.setup()
  show(groupDetail())
  await edit(user)
  await choose(user, "Condition", "LP")
  await user.clear(within(panel()).getByLabelText("Paid per copy"))
  await save(user)
  await waitFor(() => expect(editSurplusAction).toHaveBeenCalledWith(44, { variant: "normal", condition: "LP", quantity: 2, binder: "Main" }))
  expect(setLotDetailsAction).toHaveBeenCalledWith(44, { paidCents: null, acquiredOn: "2026-10-01" })
  expect(setLotDetailsAction.mock.invocationCallOrder[0]).toBeLessThan(editSurplusAction.mock.invocationCallOrder[0]!)
})

test("group remove takes only the copies that aren't on a page", async () => {
  const user = userEvent.setup()
  show(groupDetail())
  await user.click(within(panel()).getByRole("button", { name: "Remove" }))
  const confirm = await screen.findByRole("alertdialog", { name: "Remove 2 copies of Pikachu?" })
  expect(within(confirm).getByText(/Copies in pockets stay/)).toBeInTheDocument()
  await user.click(within(confirm).getByRole("button", { name: "Remove" }))
  await waitFor(() => expect(removeSurplusAction).toHaveBeenCalledWith(44))
  await waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE, { scroll: false }))
})

test("closing the panel returns to the page", async () => {
  const user = userEvent.setup()
  show(pocketDetail())
  await user.keyboard("{Escape}")
  await waitFor(() => expect(replace).toHaveBeenCalledWith(CLOSE, { scroll: false }))
})
