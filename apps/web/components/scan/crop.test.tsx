// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { expect, test } from "vitest"
import { Crop } from "./crop"

test("a box scales the photo and offsets it to the pocket", () => {
  render(<Crop imageUrl="https://p/x.jpg" width={2000} height={1500} box={{ x: 0.5, y: 0.25, w: 0.25, h: 0.25 }} alt="Your photo of pocket 6" />)
  const img = screen.getByRole("img", { name: "Your photo of pocket 6" })
  expect(img.style.width).toBe("400%")
  expect(img.style.height).toBe("400%")
  expect(img.style.left).toBe("-200%")
  expect(img.style.top).toBe("-100%")
  expect((img.parentElement as HTMLElement).style.aspectRatio).toBe("500 / 375")
})

test("a missing box shows the whole photo", () => {
  render(<Crop imageUrl="https://p/x.jpg" width={2000} height={1500} box={null} alt="photo" />)
  const img = screen.getByRole("img", { name: "photo" })
  expect(img.style.width).toBe("100%")
  expect(img.style.left).toBe("0%")
})
