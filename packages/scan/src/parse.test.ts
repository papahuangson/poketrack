import { expect, test } from "vitest"
import { parseNumber } from "./parse"

test.each([
  ["199/165", { number: "199", printedTotal: 165 }],
  ["058/102", { number: "58", printedTotal: 102 }],
  ["TG05/TG30", { number: "TG05", printedTotal: 30 }],
  ["SV049/SV122", { number: "SV049", printedTotal: 122 }],
  ["SWSH123", { number: "SWSH123", printedTotal: null }],
  ["SVP 085", { number: "SVP085", printedTotal: null }],
  [" 4 / 102 ", { number: "4", printedTotal: 102 }],
])("parses %j", (input, expected) => {
  expect(parseNumber(input)).toEqual(expected)
})

test.each([[null], [""], ["??"], ["/165"]])("rejects %j", (input) => {
  expect(parseNumber(input)).toBeNull()
})
