import { afterEach, expect, test, vi } from "vitest"

const ctor = vi.fn()
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: vi.fn() }
    constructor(opts: unknown) {
      ctor(opts)
    }
  },
}))

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_MODEL
})

test("two read attempts and the retry pause fit inside the 60 s route limit", async () => {
  process.env.ANTHROPIC_API_KEY = "k"
  const { getModelClient } = await import("./model")
  getModelClient()
  const opts = ctor.mock.calls[0]![0] as { timeout: number; maxRetries: number }
  expect(opts.maxRetries).toBe(0)
  expect(2 * opts.timeout + 1000).toBeLessThan(60_000 - 5_000)
})

test("the model name falls back to the default", async () => {
  const { getModelName } = await import("./model")
  expect(getModelName()).toBe("claude-sonnet-5-5")
  process.env.ANTHROPIC_MODEL = " claude-x "
  expect(getModelName()).toBe("claude-x")
})
