const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const
type Condition = (typeof CONDITIONS)[number]

const RUNNERS = ["nas", "vercel"] as const
type Runner = (typeof RUNNERS)[number]

const RUN_STATUSES = ["running", "ok", "failed"] as const
type RunStatus = (typeof RUN_STATUSES)[number]

const SCAN_STATUSES = ["reading", "ready", "failed", "committed", "superseded"] as const
type ScanStatus = (typeof SCAN_STATUSES)[number]

const DECISIONS = ["pending", "confirmed", "rejected"] as const
type Decision = (typeof DECISIONS)[number]

type SlotCues = { holo: boolean; reverse: boolean; firstEdition: boolean }
type SlotBox = { x: number; y: number; w: number; h: number }
type Candidate = { cardId: string; score: number; via: "code" | "total" | "name" }

export { CONDITIONS, DECISIONS, RUNNERS, RUN_STATUSES, SCAN_STATUSES }
export type { Candidate, Condition, Decision, Runner, RunStatus, ScanStatus, SlotBox, SlotCues }
