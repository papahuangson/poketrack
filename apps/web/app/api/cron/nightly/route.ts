import { createTcgdex, runNightly } from "@poketrack/jobs"
import { timingSafeEqual } from "node:crypto"
import { getDb } from "@/lib/db"

export const maxDuration = 300
export const dynamic = "force-dynamic"

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get("authorization") ?? "")
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = createTcgdex()
  const result = await runNightly(getDb(), provider, {
    runner: "vercel",
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA || "unknown",
  })
  return Response.json(result, { status: result.claimed && result.status === "failed" ? 500 : 200 })
}
