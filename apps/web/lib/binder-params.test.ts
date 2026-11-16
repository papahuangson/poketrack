import { expect, test } from "vitest"
import { binderHref, parseBinderParams } from "./binder-params"

const six = () => 6

test("page is clamped to the binder's pages", () => {
  expect(parseBinderParams({ b: "Main", p: "0" }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main", p: "99" }, six).page).toBe(6)
  expect(parseBinderParams({ b: "Main", p: "abc" }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main" }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main", p: "-2" }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main", p: "2.5" }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main", p: ["2", "3"] }, six).page).toBe(1)
  expect(parseBinderParams({ b: "Main", p: "4" }, six).page).toBe(4)
  expect(parseBinderParams({ b: "Main", p: "last" }, six).page).toBe(6)
  expect(parseBinderParams({ b: "Main", p: "3" }, () => 0).page).toBe(1)
})

test("page count is asked for the binder in the URL", () => {
  const asked: string[] = []
  parseBinderParams({ b: " Trade ", p: "2" }, (binder) => (asked.push(binder), 3))
  expect(asked).toEqual(["Trade"])
})

test("binder is trimmed and blank is null", () => {
  expect(parseBinderParams({ b: " Main " }, six).binder).toBe("Main")
  expect(parseBinderParams({ b: "  " }, six).binder).toBeNull()
  expect(parseBinderParams({}, six).binder).toBeNull()
})

test("card refs and highlight", () => {
  expect(parseBinderParams({ card: "r12" }, six).card).toEqual({ resultId: 12 })
  expect(parseBinderParams({ card: "l7" }, six).card).toEqual({ lotId: 7 })
  for (const card of ["x", "r", "12", "r1x", "l-3", ""]) expect(parseBinderParams({ card }, six).card).toBeNull()
  expect(parseBinderParams({ hl: "2" }, six).hl).toBe(2)
  for (const hl of ["0", "10", "x", "2.5"]) expect(parseBinderParams({ hl }, six).hl).toBeNull()
  expect(parseBinderParams({}, six)).toEqual({ binder: null, page: 1, card: null, hl: null })
})

test("binderHref builds the URL and round-trips", () => {
  expect(binderHref({ binder: "Main", page: 3 })).toBe("/binders?b=Main&p=3")
  expect(binderHref({ binder: "Main", page: 3, card: { resultId: 12 }, hl: 2 })).toBe("/binders?b=Main&p=3&card=r12&hl=2")
  expect(binderHref({ binder: "Main", page: "last", card: { lotId: 7 } })).toBe("/binders?b=Main&p=last&card=l7")
  const href = binderHref({ binder: "Trade & Extras", page: 2, card: { lotId: 7 }, hl: 9 })
  expect(href).toBe("/binders?b=Trade%20%26%20Extras&p=2&card=l7&hl=9")
  const raw = Object.fromEntries(new URL(href, "https://x.test").searchParams)
  expect(parseBinderParams(raw, six)).toEqual({ binder: "Trade & Extras", page: 2, card: { lotId: 7 }, hl: 9 })
})
