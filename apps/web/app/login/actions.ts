"use server"

import { createHash, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { loginFailures, sql } from "@poketrack/db"
import { getDb } from "@/lib/db"
import { SESSION_COOKIE, SESSION_DAYS, sessionEnv, signSession } from "@/lib/session"

const MAX_FAILURES = 10
const WINDOW_MINUTES = 15

type LoginState = { error: string } | undefined

const digest = (text: string) => createHash("sha256").update(text).digest()

function localPath(next: FormDataEntryValue | null): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/"
}

async function recentFailures(): Promise<number> {
  const result = (await getDb().execute(
    sql`select count(*)::int as n from login_failures where at > now() - make_interval(mins => ${WINDOW_MINUTES})`,
  )) as unknown as { rows: { n: number }[] }
  return result.rows[0]?.n ?? 0
}

async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const env = sessionEnv()
  if ((await recentFailures()) >= MAX_FAILURES) return { error: `Too many tries. Wait ${WINDOW_MINUTES} minutes and try again.` }
  const given = formData.get("passcode")
  if (env.passcode === "" || env.secret === "" || typeof given !== "string" || !timingSafeEqual(digest(given), digest(env.passcode))) {
    await getDb().insert(loginFailures).values({})
    return { error: "That passcode isn't right." }
  }
  await getDb().delete(loginFailures)
  const jar = await cookies()
  jar.set(SESSION_COOKIE, await signSession(Date.now(), env), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  })
  redirect(localPath(formData.get("next")))
}

export { loginAction }
export type { LoginState }
