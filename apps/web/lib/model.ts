import Anthropic from "@anthropic-ai/sdk"
import type { ModelClient } from "@poketrack/scan"

const DEFAULT_MODEL = "claude-sonnet-5-5"

let client: ModelClient | undefined

function getModelClient(): ModelClient {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set")
    const anthropic = new Anthropic({ apiKey, maxRetries: 0, timeout: 25_000 })
    client = { create: (params) => anthropic.messages.create(params) }
  }
  return client
}

function getModelName(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL
}

export { getModelClient, getModelName }
