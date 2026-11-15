import { chicagoDate, type Db, type Runner } from "@poketrack/db"
import { syncCatalog } from "./catalog-sync"
import { refreshPrices } from "./prices"
import { claimRun, finishRun } from "./run-lock"
import type { CatalogProvider, PriceProvider } from "./types"

const NIGHTLY_JOB = "nightly"

type NightlyResult = { claimed: false } | { claimed: true; status: "ok" } | { claimed: true; status: "failed"; error: string }

async function runNightly(
  db: Db,
  provider: CatalogProvider & PriceProvider,
  { runner, gitSha, now = new Date() }: { runner: Runner; gitSha: string; now?: Date },
): Promise<NightlyResult> {
  const runDate = chicagoDate(now)
  if (!(await claimRun(db, { job: NIGHTLY_JOB, runDate, runner, gitSha, now }))) return { claimed: false }

  // A new set that fails to sync must not cost the night's prices, so both steps always run.
  const errors: string[] = []
  for (const step of [() => syncCatalog(db, provider), () => refreshPrices(db, provider, runDate)]) {
    try {
      await step()
    } catch (cause) {
      errors.push(cause instanceof Error ? cause.message : String(cause))
    }
  }
  if (errors.length > 0) {
    const error = errors.join("; ")
    await finishRun(db, { job: NIGHTLY_JOB, runDate, status: "failed", error })
    return { claimed: true, status: "failed", error }
  }
  await finishRun(db, { job: NIGHTLY_JOB, runDate, status: "ok" })
  return { claimed: true, status: "ok" }
}

export { NIGHTLY_JOB, runNightly }
export type { NightlyResult }
