# Poketrack Phase 2 (Photo ID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Photograph a 9-pocket binder page, identify the cards with one Claude vision call, review them on a 3×3 grid, and commit them as the record of that page (rescans replace, hand-typed copies are claimed).

**Architecture:** A new `packages/scan` holds pure pipeline functions: parse, match, read, and `runScan`. They take a `Db` and an injected model client. `apps/web` adds Blob client upload, `POST /api/scans` (synchronous, approach A), the review page with server actions per change, and `commitScan`, a single transaction that reuses Phase 1's `addItem`. A passcode cookie checked in Next's request interceptor replaces Deployment Protection.

**Tech Stack:** pnpm workspace, Next.js 16 App Router, React 19, ui-sdk `0.1.0-beta.1`, Drizzle + Postgres (PGlite with pg_trgm in tests), Vitest, `@anthropic-ai/sdk`, `@vercel/blob`.

**Spec:** `docs/superpowers/specs/2026-11-15-poketrack-phase-2-design.md`. It builds on `docs/superpowers/specs/2026-11-14-poketrack-phase-1-design.md`. Read both.

## Global Constraints

- `@ui-sdk/react` and `@ui-sdk/core` stay pinned at exactly `0.1.0-beta.1`. Use public entry points only. Components go in `apps/web/components/ui` or a feature folder.
- All scripts must be cross-platform (the dev machine is Windows).
- `apps/web/AGENTS.md`: this Next.js version differs from training data. Read the matching guide in `apps/web/node_modules/next/dist/docs/` before writing the request interceptor (Next 16 names it `proxy.ts`, not `middleware.ts`), route segment config (`maxDuration`), or server actions.
- One vision call per page. No second pass in Phase 2.
- `POST /api/scans` sets `maxDuration = 60`.
- Conditions: `NM, LP, MP, HP, DMG`, default `NM`. Variants are limited to the card's `cards.variants`.
- Auto-confirm threshold: confidence ≥ `0.9`.
- Match scores:
  - set code + number = `1.0`
  - printed total + number, single hit = `0.9`, several hits ≤ `0.8`, name similarity ≥ `0.4`
  - fuzzy name ≤ `0.7`, top 3
- Slot confidence = `min(vision confidence, match score)`.
- Image: long edge `2000` px, JPEG ~`0.85`, EXIF orientation applied in the browser.
- Passcode cookie lasts 90 days, signed and httpOnly. `/login` and `/api/cron/nightly` are exempt.
- New env vars: `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `BLOB_READ_WRITE_TOKEN`, `APP_PASSCODE`, `SESSION_SECRET`.
- Never send `ANTHROPIC_API_KEY` to the browser. Never call the live API in tests.
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ECDx5SGW45zPjnkEjZDEw6
  ```

## Review Focus

1. **iPhone photos (HEIC, rotated EXIF).** Expected: the browser resize always produces an upright JPEG, and HEIC that the browser can decode works. If it can't be decoded, the page shows "Couldn't read that photo, try again" instead of uploading garbage. Pinned in Task 7 (`prepareImage` tests).
2. **The model returns fewer than 9 slots, more than 9, duplicate slot numbers, or out-of-range boxes.** Expected: results are normalized to exactly slots 1–9. A missing slot becomes a pending, unreadable pocket (not empty), duplicates keep the higher confidence, and boxes are clamped to 0–1. Pinned in Task 4.
3. **The same card in two pockets of one page, with a hand-typed lot of quantity 1.** Expected: only one pocket can claim the manual copy, and the lot merges to quantity 2. Pinned in Task 8 (claim availability) and Task 9 (commit).
4. **A rescan after HB deleted a scanned lot by hand.** Expected: `collection_item_id` was set to null when the row was deleted, the undo skips it, and nothing throws. Pinned in Task 1 (FK `on delete set null`) and Task 9.
5. **The passcode changes after the cookie was issued.** Expected: old cookies stop working, because the signature includes the passcode. Pinned in Task 6.

---

### Task 1: Scan tables and migration

**Files:**
- Modify: `packages/db/src/schema.ts`, `packages/db/src/constants.ts`
- Create: `packages/db/drizzle/0001_*.sql` (via `pnpm db:generate`)
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces:
  - `SCAN_STATUSES = ["reading","ready","failed","committed","superseded"]` and `ScanStatus`
  - `DECISIONS = ["pending","confirmed","rejected"]` and `Decision`
  - `scans` and `scanResults` tables, exported from `@poketrack/db`
  - Types:
    - `SlotCues = { holo: boolean; reverse: boolean; firstEdition: boolean }`
    - `SlotBox = { x: number; y: number; w: number; h: number }`
    - `Candidate = { cardId: string; score: number; via: "code" | "total" | "name" }`

- [ ] **Step 1: Write failing tests in `schema.test.ts`**
  - `two committed scans for the same binder+page violate scans_one_committed_page`: insert scan A (`binder:"Main", page:3, status:"committed"`). Inserting B with the same binder, page and `committed` status rejects. B as `ready` succeeds.
  - `binder uniqueness ignores case and spaces`: committed `"Main"` p3, then committed `" main "` p3, rejects.
  - `scan_results slot is unique per scan`: a second `(scanId, 1)` rejects.
  - `deleting a collection item nulls scan_results.collection_item_id`: delete the item and the result row survives with `collectionItemId === null`. The same holds for `claimedFromItemId`.
- [ ] **Step 2:** Run `pnpm vitest run packages/db/src/schema.test.ts`. Expected: FAIL (tables not defined).
- [ ] **Step 3: Add the tables.** Columns are exactly as in the spec's Data model. Notes:
  - `scans.id` and `scan_results.id` are serial.
  - `status` defaults to `reading`. `decision` defaults to `pending`. `claim_manual` defaults to false. `empty` defaults to false.
  - `read_cues`, `box` and `candidates` are typed jsonb, and `candidates` defaults to `[]`.
  - `scan_results.scan_id` FK to scans with `on delete cascade`.
  - `chosen_card_id` FK to cards.
  - `collection_item_id` and `claimed_from_item_id` FK to collection_items with `on delete set null`.
  - Indexes:
    - partial unique `scans_one_committed_page` on `(lower(trim(binder)), page) where status = 'committed'`
    - unique `(scan_id, slot)`
    - check `slot between 1 and 9`
- [ ] **Step 4:** Run `pnpm db:generate`, then the tests. Expected: PASS. Run `pnpm test` with everything green.
- [ ] **Step 5:** Commit `feat(db): scans and scan_results tables`.

### Task 2: `packages/scan` and number parsing

**Files:**
- Create: `packages/scan/package.json` (`@poketrack/scan`, exports `./src/index.ts`, depends on `@poketrack/db` and `drizzle-orm`, has a `typecheck` script), `tsconfig.json`, `vitest.config.ts` (copy the shape from `packages/jobs`), `src/index.ts`, `src/parse.ts`
- Modify: `apps/web/package.json` (add `@poketrack/scan: workspace:*`) and `apps/web/next.config.ts` (`transpilePackages`)
- Test: `packages/scan/src/parse.test.ts`

**Interfaces:**
- Produces: `parseNumber(printed: string | null): { number: string; printedTotal: number | null } | null`

- [ ] **Step 1: Failing tests.** Table-driven with `test.each`:

| Input | Expected |
|---|---|
| `"199/165"` | `{number:"199", printedTotal:165}` |
| `"058/102"` | `{number:"58", printedTotal:102}` |
| `"TG05/TG30"` | `{number:"TG05", printedTotal:30}` |
| `"SV049/SV122"` | `{number:"SV049", printedTotal:122}` |
| `"SWSH123"` | `{number:"SWSH123", printedTotal:null}` |
| `"SVP 085"` | `{number:"SVP085", printedTotal:null}` |
| `" 4 / 102 "` | `{number:"4", printedTotal:102}` |
| `null`, `""`, `"??"`, `"/165"` | `null` |

  Letter-prefixed numbers keep their digits as printed. Only purely numeric numbers lose leading zeros. A letter-prefixed total such as `TG30` becomes 30.
- [ ] **Step 2:** Run `pnpm vitest run packages/scan`. Expected: FAIL.
- [ ] **Step 3:** Implement `parseNumber` in `parse.ts` and export it from `index.ts`.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `pnpm install` and `pnpm typecheck`, both clean.
- [ ] **Step 5:** Commit `feat(scan): package and collector number parsing`.

### Task 3: Matching

**Files:**
- Create: `packages/scan/src/match.ts`, `packages/scan/src/testing.ts` (a seed helper that inserts `sets` and `cards` rows directly into a `createTestDb()`)
- Test: `packages/scan/src/match.test.ts`

**Interfaces:**
- Consumes: `parseNumber`, `Candidate`, `SlotCues`
- Produces:
  - `type SlotRead = { name: string | null; numberAsPrinted: string | null; setCode: string | null; cues: SlotCues; confidence: number }`
  - `matchSlot(db: Db, read: SlotRead): Promise<{ candidates: Candidate[]; confidence: number }>` (at most 3 candidates, best first; `confidence` = min(vision, best score), or 0 with no candidates)
  - `proposeVariant(cues: SlotCues, cardVariants: string[], fallback: string): string`

- [ ] **Step 1: Failing tests.**

  Seed data:
  - set `sv3pt5` (ptcgo `MEW`, total 165) with `199` Charizard ex
  - set `base1` (ptcgo null, total 102) with `4` Charizard and `58` Pikachu
  - set `xy1` (total 146) and set `xy2` (total 146), each with a `12` card, named "Pidgey" and "Pidgeot"

  Tests:
  - `set code + number is an exact match at 1.0`: `{setCode:"MEW", numberAsPrinted:"199/165", confidence:0.95}` gives candidates[0] `sv3pt5-199` via `code`, confidence 0.95.
  - `set code is case-insensitive`: `"mew"` gives the same result.
  - `null set code falls through to printed total`: `{name:"Pikachu", "58/102", conf 1}` gives `base1-58` via `total` with score 0.9.
  - `shared printed total ranks by name and caps at 0.8`: `{name:"Pidgeot", "12/146"}` gives candidates[0] = the xy Pidgeot, score ≤ 0.8, and the Pidgey second.
  - `name below 0.4 similarity is not a printed-total hit`: `{name:"Mewtwo", "58/102"}` doesn't return `base1-58` via `total`.
  - `fuzzy name fallback returns at most 3 with score ≤ 0.7`: `{name:"Charizrd", numberAsPrinted:null}` gives ≤ 3 candidates, all via `name`, all ≤ 0.7, and contains `base1-4`.
  - `number boosts fuzzy name`: `{name:"Charizrd", "4"}` ranks `base1-4` first.
  - `unreadable slot has no candidates`: `{name:null, numberAsPrinted:null}` gives `{candidates:[], confidence:0}`.
  - `proposeVariant`:
    - reverse cue with `["normal","reverseHolofoil"]` gives `reverseHolofoil`
    - holo cue with `["holofoil"]` gives `holofoil`
    - holo cue on `["normal"]` falls back to `"normal"`
    - a fallback not in the variants gives `cardVariants[0]`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Rules apply in the spec's order and stop at the first that finds candidates. Rule 2 uses `similarity(c.name_search, normalizeText(name))` from pg_trgm. For rule 3, reuse the ranking idea of `searchCards` but write the query here, since `packages/scan` must not import the web app. Exact score numbers within the caps are the builder's choice.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scan): match reads to catalog cards`.

### Task 4: Vision read

**Files:**
- Create: `packages/scan/src/read.ts`, `packages/scan/src/fixtures/read-*.json` (a full page, a page with empties, malformed output)
- Modify: `packages/scan/package.json` (add `@anthropic-ai/sdk`)
- Test: `packages/scan/src/read.test.ts`

**Interfaces:**
- Produces:
  - `type PageSlot = SlotRead & { slot: number; empty: boolean; box: SlotBox | null }`
  - `type ModelClient = { create(params: MessageCreateParams): Promise<Message> }` (the SDK's `messages` object fits this shape)
  - `readPage(client: ModelClient, opts: { imageUrl: string; model: string }): Promise<PageSlot[]>` (always 9 entries, ordered by slot)
  - `normalizeSlots(raw: unknown): PageSlot[]`
  - `PROMPT_VERSION` (a string const, starting at `"p2-v1"`)
  - `ReadError extends Error`

- [ ] **Step 1: Failing tests** (with a fake `ModelClient` that returns fixtures):
  - `full page fixture yields 9 slots in order with parsed fields`
  - `empty pockets come back empty:true with no name`
  - `missing slots are filled as unreadable, not empty`: a fixture with slots 1–7 only gives slots 8 and 9 with `empty:false, name:null, confidence:0`.
  - `extra and duplicate slots: out-of-range dropped, duplicate keeps higher confidence`
  - `boxes clamp to 0–1, and confidence clamps to 0–1`
  - `retries once on a 5xx or timeout, then succeeds`: the fake throws an `APIError` with status 529 once, then returns. `create` is called twice.
  - `throws ReadError after the second failure`
  - `malformed tool output throws ReadError`
  - `request uses the image URL and forces the tool`: assert `params.model`, `tool_choice` name `report_slots`, and an image block with `source.type === "url"`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Use tool use with a single `report_slots` tool whose `input_schema` matches the spec's slot shape (`slots[]` with `slot`, `empty`, `name`, `number_as_printed`, `set_code`, `cues`, `confidence`, `box`). Pass the image by URL. The prompt follows the spec's three instructions: report exactly as printed, lower confidence for glare or angles, and mark empty pockets. The wording is the builder's choice.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scan): one-call vision read of a binder page`.

### Task 5: `runScan` pipeline

**Files:**
- Create: `packages/scan/src/run.ts`
- Test: `packages/scan/src/run.test.ts`

**Interfaces:**
- Consumes: `readPage`, `matchSlot`, `proposeVariant`, `parseNumber`, `PROMPT_VERSION`
- Produces:
  - `type NewScan = { imageUrl: string; width: number; height: number; binder: string; page: number }`
  - `runScan(db: Db, client: ModelClient, input: NewScan, opts: { model: string; defaultVariant: (cardVariants: string[]) => Promise<string> }): Promise<{ scanId: number; status: "ready" | "failed" }>`

- [ ] **Step 1: Failing tests:**
  - `creates scan as reading, then ready with 9 results`: assert the scan row has model and prompt version, there are 9 `scan_results`, `read_*` fields are stored, `read_number`/`read_printed_total` are parsed, and `candidates` and `box` are stored.
  - `pre-confirms at ≥ 0.9 with chosen card and proposed variant`: decision `confirmed`, `chosenCardId` = candidates[0], and the variant comes from `proposeVariant`.
  - `below 0.9 stays pending with chosen = top candidate or null`
  - `empty pockets have no decision to make`: decision `rejected` is not used. `empty` is true and decision stays `pending` (the review screen skips empties).
  - `condition defaults to NM`
  - `ReadError marks scan failed with the error text and writes no results`
  - `binder is trimmed and validated`: `""` or a page < 1 throws `ValidationError` from `@poketrack/scan`, and no row is written.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Insert the scan first with `status:"reading"`, then call the model outside any transaction, then write results and `status:"ready"` in one transaction. Export `ValidationError`, or reuse the web one by moving `errors.ts` into `@poketrack/db`. The builder chooses; keep a single class.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(scan): runScan pipeline`.

### Task 6: Passcode access

**Files:**
- Create: `apps/web/lib/session.ts`, `apps/web/proxy.ts` (or whatever the Next 16 docs name the interceptor), `apps/web/app/login/page.tsx`, `apps/web/app/login/actions.ts`
- Modify: `.env.example`
- Test: `apps/web/lib/session.test.ts`, `apps/web/proxy.test.ts`

**Interfaces:**
- Produces:
  - `SESSION_COOKIE = "pt_session"`
  - `signSession(nowMs: number, env: { passcode: string; secret: string }): Promise<string>`
  - `verifySession(token: string | undefined, nowMs: number, env): Promise<boolean>`
  - `loginAction(formData: FormData)`

- [ ] **Step 1: Failing tests:**
  - `session.test`:
    - signed tokens verify
    - expire after 90 days (`nowMs + 90d + 1` fails)
    - a tampered token fails
    - a token signed under an old passcode fails after the passcode changes (HMAC over expiry + passcode, keyed by secret, using Web Crypto so it runs in the interceptor)
  - `proxy.test`:
    - `/` without a cookie redirects to `/login?next=/`
    - `/login` passes
    - `/api/cron/nightly` passes
    - `/` with a valid cookie passes
    - `/api/scans` without a cookie returns 401 instead of redirecting
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. `loginAction` compares in constant time, then sets an httpOnly, secure, sameSite=lax cookie with a 90-day maxAge and redirects to `next`. A wrong passcode returns "That passcode isn't right." The login page is one password field and a button.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Add `APP_PASSCODE` and `SESSION_SECRET` with comments to `.env.example`. Commit `feat(web): shared passcode access`.

### Task 7: Capture page, upload and `POST /api/scans`

**Files:**
- Create:
  - `apps/web/app/api/blob/upload/route.ts` (`handleUpload` from `@vercel/blob/client`; `onBeforeGenerateToken` allows only `image/jpeg` up to 10 MB)
  - `apps/web/app/api/scans/route.ts`
  - `apps/web/lib/model.ts` (`getModelClient()`, `getModelName()`: `ANTHROPIC_MODEL` with fallback `claude-sonnet-5-5` **(builder default)**)
  - `apps/web/lib/binders.ts`
  - `apps/web/lib/prepare-image.ts`
  - `apps/web/app/scan/page.tsx`
  - `apps/web/components/scan/capture-form.tsx`
- Modify: `apps/web/package.json` (`@vercel/blob`, `@anthropic-ai/sdk`), `.env.example`
- Test: `apps/web/app/api/scans/route.test.ts`, `apps/web/lib/binders.test.ts`, `apps/web/lib/prepare-image.test.ts`, `apps/web/components/scan/capture-form.test.tsx`

**Interfaces:**
- Consumes: `runScan`, `defaultVariant` (Phase 1, `lib/collection.ts`)
- Produces:
  - `listBinders(db: Db): Promise<string[]>`: distinct trimmed names from `scans` then `collection_items`, de-duplicated case-insensitively, keeping the first spelling seen.
  - `lastPage(db: Db, binder: string): Promise<number | null>`
  - `committedScanFor(db: Db, binder: string, page: number): Promise<{ id: number; committedAt: string; cards: number } | null>`
  - `prepareImage(file: Blob, deps?: { decode?: (b: Blob) => Promise<ImageBitmap> }): Promise<{ blob: Blob; width: number; height: number }>`: long edge ≤ 2000, JPEG; throws `UnreadableImageError` when decoding fails.
  - `POST /api/scans` body: `{ imageUrl, width, height, binder, page }`. Returns `{ scanId }` (201) or `{ field, message }` (400) or `{ message }` (502 when the scan failed, with `scanId`).

- [ ] **Step 1: Failing tests:**
  - `binders.test`:
    - `listBinders` merges `"Main"` and `" main"` into one and orders scans' names first
    - `lastPage` returns the max page for the binder, case-insensitive
    - `committedScanFor` returns the committed scan with its confirmed-pocket count
  - `prepare-image.test` (inject `decode` to return a fake bitmap; stub `OffscreenCanvas` or document canvas in jsdom):
    - a 4000×3000 input becomes 2000×1500
    - a 1200×900 input stays 1200×900
    - `decode` is called with `imageOrientation: "from-image"`
    - a decode rejection throws `UnreadableImageError`
  - `route.test` (mock `runScan` and `getModelClient`):
    - a valid body calls `runScan` with the trimmed binder and returns 201 `{scanId}`
    - `page: 0` returns 400 `{field:"page"}`
    - an `imageUrl` not on the Blob host (`*.public.blob.vercel-storage.com`) returns 400
    - a failed run returns 502 with a message and the `scanId`
    - the route module exports `maxDuration === 60`
  - `capture-form.test`:
    - binder defaults to the last-used value passed as a prop
    - page defaults to last page + 1
    - a "Replaces the scan from …" notice shows when `existing` is passed
    - when `prepareImage` throws, the message is "Couldn't read that photo, try again"
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `scan/page.tsx` is a server component that loads binders, the last page and any existing committed scan.
  - The form uses a ui-sdk Combobox for the binder (allowing a new value), a number field, and `<input type="file" accept="image/*" capture="environment">`.
  - On submit: `prepareImage` → `upload()` from `@vercel/blob/client` → `fetch POST /api/scans` → `router.push(/scans/${scanId})`.
  - Show the spinner text "Reading 9 pockets…". On a 502, offer "Try again", which resubmits the same `imageUrl`.
  - When the binder or page changes, look up `committedScanFor` through a small GET route or a server action.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` and `BLOB_READ_WRITE_TOKEN` to `.env.example`. Commit `feat(web): capture and run a scan`.

### Task 8: Review data and per-pocket actions

**Files:**
- Create: `apps/web/lib/scan-review.ts`, `apps/web/app/scans/[id]/actions.ts`
- Test: `apps/web/lib/scan-review.test.ts`, `apps/web/app/scans/[id]/actions.test.ts`

**Interfaces:**
- Produces:
  - `type ReviewSlot = { id: number; slot: number; empty: boolean; read: { name; number; printedTotal; setCode; cues }; confidence: number; box: SlotBox | null; candidates: (Candidate & CardHit)[]; chosen: CardHit | null; variant: string | null; condition: Condition; decision: Decision; claimManual: boolean; manualLot: { id: number; available: number } | null; otherPages: { binder: string; page: number }[]; firstEditionNote: boolean }`
  - `type RescanDiff = { replaces: { scanId: number; committedAt: string } ; added: CardHit[]; removed: CardHit[]; unchanged: number } | null`
  - `loadReview(db: Db, scanId: number): Promise<{ scan: { id; binder; page; status; imageUrl; width; height }; slots: ReviewSlot[]; diff: RescanDiff; canCommit: boolean }>`
  - `updateSlotAction(resultId: number, patch: { chosenCardId?: string | null; variant?: string; condition?: Condition; decision?: Decision; claimManual?: boolean }): Promise<ActionResult>`

- [ ] **Step 1: Failing tests:**
  - `scan-review.test`:
    - `manualLot.available` = the binder-less lot's quantity minus the other pockets **in this scan** that already claim it. With two Pikachu pockets and a manual lot of quantity 1: the first claimed shows available 0 on the second, and the second shows `manualLot` with available 0, so the UI hides the toggle.
    - `claimManual defaults on when available > 0`: `loadReview` reports `claimManual` as stored, and Task 5's write sets it true when a binder-less lot with the same card and variant exists. **Add this assertion to Task 5's tests and make `runScan` set it.**
    - `otherPages` lists the committed pages (excluding this one) whose confirmed pockets hold the same card
    - `diff` against the previous committed scan of the same page counts cards by chosen card: Charizard + Pikachu → Pikachu + Mew gives added [Mew], removed [Charizard], unchanged 1. It is null when there is no previous scan.
    - `canCommit` is false while any non-empty pocket is pending, and false for `committed` and `superseded` scans
    - `firstEditionNote` is true when `read_cues.firstEdition` is set
  - `actions.test`:
    - choosing a card resets variant to `proposeVariant` for the new card
    - a variant not in the chosen card's variants fails with `{field:"variant"}`
    - patches on a committed scan fail with `{field:"scan", message:"This scan was already added."}`
    - confirming with no chosen card fails with `{field:"chosenCardId"}`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. Each action calls `revalidatePath("/scans/[id]")` for that id.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): scan review data and pocket actions`.

### Task 9: Commit a scan (rescan and claim)

**Files:**
- Create: `apps/web/lib/scan-commit.ts`
- Modify: `apps/web/app/scans/[id]/actions.ts` (add `commitScanAction`), and `apps/web/lib/collection.ts` (only to export a `decrementLot(db, id)` helper if one isn't there)
- Test: `apps/web/lib/scan-commit.test.ts`

**Interfaces:**
- Consumes: `addItem` (Phase 1), `loadReview().canCommit`
- Produces:
  - `commitScan(db: Db, scanId: number): Promise<{ added: number; replaced: boolean }>`
  - `commitScanAction(scanId: number)`: on success, runs Phase 1's `priceIfMissing` per distinct card, then redirects to `/?scanned=<scanId>`.

- [ ] **Step 1: Failing tests** (PGlite, seeded catalog):
  - `first commit adds one copy per confirmed pocket with source scan and the scan's binder`, and `collection_item_id` is written for each.
  - `two pockets of the same card merge into quantity 2`
  - `claim moves the manual copy`: a manual lot (binder null, quantity 1, `paid_usd` 3.00) is deleted, the new Main lot has quantity 1 and `paid_usd` 3.00, and `claimed_from_item_id` is set.
  - `claim with manual quantity 2 leaves 1 behind`
  - `rescan with identical cards leaves every quantity unchanged`, and the old scan is `superseded`.
  - `rescan that drops a card removes one copy and deletes the lot at 0`
  - `card moved from page 2 to page 3 nets out`: commit p2 [X], then commit p3 [X], then rescan p2 [] gives X quantity 1.
  - `claimed copy is not restored`: claim a manual X on p3, then rescan p3 without X. No binder-less X comes back.
  - `hand-lowered lot clamps at 0`: after commit, set quantity to 0 or delete the row by hand, then rescan. No throw, no negative count.
  - `rejected and empty pockets add nothing`
  - `second commit of the same scan throws "This scan was already added."`
  - `commit with a pending pocket throws`
  - `racing commits`: two `ready` scans for Main p3 committed via `Promise.allSettled`. Exactly one fulfils, the other rejects, and the quantities match a single commit.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the spec's Commit steps 1–3 in one `db.transaction`.
  - Lock with `select … for update` on the page's current committed scan. The partial unique index is the backstop for the race when there's no previous scan.
  - `addItem` takes `Db`, so pass the transaction cast as `Db`. Decrement and delete stay inside the same transaction.
  - Move `paid_usd` only when the target lot's `paid_usd` is null.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): commit scans as the record of a page`.

### Task 10: Review grid UI

**Files:**
- Create: `apps/web/app/scans/[id]/page.tsx`, `apps/web/components/scan/review-grid.tsx`, `apps/web/components/scan/pocket.tsx`, `apps/web/components/scan/crop.tsx`
- Test: `apps/web/components/scan/review-grid.test.tsx`, `apps/web/components/scan/crop.test.tsx`

**Interfaces:**
- Consumes: `loadReview`, `updateSlotAction`, `commitScanAction`, `/api/cards/search`, the existing `components/ui/select.tsx`, and the add-card Combobox pattern
- Produces: `<ReviewGrid review={…} />` and `<Crop imageUrl width height box />`

- [ ] **Step 1: Failing tests:**
  - `crop.test`: box `{x:0.5,y:0.25,w:0.25,h:0.25}` renders an `img` whose style scales the photo 4× and offsets it to −200%/−100% (assert the computed `transform`, or `object-position` with `width`). A null box shows the whole photo.
  - `review-grid.test`:
    - header text "7 matched · 1 check · 1 empty" for a fixture review
    - empty pockets show "(empty)" and aren't focusable stops for Enter or X
    - a pending pocket shows a Combobox seeded with its candidates
    - ArrowRight moves focus slot 1 → 2, and ArrowDown moves 1 → 4
    - Enter on a focused pending pocket with a chosen card calls `updateSlotAction(id, {decision:"confirmed"})`
    - X calls it with `{decision:"rejected"}`
    - the "Typed in earlier, use that copy" toggle shows only when `manualLot.available > 0` or `claimManual` is already on
    - a "1st edition?" note shows when `firstEditionNote`
    - the button reads "Add 8 cards", or "Replace page" when `diff` is non-null, and is disabled when `canCommit` is false
    - the diff line reads "+1 new, −1 removed, 1 unchanged" and lists the removed card names
    - committed scans render read-only (no buttons)
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Use ui-sdk list and selection behaviors for grid focus.
  - Each pocket shows the crop, the catalog `image_small`, the name, the set and number, and variant and condition Selects.
  - On a narrow viewport, tapping a pocket opens it in the existing `modal.tsx` at full width.
  - Changes call the action optimistically and roll back on `{ok:false}`, showing its message.
- [ ] **Step 4:** Run the tests. Expected: PASS. Run `pnpm --filter web build` with no errors.
- [ ] **Step 5:** Commit `feat(web): scan review grid`.

### Task 11: Scan history, accuracy and entry points

**Files:**
- Create: `apps/web/lib/scan-history.ts`, `apps/web/app/scans/page.tsx`
- Modify:
  - `apps/web/components/collection/total-header.tsx` (add a "Scan a page" link to `/scan`)
  - `apps/web/app/page.tsx` (show "Added N cards from {binder} · page {page}" when `?scanned=` is set)
  - the layout nav, if there is one
- Test: `apps/web/lib/scan-history.test.ts`, `apps/web/components/collection/total-header.test.tsx`

**Interfaces:**
- Produces:
  - `listScanHistory(db): Promise<{ binder: string; page: number; current: ScanSummary | null; older: ScanSummary[] }[]>`, where `ScanSummary = { id; status; createdAt; cards: number }`
  - `scanAccuracy(db): Promise<{ firstGuessRight: number; nonEmpty: number }>`

- [ ] **Step 1: Failing tests:**
  - groups by case-insensitive binder and page; the current entry is the committed scan; superseded scans are listed under `older`, newest first; failed or ready scans with no committed sibling show as `current: null` plus `older`
  - accuracy counts over committed scans only:
    - `firstGuessRight` = confirmed pockets where `chosen_card_id = candidates[0].cardId`
    - `nonEmpty` = all non-empty pockets
    - example: 9 pockets with 1 empty, 6 right, 1 swapped, 1 rejected gives 6/8
  - the total header renders a link named "Scan a page" to `/scan`
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement. The `/scans` page shows the accuracy line as "First guess right: 6 of 8 pockets (75%)".
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(web): scan history and accuracy`.

### Task 12: Runbook and the real-photo check

**Files:**
- Modify: `README.md` (or the Phase 1 runbook section)

- [ ] **Step 1:** Document the setup:
  - create a Vercel Blob store and connect it to the project (this sets `BLOB_READ_WRITE_TOKEN`)
  - set `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `APP_PASSCODE` and `SESSION_SECRET` for Production and Preview
  - run `pnpm db:migrate` against main
  - deploy, then turn off Deployment Protection for Production (Preview can keep it)
- [ ] **Step 2:** Document the real-photo check:
  - scan 3 real pages, including one with holos in sleeves
  - each page must need 2 or fewer corrections
  - record the `/scans` accuracy line in the README
  - if it misses, see the spec's Later section (close-up second pass)
- [ ] **Step 3:** Run `pnpm test` and `pnpm typecheck`, both green. Commit `docs: Phase 2 runbook`.
