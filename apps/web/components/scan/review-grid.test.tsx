// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"
import { CHARIZARD, makeReview, PIKACHU } from "./review-fixture"

const updateSlotAction = vi.fn()
const commitScanAction = vi.fn()
vi.mock("@/app/scans/[id]/actions", () => ({
  updateSlotAction: (...a: unknown[]) => updateSlotAction(...a),
  commitScanAction: (...a: unknown[]) => commitScanAction(...a),
}))

const { ReviewGrid } = await import("./review-grid")

beforeEach(() => {
  updateSlotAction.mockReset().mockResolvedValue({ ok: true })
  commitScanAction.mockReset().mockResolvedValue({ ok: true })
})

const decided = (over: Parameters<typeof makeReview>[0] = {}) => {
  const base = makeReview(over)
  return { ...base, canCommit: true, slots: base.slots.map((s) => (s.slot === 3 ? { ...s, decision: "confirmed" as const } : s)) }
}

const pocketEl = (n: number) => screen.getByRole("group", { name: new RegExp(`^Pocket ${n}\\b`) })

test("the header counts matched, to-check and empty pockets", () => {
  render(<ReviewGrid review={makeReview()} />)
  expect(screen.getByText("7 matched · 1 check · 1 empty")).toBeInTheDocument()
  expect(screen.getByRole("heading", { name: "Main · page 3" })).toBeInTheDocument()
})

test("empty pockets show (empty) and ignore Enter and X", async () => {
  render(<ReviewGrid review={makeReview()} />)
  const empty = pocketEl(9)
  expect(within(empty).getByText("(empty)")).toBeInTheDocument()
  empty.focus()
  await userEvent.keyboard("{Enter}x")
  expect(updateSlotAction).not.toHaveBeenCalled()
})

test("a pending pocket offers its candidates in a combobox", async () => {
  render(<ReviewGrid review={makeReview()} />)
  const box = within(pocketEl(3)).getByRole("combobox", { name: "Card in pocket 3" })
  await userEvent.click(box)
  const options = await screen.findAllByRole("option")
  expect(options.map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Mew ex"), expect.stringContaining("Pikachu")]))
})

test("arrow keys move between pockets in the 3×3 grid", async () => {
  render(<ReviewGrid review={makeReview()} />)
  pocketEl(1).focus()
  fireEvent.keyDown(pocketEl(1), { key: "ArrowRight" })
  expect(pocketEl(2)).toHaveFocus()
  fireEvent.keyDown(pocketEl(2), { key: "ArrowLeft" })
  fireEvent.keyDown(pocketEl(1), { key: "ArrowDown" })
  expect(pocketEl(4)).toHaveFocus()
  fireEvent.keyDown(pocketEl(4), { key: "ArrowUp" })
  expect(pocketEl(1)).toHaveFocus()
  fireEvent.keyDown(pocketEl(1), { key: "ArrowLeft" })
  expect(pocketEl(1)).toHaveFocus()
})

test("Enter confirms and X rejects the focused pocket", async () => {
  render(<ReviewGrid review={makeReview()} />)
  pocketEl(3).focus()
  fireEvent.keyDown(pocketEl(3), { key: "Enter" })
  await waitFor(() => expect(updateSlotAction).toHaveBeenCalledWith(103, { decision: "confirmed" }))
  fireEvent.keyDown(pocketEl(2), { key: "x" })
  await waitFor(() => expect(updateSlotAction).toHaveBeenCalledWith(102, { decision: "rejected" }))
})

test("a failed change rolls back and shows its message", async () => {
  updateSlotAction.mockResolvedValue({ ok: false, field: "chosenCardId", message: "Pick the card before confirming." })
  render(<ReviewGrid review={makeReview()} />)
  fireEvent.keyDown(pocketEl(2), { key: "x" })
  expect(await within(pocketEl(2)).findByRole("alert")).toHaveTextContent("Pick the card before confirming.")
  expect(within(pocketEl(2)).getByText("Matched")).toBeInTheDocument()
})

test("the claim toggle shows only where a typed-in copy is available or already claimed", () => {
  render(<ReviewGrid review={makeReview()} />)
  expect(within(pocketEl(4)).getByRole("checkbox", { name: "Typed in earlier, use that copy" })).toBeChecked()
  expect(within(pocketEl(2)).queryByRole("checkbox")).toBeNull()
})

test("notes for 1st edition and other pages", () => {
  render(<ReviewGrid review={makeReview()} />)
  expect(within(pocketEl(5)).getByText("1st edition?")).toBeInTheDocument()
  expect(within(pocketEl(5)).getByText("Also in Main · page 2")).toBeInTheDocument()
})

test("the add button counts cards and is disabled until every pocket is decided", async () => {
  const { rerender } = render(<ReviewGrid review={makeReview()} />)
  expect(screen.getByRole("button", { name: "Add 7 cards" })).toBeDisabled()
  rerender(<ReviewGrid review={decided()} />)
  await userEvent.click(screen.getByRole("button", { name: "Add 8 cards" }))
  expect(commitScanAction).toHaveBeenCalledWith(7)
})

test("a rescan shows the change and a Replace page button", () => {
  const diff = { replaces: { scanId: 2, committedAt: "2026-11-15T18:00:00.000Z" }, added: [PIKACHU], removed: [CHARIZARD], unchanged: 1 }
  render(<ReviewGrid review={decided({ diff })} />)
  expect(screen.getByText("+1 new, −1 removed, 1 unchanged")).toBeInTheDocument()
  expect(screen.getByText(/Leaving the collection: Charizard/)).toBeInTheDocument()
  expect(screen.getByRole("button", { name: "Replace page" })).toBeEnabled()
})

test("committed scans render read-only", () => {
  const review = makeReview()
  render(<ReviewGrid review={{ ...review, scan: { ...review.scan, status: "committed" } }} />)
  expect(screen.queryByRole("button")).toBeNull()
  expect(screen.queryByRole("combobox")).toBeNull()
  expect(screen.getByText(/already added/i)).toBeInTheDocument()
})

test("confirming the last pending pocket enables the add button without a reload", async () => {
  render(<ReviewGrid review={makeReview()} />)
  expect(screen.getByRole("button", { name: "Add 7 cards" })).toBeDisabled()
  fireEvent.keyDown(pocketEl(3), { key: "Enter" })
  await waitFor(() => expect(screen.getByRole("button", { name: "Add 8 cards" })).toBeEnabled())
})

test("a scan that is still reading says so instead of 'already added'", () => {
  const review = makeReview({ slots: [] })
  render(<ReviewGrid review={{ ...review, scan: { ...review.scan, status: "reading" } }} />)
  expect(screen.getByText(/still reading/i)).toBeInTheDocument()
  expect(screen.queryByText(/already added/i)).toBeNull()
})
