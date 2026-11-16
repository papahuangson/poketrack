type Props = { name: string; number: string; printedTotal: number; imageSmall: string | null }

// A card face: its image, or its name and number on a plain tile when the catalog has no image.
function CardTile({ name, number, printedTotal, imageSmall }: Props) {
  if (imageSmall) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={imageSmall} alt="" loading="lazy" draggable={false} className="h-full w-full rounded-[4px] object-cover" />
  }
  return (
    <span className="flex h-full w-full flex-col items-center justify-center gap-1 rounded-[4px] border border-line bg-surface p-1 text-center">
      <span className="line-clamp-3 text-xs font-semibold leading-tight">{name}</span>
      <span className="tabular text-[0.6875rem] text-ink-soft">
        {number}/{printedTotal}
      </span>
    </span>
  )
}

export { CardTile }
