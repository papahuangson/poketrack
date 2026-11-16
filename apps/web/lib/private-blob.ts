import { get as blobGet } from "@vercel/blob"
import type { InlineImage } from "@poketrack/scan"

type GetFn = (url: string, options: { access: "private" }) => Promise<{ statusCode: number; stream: ReadableStream<Uint8Array> | null; blob: { contentType: string | null } } | null>

const PRIVATE_HOST = ".private.blob.vercel-storage.com"
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const

// True for a link into this project's private Blob store (or any private store when BLOB_STORE_ID isn't set, e.g. locally).
function isOwnPrivateBlob(value: unknown): boolean {
  if (typeof value !== "string") return false
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || !url.hostname.endsWith(PRIVATE_HOST)) return false
  const storeId = process.env.BLOB_STORE_ID?.trim()
  if (!storeId) return true
  return url.hostname === `${storeId.replace(/^store_/, "").toLowerCase()}${PRIVATE_HOST}`
}

async function loadPrivateImage(url: string, deps: { get?: GetFn } = {}): Promise<InlineImage> {
  const found = await (deps.get ?? (blobGet as unknown as GetFn))(url, { access: "private" })
  if (!found || found.statusCode !== 200 || !found.stream) throw new Error("Photo not found in Blob storage")
  const type = found.blob.contentType ?? ""
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) throw new Error(`Stored file is not a photo (${type || "no type"})`)
  const bytes = Buffer.from(await new Response(found.stream).arrayBuffer())
  return { mediaType: type as InlineImage["mediaType"], data: bytes.toString("base64") }
}

export { isOwnPrivateBlob, loadPrivateImage }
