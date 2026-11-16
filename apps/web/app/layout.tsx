import type { Metadata } from "next"
import Link from "next/link"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  title: "Poketrack",
  description: "Your Pokémon card collection and what it is worth.",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl items-baseline gap-8 px-4 py-3 sm:px-6">
            <Link href="/" className="font-display text-xl font-semibold tracking-tight no-underline">
              Poketrack
            </Link>
            <nav aria-label="Main" className="flex gap-6 text-sm">
              <Link href="/" className="no-underline underline-offset-4 hover:underline">
                Collection
              </Link>
              <Link href="/scans" className="no-underline underline-offset-4 hover:underline">
                Scans
              </Link>
              <Link href="/settings" className="no-underline underline-offset-4 hover:underline">
                Settings
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
      </body>
    </html>
  )
}
