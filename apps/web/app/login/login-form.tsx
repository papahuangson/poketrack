"use client"

import { useActionState } from "react"
import { loginAction } from "./actions"

function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, undefined)
  return (
    <form action={action} className="mx-auto mt-16 flex max-w-xs flex-col gap-3">
      <h1 className="font-display text-2xl font-semibold">Poketrack</h1>
      <label className="flex flex-col gap-1 text-sm">
        Passcode
        <input name="passcode" type="password" autoComplete="current-password" required autoFocus className="rounded border border-line px-3 py-2" />
      </label>
      <input type="hidden" name="next" value={next} />
      {state?.error ? (
        <p role="alert" className="text-sm text-down">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="rounded bg-ink px-3 py-2 text-surface disabled:opacity-60">
        {pending ? "Checking…" : "Open"}
      </button>
    </form>
  )
}

export { LoginForm }
