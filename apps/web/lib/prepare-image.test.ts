import { expect, test, vi } from "vitest"
import { prepareImage, UnreadableImageError } from "./prepare-image"

const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap
const encode = vi.fn(async (_b: ImageBitmap, w: number, h: number) => new Blob([`${w}x${h}`], { type: "image/jpeg" }))

test("a 4000×3000 input becomes 2000×1500", async () => {
  const out = await prepareImage(new Blob(["x"]), { decode: async () => bitmap(4000, 3000), encode })
  expect(out).toMatchObject({ width: 2000, height: 1500 })
  expect(out.blob.type).toBe("image/jpeg")
})

test("a portrait 3000×4000 input becomes 1500×2000", async () => {
  expect(await prepareImage(new Blob(["x"]), { decode: async () => bitmap(3000, 4000), encode })).toMatchObject({ width: 1500, height: 2000 })
})

test("a 1200×900 input stays 1200×900", async () => {
  expect(await prepareImage(new Blob(["x"]), { decode: async () => bitmap(1200, 900), encode })).toMatchObject({ width: 1200, height: 900 })
})

test("the default decoder applies EXIF orientation", async () => {
  const create = vi.fn(async () => bitmap(10, 10))
  vi.stubGlobal("createImageBitmap", create)
  await prepareImage(new Blob(["x"]), { encode })
  expect(create).toHaveBeenCalledWith(expect.any(Blob), { imageOrientation: "from-image" })
  vi.unstubAllGlobals()
})

test("a decode failure throws UnreadableImageError", async () => {
  await expect(prepareImage(new Blob(["x"]), { decode: async () => Promise.reject(new Error("bad")), encode })).rejects.toBeInstanceOf(UnreadableImageError)
})
