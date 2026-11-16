// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { TotalHeader } from "./total-header"

test("shows the total as dollars", () => {
  render(<TotalHeader totalCents={128450} changeCents={null} unpricedCount={0} />)
  expect(screen.getByText("$1,284.50")).toBeInTheDocument()
})

test("a rise shows an up arrow and the amount", () => {
  render(<TotalHeader totalCents={128450} changeCents={1210} unpricedCount={0} />)
  expect(screen.getByText("▲ $12.10 since last update")).toBeInTheDocument()
})

test("a drop shows a down arrow and the amount without a minus sign", () => {
  render(<TotalHeader totalCents={128450} changeCents={-300} unpricedCount={0} />)
  expect(screen.getByText("▼ $3.00 since last update")).toBeInTheDocument()
})

test("no change text when there is nothing to compare or nothing moved", () => {
  const { rerender } = render(<TotalHeader totalCents={100} changeCents={null} unpricedCount={0} />)
  expect(screen.queryByText(/since last update/)).not.toBeInTheDocument()
  rerender(<TotalHeader totalCents={100} changeCents={0} unpricedCount={0} />)
  expect(screen.queryByText(/since last update/)).not.toBeInTheDocument()
})

test("counts unpriced cards, with a singular form", () => {
  const { rerender } = render(<TotalHeader totalCents={100} changeCents={null} unpricedCount={3} />)
  expect(screen.getByText("3 cards unpriced")).toBeInTheDocument()
  rerender(<TotalHeader totalCents={100} changeCents={null} unpricedCount={1} />)
  expect(screen.getByText("1 card unpriced")).toBeInTheDocument()
  rerender(<TotalHeader totalCents={100} changeCents={null} unpricedCount={0} />)
  expect(screen.queryByText(/unpriced/)).not.toBeInTheDocument()
})

test("says that condition is ignored", () => {
  render(<TotalHeader totalCents={100} changeCents={null} unpricedCount={0} />)
  expect(screen.getByText("Values use market price and ignore condition.")).toBeInTheDocument()
})

test("links to scanning a page", () => {
  render(<TotalHeader totalCents={100} changeCents={null} unpricedCount={0} />)
  expect(screen.getByRole("link", { name: "Scan a page" })).toHaveAttribute("href", "/scan")
})
