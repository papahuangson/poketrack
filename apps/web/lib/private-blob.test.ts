import { afterEach, expect, test, vi } from "vitest"
import { isOwnPrivateBlob, loadPrivateImage } from "./private-blob"

afterEach(() => {
  delete process.env.BLOB_STORE_ID
})

const stream = (text: string) => new Response(text).body!

test("loads a private photo as base64 JPEG", async () => {
  const get = vi.fn(async () => ({ statusCode: 200, stream: stream("ABC"), blob: { contentType: "image/jpeg" } }))
  expect(await loadPrivateImage("https://x.private.blob.vercel-storage.com/a.jpg", { get })).toEqual({ mediaType: "image/jpeg", data: "QUJD" })
  expect(get).toHaveBeenCalledWith("https://x.private.blob.vercel-storage.com/a.jpg", { access: "private" })
})

test("a missing photo or one that isn't an image fails", async () => {
  await expect(loadPrivateImage("u", { get: async () => null })).rejects.toThrow(/not found/)
  const notImage = async () => ({ statusCode: 200, stream: stream("x"), blob: { contentType: "text/html" } })
  await expect(loadPrivateImage("u", { get: notImage })).rejects.toThrow(/not a photo/)
})

test("only this project's private store is accepted when the store id is known", () => {
  process.env.BLOB_STORE_ID = "store_Un1T8pVz4tc0z8mX"
  expect(isOwnPrivateBlob("https://un1t8pvz4tc0z8mx.private.blob.vercel-storage.com/scans/page-a.jpg")).toBe(true)
  expect(isOwnPrivateBlob("https://other.private.blob.vercel-storage.com/scans/page-a.jpg")).toBe(false)
  expect(isOwnPrivateBlob("https://un1t8pvz4tc0z8mx.public.blob.vercel-storage.com/scans/page-a.jpg")).toBe(false)
  expect(isOwnPrivateBlob("http://un1t8pvz4tc0z8mx.private.blob.vercel-storage.com/a.jpg")).toBe(false)
  expect(isOwnPrivateBlob("not a url")).toBe(false)
})

test("without a store id any private Blob host is accepted", () => {
  expect(isOwnPrivateBlob("https://abc.private.blob.vercel-storage.com/a.jpg")).toBe(true)
  expect(isOwnPrivateBlob("https://evil.test/a.jpg")).toBe(false)
})
