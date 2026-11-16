import type { CardHit } from "@/lib/collection"
import type { Review, ReviewSlot } from "@/lib/scan-review"

const hit = (id: string, name: string, variants = ["normal"]): CardHit => ({
  id,
  name,
  setName: "Base",
  number: id.split("-")[1] ?? "1",
  printedTotal: 102,
  imageSmall: `https://img.test/${id}.webp`,
  variants,
})

const CHARIZARD = hit("base1-4", "Charizard", ["holofoil"])
const PIKACHU = hit("base1-58", "Pikachu")
const MEW = hit("sv3pt5-151", "Mew ex", ["holofoil"])

function pocket(slot: number, over: Partial<ReviewSlot> = {}): ReviewSlot {
  return {
    id: 100 + slot,
    slot,
    empty: false,
    read: { name: "Pikachu", number: "58", printedTotal: 102, setCode: null, cues: null },
    confidence: 0.95,
    box: { x: ((slot - 1) % 3) / 3, y: Math.floor((slot - 1) / 3) / 3, w: 1 / 3, h: 1 / 3 },
    candidates: [{ ...PIKACHU, cardId: PIKACHU.id, score: 0.9, via: "total" }],
    chosen: PIKACHU,
    variant: "normal",
    condition: "NM",
    decision: "confirmed",
    claimManual: false,
    manualLot: null,
    otherPages: [],
    firstEditionNote: false,
    ...over,
  }
}

function makeReview(over: Partial<Review> = {}): Review {
  const slots = [
    pocket(1, { chosen: CHARIZARD, variant: "holofoil", candidates: [{ ...CHARIZARD, cardId: CHARIZARD.id, score: 1, via: "code" }] }),
    pocket(2),
    pocket(3, {
      decision: "pending",
      confidence: 0.6,
      chosen: MEW,
      variant: "holofoil",
      candidates: [
        { ...MEW, cardId: MEW.id, score: 0.6, via: "name" },
        { ...PIKACHU, cardId: PIKACHU.id, score: 0.5, via: "name" },
      ],
    }),
    pocket(4, { manualLot: { id: 9, available: 1 }, claimManual: true }),
    pocket(5, { firstEditionNote: true, otherPages: [{ binder: "Main", page: 2 }] }),
    pocket(6),
    pocket(7),
    pocket(8),
    pocket(9, { empty: true, chosen: null, variant: null, candidates: [], decision: "pending", read: { name: null, number: null, printedTotal: null, setCode: null, cues: null } }),
  ]
  return {
    scan: { id: 7, binder: "Main", page: 3, status: "ready", imageUrl: "https://p/x.jpg", width: 2000, height: 1500, error: null },
    slots,
    diff: null,
    canCommit: false,
    ...over,
  }
}

export { CHARIZARD, makeReview, MEW, PIKACHU, pocket }
