// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, expect, test, vi } from "vitest"
import type { CardHit } from "@/lib/collection"

const addCardAction = vi.fn()
const defaultVariantAction = vi.fn()

vi.mock("@/app/actions", () => ({
  addCardAction: (...args: unknown[]) => addCardAction(...args),
  defaultVariantAction: (...args: unknown[]) => defaultVariantAction(...args),
}))

const { AddCard } = await import("./add-card")

const hit = (over: Partial<CardHit>): CardHit => ({
  id: "sv3pt5-199",
  name: "Charizard ex",
  setName: "151",
  number: "199",
  printedTotal: 165,
  imageSmall: null,
  variants: ["holofoil"],
  ...over,
})

const catalog: Record<string, CardHit[]> = {
  char: [hit({}), hit({ id: "base1-4", name: "Charizard", setName: "Base", number: "4", printedTotal: 102 })],
  pika: [hit({ id: "sv3pt5-25", name: "Pikachu", number: "25", variants: ["normal", "reverseHolofoil"] })],
  mew: [hit({ id: "sv3pt5-151", name: "Mew ex", number: "151", variants: [] })],
}

let delays: Record<string, number>

beforeEach(() => {
  delays = {}
  addCardAction.mockReset().mockResolvedValue({ ok: true })
  defaultVariantAction.mockReset().mockImplementation(async (variants: string[]) => variants[0] ?? "normal")
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const q = new URL(String(input), "https://poketrack.test").searchParams.get("q") ?? ""
      await new Promise((resolve) => setTimeout(resolve, delays[q] ?? 0))
      return new Response(JSON.stringify(catalog[q] ?? []), { headers: { "content-type": "application/json" } })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function pick(user: ReturnType<typeof userEvent.setup>, query: string, name: string) {
  await user.type(screen.getByRole("combobox", { name: "Add a card" }), query)
  await screen.findByRole("option", { name: new RegExp(name) })
  await user.keyboard("{ArrowDown}{Enter}")
  return screen.findByRole("dialog", { name })
}

test("typing shows matching cards with their set and number", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  await user.type(screen.getByRole("combobox", { name: "Add a card" }), "char")
  const option = await screen.findByRole("option", { name: /Charizard ex/ })
  expect(within(option).getByText("151, 199/165")).toBeInTheDocument()
  expect(screen.getAllByRole("option")).toHaveLength(2)
})

test("choosing a card by keyboard opens the add form for it and clears the search", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "char", "Charizard ex")
  expect(dialog).toBeInTheDocument()
  expect(screen.getByRole("combobox", { name: "Add a card" })).toHaveValue("")
})

test("a slow response for an older query does not replace newer results", async () => {
  delays = { char: 300 }
  const user = userEvent.setup()
  render(<AddCard />)
  const input = screen.getByRole("combobox", { name: "Add a card" })
  await user.type(input, "char")
  await new Promise((resolve) => setTimeout(resolve, 250))
  await user.clear(input)
  await user.type(input, "pika")
  await screen.findByRole("option", { name: /Pikachu/ })
  await new Promise((resolve) => setTimeout(resolve, 400))
  expect(screen.queryByRole("option", { name: /Charizard/ })).not.toBeInTheDocument()
  expect(screen.getByRole("option", { name: /Pikachu/ })).toBeInTheDocument()
})

test("a query with no matches says so", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  await user.type(screen.getByRole("combobox", { name: "Add a card" }), "zzzz")
  expect(await screen.findByText("No cards found.")).toBeInTheDocument()
})

test("a failed search says so", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })))
  const user = userEvent.setup()
  render(<AddCard />)
  await user.type(screen.getByRole("combobox", { name: "Add a card" }), "char")
  expect(await screen.findByText("Search is not working right now. Try again.")).toBeInTheDocument()
})

test("the form defaults to near mint, quantity one and the suggested variant", async () => {
  defaultVariantAction.mockResolvedValue("reverseHolofoil")
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "pika", "Pikachu")
  await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Variant" })).toHaveTextContent("Reverse Holo"))
  expect(within(dialog).getByRole("combobox", { name: "Condition" })).toHaveTextContent("NM")
  expect(within(dialog).getByLabelText("Quantity")).toHaveValue("1")
  expect(defaultVariantAction).toHaveBeenCalledWith(["normal", "reverseHolofoil"])
})

test("a card with no listed variants offers only Normal", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "mew", "Mew ex")
  const variant = within(dialog).getByRole("combobox", { name: "Variant" })
  await waitFor(() => expect(variant).toHaveTextContent("Normal"))
  await user.click(variant)
  expect(await screen.findAllByRole("option")).toHaveLength(1)
})

test("Add saves the card and closes the form", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "char", "Charizard ex")
  await user.click(within(dialog).getByRole("button", { name: "Add" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(addCardAction).toHaveBeenCalledExactlyOnceWith({
    cardId: "sv3pt5-199",
    variant: "holofoil",
    condition: "NM",
    quantity: 1,
  })
})

test("Cancel closes the form without saving", async () => {
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "char", "Charizard ex")
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(addCardAction).not.toHaveBeenCalled()
})

test("a rejected add shows the message and keeps the form open", async () => {
  addCardAction.mockResolvedValue({ ok: false, field: "quantity", message: "Quantity must be a whole number from 1 to 999." })
  const user = userEvent.setup()
  render(<AddCard />)
  const dialog = await pick(user, "char", "Charizard ex")
  await user.click(within(dialog).getByRole("button", { name: "Add" }))
  expect(await within(dialog).findByText("Quantity must be a whole number from 1 to 999.")).toBeInTheDocument()
  expect(screen.getByRole("dialog", { name: "Charizard ex" })).toBeInTheDocument()
})
