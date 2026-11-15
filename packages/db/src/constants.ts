const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const
type Condition = (typeof CONDITIONS)[number]

const RUNNERS = ["nas", "vercel"] as const
type Runner = (typeof RUNNERS)[number]

const RUN_STATUSES = ["running", "ok", "failed"] as const
type RunStatus = (typeof RUN_STATUSES)[number]

export { CONDITIONS, RUNNERS, RUN_STATUSES }
export type { Condition, Runner, RunStatus }
