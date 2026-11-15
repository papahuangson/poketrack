// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import type { CollectionRow } from "@/lib/collection"

const updateItemAction = vi.fn()
const removeItemAction = vi.fn()

vi.mock("@/app/actions", () => ({
  updateItemAction: (...args: unknown[]) => updateItemAction(...args),
  removeItemAction: (...args: unknown[]) => removeItemAction(...args),
}))

const { RowMenu } = await import("./row-menu")

const row: CollectionRow = {
  id: 7,
  cardId: "sv3pt5-25",
  name: "Pikachu",
  setId: "sv3pt5",
  setName: "151",
  number: "25",
  printedTotal: 165,
  imageSmall: null,
  variant: "reverseHolofoil",
  condition: "LP",
  quantity: 2,
  paidCents: 150,
  acquiredOn: "2026-01-15",
  binder: "Main",
  cardVariants: ["normal", "reverseHolofoil"],
  marketCents: 410,
  rowTotalCents: 820,
  priceDate: null,
  priceStale: false,
}

beforeEach(() => {
  updateItemAction.mockReset().mockResolvedValue({ ok: true })
  removeItemAction.mockReset().mockResolvedValue({ ok: true })
})

async function choose(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole("button", { name: "Actions for Pikachu" }))
  await user.click(await screen.findByRole("menuitem", { name: item }))
}

test("Remove asks first, naming the card and how many copies go", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Remove")
  const dialog = await screen.findByRole("alertdialog", { name: "Remove Pikachu?" })
  expect(within(dialog).getByText("This removes all 2 from your collection.")).toBeInTheDocument()
  expect(removeItemAction).not.toHaveBeenCalled()
})

test("confirming Remove deletes the row", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Remove")
  const dialog = await screen.findByRole("alertdialog")
  await user.click(within(dialog).getByRole("button", { name: "Remove" }))
  await waitFor(() => expect(removeItemAction).toHaveBeenCalledExactlyOnceWith(7))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
})

test("cancelling Remove keeps the row", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Remove")
  const dialog = await screen.findByRole("alertdialog")
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument())
  expect(removeItemAction).not.toHaveBeenCalled()
})

test("Edit opens with the row's current values", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Edit")
  const dialog = await screen.findByRole("dialog", { name: "Edit Pikachu" })
  expect(within(dialog).getByRole("combobox", { name: "Variant" })).toHaveTextContent("Reverse Holo")
  expect(within(dialog).getByRole("combobox", { name: "Condition" })).toHaveTextContent("LP")
  expect(within(dialog).getByLabelText("Quantity")).toHaveValue("2")
  expect(within(dialog).getByLabelText("Paid per copy")).toHaveValue("1.50")
  expect(within(dialog).getByLabelText("Acquired on")).toHaveValue("2026-01-15")
  expect(within(dialog).getByLabelText("Binder")).toHaveValue("Main")
})

test("Save sends the edited values and closes", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Edit")
  const dialog = await screen.findByRole("dialog")
  const paid = within(dialog).getByLabelText("Paid per copy")
  await user.clear(paid)
  await user.type(paid, "12.5")
  await user.clear(within(dialog).getByLabelText("Binder"))
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  await waitFor(() =>
    expect(updateItemAction).toHaveBeenCalledExactlyOnceWith(7, {
      variant: "reverseHolofoil",
      condition: "LP",
      quantity: 2,
      paidCents: 1250,
      acquiredOn: "2026-01-15",
      binder: null,
    }),
  )
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
})

test("a price that is not a number is rejected before saving", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Edit")
  const dialog = await screen.findByRole("dialog")
  const paid = within(dialog).getByLabelText("Paid per copy")
  await user.clear(paid)
  await user.type(paid, "abc")
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  expect(await within(dialog).findByText("Enter a price like 12.50.")).toBeInTheDocument()
  expect(updateItemAction).not.toHaveBeenCalled()
})

test("a rejected save shows the server's message and stays open", async () => {
  updateItemAction.mockResolvedValue({ ok: false, field: "variant", message: "You already have this card with that variant and condition. Change its quantity instead." })
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Edit")
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "Save" }))
  expect(await within(dialog).findByText(/You already have this card/)).toBeInTheDocument()
})

test("Cancel in Edit closes without saving", async () => {
  const user = userEvent.setup()
  render(<RowMenu row={row} />)
  await choose(user, "Edit")
  const dialog = await screen.findByRole("dialog")
  await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  expect(updateItemAction).not.toHaveBeenCalled()
})
