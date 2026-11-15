import { createDb, RUNNERS, type Runner } from "@poketrack/db"
import { syncCatalog } from "./catalog-sync"
import { runNightly } from "./nightly"
import { createPokemonTcgIo } from "./providers/pokemontcgio"

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`${name} is not set`)
    process.exit(2)
  }
  return value
}

async function main(): Promise<number> {
  const command = process.argv[2]
  if (command !== "backfill" && command !== "nightly") {
    console.error("Usage: jobs <backfill|nightly>")
    return 2
  }

  const db = createDb(requireEnv("DATABASE_URL"))
  const provider = createPokemonTcgIo({ apiKey: process.env.POKEMONTCG_API_KEY })

  if (command === "backfill") {
    const result = await syncCatalog(db, provider, { full: true })
    console.log(`Backfill done: ${result.setsFetched} sets, ${result.cardsUpserted} cards`)
    return 0
  }

  const runner = RUNNERS.find((r) => r === process.env.RUNNER) ?? ("nas" satisfies Runner)
  const result = await runNightly(db, provider, { runner, gitSha: process.env.GIT_SHA || "unknown" })
  console.log(JSON.stringify(result))
  return result.claimed && result.status === "failed" ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
