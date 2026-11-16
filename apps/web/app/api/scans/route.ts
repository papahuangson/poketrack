import { runScan } from "@poketrack/scan"
import { defaultVariant } from "@/lib/collection"
import { getDb } from "@/lib/db"
import { ValidationError } from "@/lib/errors"
import { getModelClient, getModelName } from "@/lib/model"
import { isOwnPrivateBlob, loadPrivateImage } from "@/lib/private-blob"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const bad = (field: string, message: string) => Response.json({ field, message }, { status: 400 })

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return bad("body", "The request was not valid JSON.")
  }
  if (!isOwnPrivateBlob(body.imageUrl)) return bad("imageUrl", "The photo upload is missing.")
  const imageUrl = new URL(body.imageUrl as string).toString()

  const db = getDb()
  try {
    const { scanId, status, error: reason } = await runScan(
      db,
      getModelClient(),
      {
        imageUrl,
        width: Number(body.width),
        height: Number(body.height),
        binder: typeof body.binder === "string" ? body.binder.trim() : "",
        page: Number(body.page),
      },
      {
        model: getModelName(),
        defaultVariant: (variants) => defaultVariant(db, variants),
        loadImage: (url) => loadPrivateImage(url),
      },
    )
    if (status === "failed") {
      console.error(`Scan ${scanId} failed`, reason)
      const detail = reason ? ` (${reason})` : ""
      return Response.json(
        { scanId, message: `We couldn't read that photo. Try again, or retake it with less glare.${detail}` },
        { status: 502 },
      )
    }
    return Response.json({ scanId }, { status: 201 })
  } catch (error) {
    if (error instanceof ValidationError) return bad(error.field, error.message)
    throw error
  }
}
