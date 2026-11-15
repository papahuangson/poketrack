import { searchCards } from "@/lib/collection"
import { getDb } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<Response> {
  const q = new URL(request.url).searchParams.get("q") ?? ""
  return Response.json(await searchCards(getDb(), q))
}
