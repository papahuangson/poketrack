import { createDb, loadDotEnv, RUNNERS, type Runner } from "@poketrack/db"
import { syncCatalog } from "./catalog-sync"
import { runNightly } from "./nightly"
import { createTcgdex } from "./providers/tcgdex"

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
    console.error("Usage: jobs <backfill [--full]|nightly>")
    return 2
  }

  loadDotEnv()
  const db = createDb(requireEnv("DATABASE_URL"))
  const provider = createTcgdex()

  if (command === "backfill") {
    // Without --full, sets that already loaded are skipped, so a failed backfill resumes where it stopped.
    const result = await syncCatalog(db, provider, {
      full: process.argv.includes("--full"),
      onSet: (p) => console.log(`[${p.done}/${p.total}] ${p.setId}: ${p.cards} cards`),
    })
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
