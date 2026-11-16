const SESSION_COOKIE = "pt_session"
const SESSION_DAYS = 90
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

type SessionEnv = { passcode: string; secret: string }

const encoder = new TextEncoder()

function base64url(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("base64url")
}

async function signature(expires: number, env: SessionEnv): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(env.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return base64url(await crypto.subtle.sign("HMAC", key, encoder.encode(`${expires}.${env.passcode}`)))
}

function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function signSession(nowMs: number, env: SessionEnv): Promise<string> {
  const expires = nowMs + SESSION_MS
  return `${expires}.${await signature(expires, env)}`
}

async function verifySession(token: string | undefined, nowMs: number, env: SessionEnv): Promise<boolean> {
  if (!token || env.passcode === "" || env.secret === "") return false
  const [expText, sig, ...rest] = token.split(".")
  if (!expText || !sig || rest.length > 0 || !/^\d+$/.test(expText)) return false
  const expires = Number(expText)
  if (expires < nowMs) return false
  return sameText(sig, await signature(expires, env))
}

function sessionEnv(): SessionEnv {
  return { passcode: process.env.APP_PASSCODE ?? "", secret: process.env.SESSION_SECRET ?? "" }
}

export { SESSION_COOKIE, SESSION_DAYS, sessionEnv, signSession, verifySession }
export type { SessionEnv }
