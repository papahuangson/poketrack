import { handleUpload, type HandleUploadBody } from "@vercel/blob/client"

export const dynamic = "force-dynamic"

const MAX_BYTES = 10 * 1024 * 1024

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadBody
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/jpeg"],
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Upload failed" }, { status: 400 })
  }
}
