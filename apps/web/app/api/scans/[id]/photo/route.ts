import { eq, scans } from "@poketrack/db"
import { get } from "@vercel/blob"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

const notFound = () => new Response("Not found", { status: 404 })

// Serves a scan's photo from the private Blob store to the signed-in browser (the proxy guards this path).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params
  if (!/^\d+$/.test(id)) return notFound()
  const [scan] = await getDb().select({ imageUrl: scans.imageUrl }).from(scans).where(eq(scans.id, Number(id)))
  if (!scan) return notFound()
  const found = await get(scan.imageUrl, { access: "private" })
  if (!found || found.statusCode !== 200 || !found.stream) return notFound()
  return new Response(found.stream, {
    headers: {
      "content-type": found.blob.contentType ?? "image/jpeg",
      "cache-control": "private, max-age=86400, immutable",
    },
  })
}
