import type { SlotBox } from "@poketrack/db/constants"

type Props = { imageUrl: string; width: number; height: number; box: SlotBox | null; alt: string; className?: string }

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`

function Crop({ imageUrl, width, height, box, alt, className }: Props) {
  const b = box && box.w > 0 && box.h > 0 ? box : { x: 0, y: 0, w: 1, h: 1 }
  return (
    <div
      className={`relative overflow-hidden rounded-[3px] bg-paper ${className ?? ""}`}
      style={{ aspectRatio: `${Math.round(b.w * width)} / ${Math.round(b.h * height)}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageUrl}
        alt={alt}
        className="absolute max-w-none"
        style={{ width: pct(1 / b.w), height: pct(1 / b.h), left: pct(-b.x / b.w), top: pct(-b.y / b.h) }}
      />
    </div>
  )
}

export { Crop }
