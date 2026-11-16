import { issueSignedToken } from "@vercel/blob"
import { handleUploadPresigned, type HandleUploadPresignedBody } from "@vercel/blob/client"

export const dynamic = "force-dynamic"

const MAX_BYTES = 10 * 1024 * 1024

// Signs browser uploads into the project's private Blob store. Auth comes from the store connection
// (VERCEL_OIDC_TOKEN + BLOB_STORE_ID); this route itself sits behind the passcode proxy.
export async function POST(request: Request): Promise<Response> {
  const body = (await request.json()) as HandleUploadPresignedBody
  try {
    const result = await handleUploadPresigned({
      body,
      request,
      getSignedToken: async (pathname) => {
        if (!pathname.startsWith("scans/")) throw new Error("Uploads must go under scans/")
        const token = await issueSignedToken({
          pathname,
          operations: ["put"],
          allowedContentTypes: ["image/jpeg"],
          maximumSizeInBytes: MAX_BYTES,
        })
        return { token, urlOptions: { addRandomSuffix: true } }
      },
    })
    return Response.json(result)
  } catch (error) {
    return Response.json({ message: error instanceof Error ? error.message : "Upload failed" }, { status: 400 })
  }
}
