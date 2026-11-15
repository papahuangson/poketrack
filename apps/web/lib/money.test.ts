import { expect, test } from "vitest"
import { ValidationError } from "./errors"
import { formatUsd, parseUsd } from "./money"

test("formats cents as dollars with separators", () => {
  expect(formatUsd(128450)).toBe("$1,284.50")
  expect(formatUsd(5)).toBe("$0.05")
})

test("formats a missing price as a dash", () => {
  expect(formatUsd(null)).toBe("—")
})

test("parses dollars text to cents", () => {
  expect(parseUsd("12.5")).toBe(1250)
  expect(parseUsd(" $1,284.50 ")).toBe(128450)
  expect(parseUsd("0")).toBe(0)
})

test("parses empty text as no value", () => {
  expect(parseUsd("")).toBeNull()
  expect(parseUsd("   ")).toBeNull()
})

test("rejects junk, negatives and more than two decimals", () => {
  for (const text of ["abc", "-3", "1.234", "1e3"]) {
    expect(() => parseUsd(text)).toThrow(ValidationError)
  }
})
