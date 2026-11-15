import { afterEach, beforeEach, expect, test, vi } from "vitest"

const runNightly = vi.fn()

vi.mock("@poketrack/jobs", () => ({
  runNightly: (...args: unknown[]) => runNightly(...args),
  createTcgdex: () => ({ provider: true }),
}))
vi.mock("@/lib/db", () => ({ getDb: () => ({ db: true }) }))

const { GET } = await import("./route")

const request = (authorization?: string) =>
  new Request("https://poketrack.test/api/cron/nightly", { headers: authorization ? { authorization } : {} })

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "s3cret")
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234")
  runNightly.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test("a request without the secret is refused and nothing runs", async () => {
  expect((await GET(request())).status).toBe(401)
  expect((await GET(request("Bearer wrong"))).status).toBe(401)
  expect(runNightly).not.toHaveBeenCalled()
})

test("with no secret configured every request is refused", async () => {
  vi.stubEnv("CRON_SECRET", "")
  expect((await GET(request("Bearer "))).status).toBe(401)
  expect((await GET(request("Bearer undefined"))).status).toBe(401)
  expect(runNightly).not.toHaveBeenCalled()
})

test("the right secret runs the job as the vercel runner", async () => {
  runNightly.mockResolvedValue({ claimed: true, status: "ok" })
  const response = await GET(request("Bearer s3cret"))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ claimed: true, status: "ok" })
  expect(runNightly).toHaveBeenCalledWith({ db: true }, { provider: true }, { runner: "vercel", gitSha: "abc1234" })
})

test("a failed run responds 500", async () => {
  runNightly.mockResolvedValue({ claimed: true, status: "failed", error: "boom" })
  expect((await GET(request("Bearer s3cret"))).status).toBe(500)
})

test("a run the NAS already did responds 200", async () => {
  runNightly.mockResolvedValue({ claimed: false })
  const response = await GET(request("Bearer s3cret"))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ claimed: false })
})
