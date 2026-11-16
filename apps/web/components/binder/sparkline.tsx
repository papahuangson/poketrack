import { formatUsd } from "@/lib/money"

type Props = { points: { date: string; cents: number }[] }

const WIDTH = 120
const HEIGHT = 32
const PAD = 2

// Price history as a small line. Points are spaced by date, so gaps in the snapshots show as longer segments.
function Sparkline({ points }: Props) {
  if (points.length < 2) return null
  const times = points.map((p) => Date.parse(p.date))
  const firstTime = times[0]!
  const span = times.at(-1)! - firstTime
  const low = Math.min(...points.map((p) => p.cents))
  const range = Math.max(...points.map((p) => p.cents)) - low
  const coordinates = points.map((p, i) => {
    const x = PAD + (span > 0 ? (times[i]! - firstTime) / span : i / (points.length - 1)) * (WIDTH - PAD * 2)
    const y = range > 0 ? HEIGHT - PAD - ((p.cents - low) / range) * (HEIGHT - PAD * 2) : HEIGHT / 2
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg
      role="img"
      aria-label={`Price over the last 90 days, from ${formatUsd(points[0]!.cents)} to ${formatUsd(points.at(-1)!.cents)}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      width={WIDTH}
      height={HEIGHT}
      className="text-ink"
    >
      <polyline points={coordinates.join(" ")} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

export { Sparkline }
