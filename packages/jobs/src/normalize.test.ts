import { expect, test } from "vitest"
import { normalizeText, reprintKey } from "./normalize"

test("strips accents and lowercases", () => {
  expect(normalizeText("Flabébé")).toBe("flabebe")
})

test("collapses punctuation and whitespace to single spaces", () => {
  expect(normalizeText("Farfetch'd  ex")).toBe("farfetch d ex")
})

test("reprint key ignores case and surrounding whitespace", () => {
  expect(reprintKey("Pikachu", "Gnaw\n")).toBe(reprintKey("PIKACHU", " gnaw"))
})

test("reprint key differs when the rules text differs", () => {
  expect(reprintKey("Pikachu", "Gnaw")).not.toBe(reprintKey("Pikachu", "Thunder Jolt"))
})
