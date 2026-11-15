const LABELS: Record<string, string> = {
  normal: "Normal",
  holofoil: "Holo",
  reverseHolofoil: "Reverse Holo",
  "1stEditionHolofoil": "1st Edition Holo",
  "1stEditionNormal": "1st Edition",
  unlimitedHolofoil: "Unlimited Holo",
  unlimited: "Unlimited",
}

function variantLabel(variant: string): string {
  const known = LABELS[variant]
  if (known) return known
  const spaced = variant.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  return spaced.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

export { variantLabel }
