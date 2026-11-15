import { expect, test } from "vitest"
import { variantLabel } from "./variants"

test("known variants get friendly labels", () => {
  expect(variantLabel("normal")).toBe("Normal")
  expect(variantLabel("holofoil")).toBe("Holo")
  expect(variantLabel("reverseHolofoil")).toBe("Reverse Holo")
  expect(variantLabel("1stEditionHolofoil")).toBe("1st Edition Holo")
})

test("unknown variants are spaced and capitalized", () => {
  expect(variantLabel("someNewVariant")).toBe("Some New Variant")
})
