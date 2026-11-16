"use server"

import { createHash, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { SESSION_COOKIE, SESSION_DAYS, sessionEnv, signSession } from "@/lib/session"

type LoginState = { error: string } | undefined

const digest = (text: string) => createHash("sha256").update(text).digest()

function localPath(next: FormDataEntryValue | null): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/"
}

async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const env = sessionEnv()
  const given = formData.get("passcode")
  if (env.passcode === "" || env.secret === "" || typeof given !== "string" || !timingSafeEqual(digest(given), digest(env.passcode))) {
    return { error: "That passcode isn't right." }
  }
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
