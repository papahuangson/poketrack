import { expect, test } from "vitest"
import { parseFilters } from "./params"

const known = { setIds: ["base1"], variants: ["normal"] }

test("valid values pass through", () => {
  expect(parseFilters({ set: "base1", variant: "normal", condition: "LP", sort: "name" }, known)).toEqual({
    setId: "base1",
    variant: "normal",
    condition: "LP",
    sort: "name",
  })
})

test("unknown, repeated and missing values are ignored", () => {
  expect(parseFilters({ set: "nope", variant: ["normal", "x"], condition: "MINT", sort: "price" }, known)).toEqual({
    setId: undefined,
    variant: undefined,
    condition: undefined,
    sort: undefined,
  })
  expect(parseFilters({}, known)).toEqual({ setId: undefined, variant: undefined, condition: undefined, sort: undefined })
})
