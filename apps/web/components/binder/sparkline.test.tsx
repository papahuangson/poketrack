// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { expect, test } from "vitest"
import { Sparkline } from "./sparkline"

const pairs = (el: Element) => el.getAttribute("points")!.trim().split(/\s+/).map((p) => p.split(",").map(Number))

test("draws one line with a point per snapshot, rising prices going up", () => {
  const { container } = render(
    <Sparkline
      points={[
        { date: "2026-09-01", cents: 200 },
        { date: "2026-10-15", cents: 300 },
        { date: "2026-11-14", cents: 410 },
      ]}
    />,
  )
  const lines = container.querySelectorAll("polyline")
  expect(lines).toHaveLength(1)
  const points = pairs(lines[0]!)
  expect(points).toHaveLength(3)
  expect(points.flat().every(Number.isFinite)).toBe(true)
  expect(points[0]![0]).toBeLessThan(points[1]![0]!)
  expect(points[1]![0]).toBeLessThan(points[2]![0]!)
  expect(points[0]![1]).toBeGreaterThan(points[2]![1]!)
  expect(container.querySelector("svg")).toHaveAccessibleName("Price over the last 90 days, from $2.00 to $4.10")
})

test("a flat price draws a level line", () => {
  const { container } = render(<Sparkline points={[{ date: "2026-11-13", cents: 300 }, { date: "2026-11-14", cents: 300 }]} />)
  const points = pairs(container.querySelector("polyline")!)
  expect(points[0]![1]).toBe(points[1]![1])
  expect(points.flat().every(Number.isFinite)).toBe(true)
})

test("fewer than two points renders nothing", () => {
  expect(render(<Sparkline points={[{ date: "2026-11-14", cents: 410 }]} />).container).toBeEmptyDOMElement()
  expect(render(<Sparkline points={[]} />).container).toBeEmptyDOMElement()
})
