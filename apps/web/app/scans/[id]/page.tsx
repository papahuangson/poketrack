import { notFound } from "next/navigation"
import { ReviewGrid } from "@/components/scan/review-grid"
import { getDb } from "@/lib/db"
import { loadReview } from "@/lib/scan-review"

export const dynamic = "force-dynamic"
export const metadata = { title: "Review scan · Poketrack" }

export default async function ScanReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const scanId = Number(id)
  if (!Number.isInteger(scanId) || scanId < 1) notFound()
  const review = await loadReview(getDb(), scanId)
  if (!review) notFound()
  if (review.scan.status === "failed") {
    return (
      <section className="flex flex-col gap-3">
        <h1 className="font-display text-3xl font-semibold">We couldn't read that photo</h1>
        {review.scan.error ? <p className="text-sm text-ink-soft">{review.scan.error}</p> : null}
        <p>
          <a href="/scan">Scan the page again</a>
        </p>
      </section>
    )
  }
  return <ReviewGrid review={review} />
}
