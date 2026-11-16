import type { Db } from "@poketrack/db"
import { createTestDb } from "@poketrack/db/testing"
import { beforeEach, expect, test, vi } from "vitest"
import { seedCards, seedScan } from "@/lib/scan-fixtures"

let db: Db
const get = vi.fn()
vi.mock("@/lib/db", () => ({ getDb: () => db }))
vi.mock("@vercel/blob", () => ({ get: (...a: unknown[]) => get(...a) }))

const { GET } = await import("./route")

beforeEach(async () => {
  db = await createTestDb()
  await seedCards(db)
  get.mockReset()
})

const call = (id: string) => GET(new Request(`https://t/api/scans/${id}/photo`), { params: Promise.resolve({ id }) })

test("streams the scan's private photo with a private cache header", async () => {
  const { scanId } = await seedScan(db, { pockets: [{ empty: true }] })
  get.mockResolvedValue({ statusCode: 200, stream: new Response("JPEGDATA").body, blob: { contentType: "image/jpeg", size: 8 } })
  const res = await call(String(scanId))
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toBe("image/jpeg")
  expect(res.headers.get("cache-control")).toMatch(/^private/)
  expect(await res.text()).toBe("JPEGDATA")
  expect(get).toHaveBeenCalledWith("https://x.public.blob.vercel-storage.com/p.jpg", { access: "private" })
})

test("an unknown scan or missing photo is 404", async () => {
  expect((await call("999")).status).toBe(404)
  expect((await call("abc")).status).toBe(404)
  const { scanId } = await seedScan(db, { pockets: [{ empty: true }] })
  get.mockResolvedValue(null)
  expect((await call(String(scanId))).status).toBe(404)
})
