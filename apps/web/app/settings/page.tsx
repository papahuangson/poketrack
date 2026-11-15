import { getDb } from "@/lib/db"
import { formatDuration, recentRuns, nasBehind } from "@/lib/job-runs"

export const dynamic = "force-dynamic"

const RUNNER_NAMES = { nas: "NAS", vercel: "Vercel" } as const
const STATUS_NAMES = { ok: "OK", failed: "Failed", running: "Running" } as const

export default async function SettingsPage() {
  const runs = await recentRuns(getDb())
  const behind = nasBehind(runs, process.env.VERCEL_GIT_COMMIT_SHA)

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-semibold">Settings</h1>
      <section aria-labelledby="runs-heading" className="space-y-3">
        <h2 id="runs-heading" className="font-display text-xl font-semibold">
          Nightly price updates
        </h2>
        {behind && (
          <p role="status" className="rounded-md border border-ink bg-energy px-3 py-2 text-sm">
            The NAS last ran version {behind.nas.slice(0, 7)} and this site is on {behind.site.slice(0, 7)}. If you
            have not already, pull the latest image on the NAS.
          </p>
        )}
        {runs.length === 0 ? (
          <p className="text-ink-soft">No runs yet. The first nightly run is at 2:00 AM Central.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="tabular w-full text-left text-sm">
              <thead className="border-b border-line text-ink-soft">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Date</th>
                  <th scope="col" className="px-3 py-2 font-medium">Ran on</th>
                  <th scope="col" className="px-3 py-2 font-medium">Result</th>
                  <th scope="col" className="px-3 py-2 font-medium">Took</th>
                  <th scope="col" className="px-3 py-2 font-medium">Version</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">{run.runDate}</td>
                    <td className="px-3 py-2">{RUNNER_NAMES[run.runner]}</td>
                    <td className="px-3 py-2">
                      <span className={run.status === "failed" ? "font-semibold text-down" : undefined}>
                        {STATUS_NAMES[run.status]}
                      </span>
                      {run.error && <span className="block text-ink-soft">{run.error}</span>}
                    </td>
                    <td className="px-3 py-2">{formatDuration(run)}</td>
                    <td className="px-3 py-2">{run.gitSha.slice(0, 7)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
