import { type Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, expect, test, vi } from "vitest"
import { addItem } from "@/lib/collection"
import { commitPage, seedCards } from "@/lib/scan-fixtures"

let db: Db
vi.mock("@/lib/db", () => ({ getDb: () => db }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
const BinderScreen = vi.fn((_props: Record<string, unknown>) => null)
vi.mock("@/components/binder/binder-screen", () => ({ BinderScreen: (props: Record<string, unknown>) => BinderScreen(props) }))

const { default: BindersPage } = await import("./page")

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
  BinderScreen.mockClear()
  // The first run in a file builds the migrated template database, which can be slow on a busy machine.
}, 30_000)

type Shown = {
  binders: string[]
  page: { binder: string; page: number; pageCount: number; scanId: number | null; pockets: { state: string }[] }
  unplaced: { lotId: number }[]
  highlightSlot: number | null
  detail: { mode: string; name: string } | null
}

function find(node: ReactNode): Shown | null {
  if (Array.isArray(node)) return node.map(find).find(Boolean) ?? null
  if (!isValidElement(node)) return null
  const element = node as ReactElement<{ children?: ReactNode; page?: unknown }>
  if (element.props.page) return element.props as unknown as Shown
  return find(element.props.children)
}

const open = async (params: Record<string, string>) => {
  const tree = await BindersPage({ searchParams: Promise.resolve(params) })
  return { shown: find(tree), html: renderToStaticMarkup(tree) }
}

async function twoBinders() {
  await commitPage(db, { binder: "Main", page: 1, pockets: [{ card: "base1-58" }] })
  const three = await commitPage(db, { binder: "Main", page: 3, pockets: [{ card: "sv3pt5-199" }, { card: "base1-58" }] })
  await commitPage(db, { binder: "Trade", page: 1, pockets: [{ card: "sv3pt5-151" }] })
  return three
}

test("with no binders it points to scanning", async () => {
  const { shown, html } = await open({})
  expect(shown).toBeNull()
  expect(html).toContain("No binders yet")
  expect(html).toContain('href="/scan"')
})

test("opens the most recently scanned binder at page 1 by default", async () => {
  await twoBinders()
  const { shown } = await open({})
  expect(shown).toMatchObject({ binders: ["Main", "Trade"], page: { binder: "Trade", page: 1, pageCount: 1 }, highlightSlot: null, detail: null })
})

test("a binder name typed differently opens under its stored name", async () => {
  await twoBinders()
  for (const b of ["main", "Main ", " MAIN"]) expect((await open({ b, p: "3" })).shown?.page, b).toMatchObject({ binder: "Main", page: 3, pageCount: 3 })
})

test("an unknown binder falls back to the latest one", async () => {
  await twoBinders()
  expect((await open({ b: "Nope", p: "3" })).shown?.page).toMatchObject({ binder: "Trade", page: 1 })
})

test("bad page numbers are clamped into the binder", async () => {
  await twoBinders()
  for (const [p, page] of [["0", 1], ["99", 3], ["abc", 1], ["last", 3]] as const) {
    expect((await open({ b: "Main", p })).shown?.page.page, p).toBe(page)
  }
})

test("a gap page is shown unscanned", async () => {
  await twoBinders()
  expect((await open({ b: "Main", p: "2" })).shown?.page).toMatchObject({ binder: "Main", page: 2, pageCount: 3, scanId: null, pockets: [] })
})

test("unplaced lots come with the last page only", async () => {
  await twoBinders()
  const { id } = await addItem(db, { cardId: "sv3pt5-151", variant: "holofoil", condition: "NM", quantity: 1, binder: "Main" })
  expect((await open({ b: "Main", p: "1" })).shown?.unplaced).toEqual([])
  expect((await open({ b: "Main", p: "3" })).shown?.unplaced.map((u) => u.lotId)).toEqual([id])
})

test("a binder with only typed-in cards shows an unscanned first page and its cards", async () => {
  const { id } = await addItem(db, { cardId: "base1-58", variant: "normal", condition: "NM", quantity: 2, binder: "Shoebox" })
  const { shown } = await open({ b: "shoebox", p: "4" })
  expect(shown?.page).toMatchObject({ binder: "Shoebox", page: 1, pageCount: 1, scanId: null })
  expect(shown?.unplaced.map((u) => u.lotId)).toEqual([id])
})

test("card and highlight params load the panel and the highlight", async () => {
  const { resultIds } = await twoBinders()
  const { shown } = await open({ b: "Main", p: "3", card: `r${resultIds[1]}`, hl: "2" })
  expect(shown).toMatchObject({ highlightSlot: 2, detail: { mode: "pocket", name: "Pikachu" } })
  expect((await open({ b: "Main", p: "3", card: "r9999" })).shown?.detail).toBeNull()
  expect((await open({ b: "Main", p: "3", card: "junk", hl: "12" })).shown).toMatchObject({ detail: null, highlightSlot: null })
})
