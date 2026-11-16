const MAX_EDGE = 2000
const JPEG_QUALITY = 0.85

class UnreadableImageError extends Error {
  override name = "UnreadableImageError"
  constructor() {
    super("Couldn't read that photo, try again")
  }
}

type Deps = {
  decode?: (blob: Blob) => Promise<ImageBitmap>
  encode?: (bitmap: ImageBitmap, width: number, height: number) => Promise<Blob>
}

const decodeBitmap = (blob: Blob) => createImageBitmap(blob, { imageOrientation: "from-image" })

async function encodeJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("No 2D canvas")
  context.drawImage(bitmap, 0, 0, width, height)
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))), "image/jpeg", JPEG_QUALITY),
  )
}

async function prepareImage(file: Blob, deps: Deps = {}): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap
  try {
    bitmap = await (deps.decode ?? decodeBitmap)(file)
  } catch {
    throw new UnreadableImageError()
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const blob = await (deps.encode ?? encodeJpeg)(bitmap, width, height)
    return { blob, width, height }
  } catch {
    throw new UnreadableImageError()
  } finally {
    bitmap.close()
  }
}

export { prepareImage, UnreadableImageError }
