import { expect, test } from "vitest"
import { chicagoDate } from "./dates"

test("evening in Chicago is still the same day while UTC has rolled over", () => {
  expect(chicagoDate(new Date("2026-11-15T03:30:00Z"))).toBe("2026-11-14")
})

test("midnight CST starts the new day", () => {
  expect(chicagoDate(new Date("2026-11-15T06:00:00Z"))).toBe("2026-11-15")
})

test("daylight time uses the UTC-5 offset", () => {
  expect(chicagoDate(new Date("2026-07-01T04:59:00Z"))).toBe("2026-06-30")
  expect(chicagoDate(new Date("2026-07-01T05:00:00Z"))).toBe("2026-07-01")
})
