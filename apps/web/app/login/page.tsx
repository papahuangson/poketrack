import { LoginForm } from "./login-form"

export const metadata = { title: "Sign in · Poketrack" }

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return <LoginForm next={typeof next === "string" ? next : "/"} />
}
