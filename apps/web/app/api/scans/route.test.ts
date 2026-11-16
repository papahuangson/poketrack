import { beforeEach, expect, test, vi } from "vitest"

const runScan = vi.fn()
vi.mock("@poketrack/scan", () => ({ runScan: (...a: unknown[]) => runScan(...a) }))
vi.mock("@/lib/db", () => ({ getDb: () => "db" }))
vi.mock("@/lib/model", () => ({ getModelClient: () => "client", getModelName: () => "claude-test" }))
vi.mock("@/lib/collection", () => ({ defaultVariant: vi.fn() }))
const loadPrivateImage = vi.fn()
vi.mock("@/lib/private-blob", async (original) => ({
  ...(await original<typeof import("@/lib/private-blob")>()),
  loadPrivateImage: (...a: unknown[]) => loadPrivateImage(...a),
}))

const route = await import("./route")
const { ValidationError } = await import("@/lib/errors")

const body = { imageUrl: "https://abc.private.blob.vercel-storage.com/scans/p-x1.jpg", width: 2000, height: 1500, binder: " Main ", page: 3 }
const post = (b: unknown) => route.POST(new Request("https://t/api/scans", { method: "POST", body: JSON.stringify(b) }))

beforeEach(() => {
  runScan.mockReset()
})

test("a valid body runs the scan and returns 201 with the scan id", async () => {
  runScan.mockResolvedValue({ scanId: 7, status: "ready" })
  const res = await post(body)
  expect(res.status).toBe(201)
  expect(await res.json()).toEqual({ scanId: 7 })
  expect(runScan.mock.calls[0]?.[1]).toBe("client")
  expect(runScan.mock.calls[0]?.[2]).toEqual({ ...body, binder: "Main" })
  expect(runScan.mock.calls[0]?.[3]).toMatchObject({ model: "claude-test" })
  await runScan.mock.calls[0]?.[3].loadImage(body.imageUrl)
  expect(loadPrivateImage).toHaveBeenCalledWith(body.imageUrl)
})

test("a validation error returns 400 with the field", async () => {
  runScan.mockImplementation(async () => {
    throw new ValidationError("page", "Page must be a whole number from 1 up.")
  })
  const res = await post({ ...body, page: 0 })
  expect(res.status).toBe(400)
  expect(await res.json()).toMatchObject({ field: "page" })
})

test("an image URL not on the Blob host returns 400", async () => {
  for (const imageUrl of ["https://evil.test/p.jpg", "https://abc.public.blob.vercel-storage.com/p.jpg", "not a url"]) {
    const res = await post({ ...body, imageUrl })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ field: "imageUrl" })
  }
  expect(runScan).not.toHaveBeenCalled()
})

test("a malformed body returns 400", async () => {
  const res = await route.POST(new Request("https://t/api/scans", { method: "POST", body: "{" }))
  expect(res.status).toBe(400)
})

test("a failed run returns 502 with a message and the scan id", async () => {
  runScan.mockResolvedValue({ scanId: 8, status: "failed" })
  const res = await post(body)
  expect(res.status).toBe(502)
  expect(await res.json()).toMatchObject({ scanId: 8, message: expect.stringMatching(/couldn't read/i) })
})

test("the route allows 60 seconds", () => {
  expect(route.maxDuration).toBe(60)
})
