import { NextResponse, type NextRequest } from "next/server"
import { SESSION_COOKIE, sessionEnv, verifySession } from "./lib/session"

const OPEN_PATHS = ["/login", "/api/cron/nightly"]

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl
  if (OPEN_PATHS.includes(pathname)) return NextResponse.next()

  if (await verifySession(request.cookies.get(SESSION_COOKIE)?.value, Date.now(), sessionEnv())) return NextResponse.next()

  if (pathname.startsWith("/api/")) return NextResponse.json({ message: "Sign in first." }, { status: 401 })
  const login = new URL("/login", request.url)
  login.searchParams.set("next", `${pathname}${search}`)
  return NextResponse.redirect(login)
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
}

