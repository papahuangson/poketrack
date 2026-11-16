// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, expect, test, vi } from "vitest"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }))

const { Pager } = await import("./pager")
const { BinderPicker } = await import("./binder-picker")

beforeEach(() => {
  replace.mockReset()
  push.mockReset()
})

const show = (page = 3, pageCount = 6) =>
  render(
    <Pager binder="Main" page={page} pageCount={pageCount}>
      <div data-testid="grid">grid</div>
    </Pager>,
  )

test("shows where you are", () => {
  show()
  expect(screen.getByText("Page 3 of 6")).toBeInTheDocument()
  expect(screen.getAllByRole("link", { name: /^Page \d$/ })).toHaveLength(6)
  expect(screen.getByRole("link", { name: "Page 3" })).toHaveAttribute("aria-current", "page")
  expect(screen.getByRole("link", { name: "Page 2" })).not.toHaveAttribute("aria-current")
})

test("next and previous flip with replace", async () => {
  show()
  await userEvent.click(screen.getByRole("button", { name: "Next page" }))
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=4", { scroll: false })
  await userEvent.click(screen.getByRole("button", { name: "Previous page" }))
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=2", { scroll: false })
  expect(push).not.toHaveBeenCalled()
})

test("the ends do nothing", async () => {
  show(1, 1)
  await userEvent.click(screen.getByRole("button", { name: "Next page" }))
  await userEvent.click(screen.getByRole("button", { name: "Previous page" }))
  fireEvent.keyDown(document.body, { key: "ArrowRight" })
  fireEvent.keyDown(document.body, { key: "ArrowLeft" })
  expect(replace).not.toHaveBeenCalled()
})

test("a dot jumps to its page", async () => {
  show()
  await userEvent.click(screen.getByRole("link", { name: "Page 1" }))
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=1", { scroll: false })
})

test("arrow keys flip unless a field or dialog has focus", () => {
  show()
  fireEvent.keyDown(document.body, { key: "ArrowLeft" })
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=2", { scroll: false })
  fireEvent.keyDown(document.body, { key: "ArrowRight" })
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=4", { scroll: false })
  replace.mockReset()

  const input = document.body.appendChild(document.createElement("input"))
  fireEvent.keyDown(input, { key: "ArrowRight" })
  const dialog = document.body.appendChild(document.createElement("div"))
  dialog.setAttribute("role", "dialog")
  const inside = dialog.appendChild(document.createElement("button"))
  fireEvent.keyDown(inside, { key: "ArrowRight" })
  fireEvent.keyDown(document.body, { key: "ArrowRight", altKey: true })
  expect(replace).not.toHaveBeenCalled()
  input.remove()
  dialog.remove()
})

const swipe = (from: [number, number], to: [number, number]) => {
  const area = screen.getByTestId("grid").parentElement!
  fireEvent.pointerDown(area, { clientX: from[0], clientY: from[1], pointerType: "touch" })
  fireEvent.pointerUp(area, { clientX: to[0], clientY: to[1], pointerType: "touch" })
}

test("a left swipe flips forward and a right swipe flips back", () => {
  show()
  swipe([200, 100], [120, 110])
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=4", { scroll: false })
  swipe([120, 100], [200, 110])
  expect(replace).toHaveBeenLastCalledWith("/binders?b=Main&p=2", { scroll: false })
})

test("a short or mostly vertical drag does nothing", () => {
  show()
  swipe([200, 100], [160, 100])
  swipe([200, 100], [140, 200])
  expect(replace).not.toHaveBeenCalled()
})

test("the binder picker opens another binder at page 1", async () => {
  render(<BinderPicker binders={["Main", "Trade"]} current="Main" />)
  await userEvent.click(screen.getByRole("combobox", { name: "Binder" }))
  await userEvent.click(await screen.findByRole("option", { name: "Trade" }))
  expect(push).toHaveBeenCalledWith("/binders?b=Trade&p=1")
})
