import { beforeEach, expect, test, vi } from "vitest"

const handleUploadPresigned = vi.fn()
const issueSignedToken = vi.fn()
vi.mock("@vercel/blob/client", () => ({ handleUploadPresigned: (...a: unknown[]) => handleUploadPresigned(...a) }))
vi.mock("@vercel/blob", () => ({ issueSignedToken: (...a: unknown[]) => issueSignedToken(...a) }))

const { POST } = await import("./route")

beforeEach(() => {
  handleUploadPresigned.mockReset().mockResolvedValue({ type: "blob.generate-presigned-url", presignedUrlPayload: {} })
  issueSignedToken.mockReset().mockResolvedValue({ token: "t" })
})

const post = () => POST(new Request("https://t/api/blob/upload", { method: "POST", body: JSON.stringify({ type: "x" }) }))

test("issues a put-only token for one JPEG up to 10 MB with a random suffix", async () => {
  expect((await post()).status).toBe(200)
  const { getSignedToken } = handleUploadPresigned.mock.calls[0]![0] as { getSignedToken: (p: string, c: null, m: boolean) => Promise<unknown> }
  expect(await getSignedToken("scans/page.jpg", null, false)).toEqual({ token: { token: "t" }, urlOptions: { addRandomSuffix: true } })
  expect(issueSignedToken).toHaveBeenCalledWith({
    pathname: "scans/page.jpg",
    operations: ["put"],
    allowedContentTypes: ["image/jpeg"],
    maximumSizeInBytes: 10 * 1024 * 1024,
  })
})

test("only scans/ paths can be uploaded", async () => {
  await post()
  const { getSignedToken } = handleUploadPresigned.mock.calls[0]![0] as { getSignedToken: (p: string, c: null, m: boolean) => Promise<unknown> }
  await expect(getSignedToken("other/x.jpg", null, false)).rejects.toThrow()
})

test("a failure returns 400 with a message", async () => {
  handleUploadPresigned.mockRejectedValue(new Error("No blob credentials found"))
  const res = await post()
  expect(res.status).toBe(400)
  expect(await res.json()).toEqual({ message: "No blob credentials found" })
})
