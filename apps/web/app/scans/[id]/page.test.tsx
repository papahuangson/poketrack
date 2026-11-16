// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { expect, test, vi } from "vitest"

const loadReview = vi.fn()
vi.mock("@/lib/db", () => ({ getDb: () => "db" }))
vi.mock("@/lib/scan-review", () => ({ loadReview: (...a: unknown[]) => loadReview(...a) }))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND") } }))
vi.mock("@/components/scan/review-grid", () => ({ ReviewGrid: () => null }))

const { default: ScanReviewPage } = await import("./page")

test("a failed scan shows why it failed", async () => {
  loadReview.mockResolvedValue({ scan: { id: 4, status: "failed", error: "Couldn't load the photo: 403" }, slots: [], diff: null, canCommit: false })
  render(await ScanReviewPage({ params: Promise.resolve({ id: "4" }) }))
  expect(screen.getByText("We couldn't read that photo")).toBeInTheDocument()
  expect(screen.getByText("Couldn't load the photo: 403")).toBeInTheDocument()
})
