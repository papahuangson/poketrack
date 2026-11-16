// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, test, vi } from "vitest"

const prepareImage = vi.fn()
vi.mock("@/lib/prepare-image", async (original) => ({
  ...(await original<typeof import("@/lib/prepare-image")>()),
  prepareImage: (...a: unknown[]) => prepareImage(...a),
}))
const upload = vi.fn()
vi.mock("@vercel/blob/client", () => ({ uploadPresigned: (...a: unknown[]) => upload(...a) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { CaptureForm } = await import("./capture-form")
const { UnreadableImageError } = await import("@/lib/prepare-image")

const binders = [
  { name: "Main", lastPage: 3 },
  { name: "Trades", lastPage: null },
]

test("binder defaults to the last-used binder and page to its last page + 1", async () => {
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={async () => null} />)
  expect(screen.getByRole("combobox", { name: "Binder" })).toHaveValue("Main")
  expect(screen.getByRole("spinbutton", { name: "Page" })).toHaveValue(4)
})

test("a replace notice shows when the page already has a committed scan", async () => {
  const lookupPage = vi.fn(async () => ({ id: 2, committedAt: "2026-11-15T18:00:00.000Z", cards: 8 }))
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={lookupPage} />)
  expect(await screen.findByText(/Replaces the scan from Nov 15 \(8 cards\)/)).toBeInTheDocument()
  expect(lookupPage).toHaveBeenCalledWith("Main", 4)
})

test("an unreadable photo shows a retry message", async () => {
  prepareImage.mockRejectedValue(new UnreadableImageError())
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={async () => null} />)
  await userEvent.upload(screen.getByLabelText("Photo of the page"), new File(["x"], "p.heic", { type: "image/heic" }))
  await userEvent.click(screen.getByRole("button", { name: "Scan page" }))
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't read that photo, try again"))
})

test("submitting without a photo asks for one", async () => {
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={async () => null} />)
  await userEvent.click(screen.getByRole("button", { name: "Scan page" }))
  expect(await screen.findByRole("alert")).toHaveTextContent("Take a photo of the page first.")
})

test("a server error page instead of JSON shows a retry message", async () => {
  prepareImage.mockResolvedValue({ blob: new Blob(["x"]), width: 2000, height: 1500 })
  upload.mockResolvedValue({ url: "https://abc.private.blob.vercel-storage.com/scans/page-x.jpg" })
  vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>An error occurred</html>", { status: 504 })))
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={async () => null} />)
  await userEvent.upload(screen.getByLabelText("Photo of the page"), new File(["x"], "p.jpg", { type: "image/jpeg" }))
  await userEvent.click(screen.getByRole("button", { name: "Scan page" }))
  const alert = await screen.findByRole("alert")
  expect(alert).toHaveTextContent("Couldn't read that photo. Try again.")
  expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument()
  vi.unstubAllGlobals()
})

test("the photo is uploaded privately through the presigned route", async () => {
  prepareImage.mockResolvedValue({ blob: new Blob(["x"]), width: 2000, height: 1500 })
  upload.mockReset().mockResolvedValue({ url: "https://abc.private.blob.vercel-storage.com/scans/page-x.jpg" })
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ scanId: 3 }, { status: 201 })))
  render(<CaptureForm binders={binders} initialBinder="Main" lookupPage={async () => null} />)
  await userEvent.upload(screen.getByLabelText("Photo of the page"), new File(["x"], "p.jpg", { type: "image/jpeg" }))
  await userEvent.click(screen.getByRole("button", { name: "Scan page" }))
  await waitFor(() => expect(upload).toHaveBeenCalled())
  expect(upload.mock.calls[0]?.[2]).toMatchObject({ access: "private", handleUploadUrl: "/api/blob/upload", contentType: "image/jpeg" })
  vi.unstubAllGlobals()
})
