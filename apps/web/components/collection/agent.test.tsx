// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { createAgent } from "@ui-sdk/react/agent"
import { expect, test, vi } from "vitest"

const replace = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/app/actions", () => ({
  addCardAction: vi.fn(),
  defaultVariantAction: vi.fn(async () => "normal"),
  updateItemAction: vi.fn(),
  removeItemAction: vi.fn(),
}))

const { AddCard } = await import("./add-card")
const { Filters } = await import("./filters")

test("an agent can find every collection control by name and change the sort", async () => {
  const agent = createAgent()
  render(
    <>
      <AddCard />
      <Filters sets={[{ id: "base1", name: "Base" }]} variants={["normal"]} current={{}} />
    </>,
  )

  const components = agent.snapshot().filter((entry) => !entry.offPage && entry.component !== "more")
  for (const entry of components) {
    expect(entry.label, `${entry.component} ${entry.ref} has no name`).toBeTruthy()
  }
  const labels = components.map((entry) => entry.label)
  for (const label of ["Add a card", "Set", "Variant", "Condition", "Sort by"]) {
    expect(labels, `${label} is missing from the snapshot`).toContain(label)
  }

  const result = await agent.act({
    steps: [
      { ref: "Sort by", action: "setValue", args: ["Name"] },
      { ref: "Set", action: "setValue", args: ["Base"] },
    ],
  })
  expect(result.ok, result.error?.message).toBe(true)
  expect(replace).toHaveBeenCalledWith("/?sort=name", { scroll: false })
  expect(replace).toHaveBeenCalledWith("/?set=base1", { scroll: false })
})
