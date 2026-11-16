# Poketrack Binder View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/binders` screen that shows one binder page at a time with each card in its real pocket, searches owned cards across binders, and opens a card panel whose edits change only the card in that pocket.

**Architecture:** Read-side queries in `apps/web/lib/binder-view.ts` build pages from committed scans (`scan_results` → lots). Write-side transactions in `apps/web/lib/pocket-edit.ts` move or remove one pocket's copy, or only a lot's surplus copies, and keep `scan_results.collection_item_id` pointing at the lot that holds each pocket's copy. A new `scan_results.removed_at` column marks pockets emptied in the app. `packages/scan` gains a carry-over step so rescans keep pocket edits. The UI is a server page driven by URL params (`b`, `p`, `card`, `hl`) with client components for the grid, pager, search and panel.

**Tech Stack:** pnpm workspace, Next.js 16 App Router, React 19, ui-sdk `0.1.0-beta.1`, Drizzle + Postgres (PGlite with pg_trgm in tests), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-16-poketrack-binder-view-design.md`. It builds on the Phase 1 and Phase 2 specs in the same folder. Read the binder view spec in full.

## Global Constraints

- `@ui-sdk/react` and `@ui-sdk/core` stay pinned at exactly `0.1.0-beta.1`, public entry points only. No new runtime dependencies (no chart, swipe or gesture libraries).
- Cross-platform scripts only (Windows dev machine).
- `apps/web/AGENTS.md`: read the matching guide in `apps/web/node_modules/next/dist/docs/` before writing server actions, `searchParams` handling or `useRouter` navigation.
- Binder names match case-insensitively after trimming (`lower(trim(binder))`), as in `lib/binders.ts`.
- Lots are unique per (card, variant, condition, `coalesce(binder,'')`). Use `addItem` to add copies so merges follow the existing rule.
- Conditions: `NM, LP, MP, HP, DMG`. Variants are limited to the card's `cards.variants`.
- Pocket edits lock the page with `pg_advisory_xact_lock(hashtext(lower(trim(binder))), page)`, the same lock `commitScan` takes.
- Price history window: last `90` days of `price_snapshots.market_usd` for the card and variant.
- Search debounce about `250` ms. Search needs at least 2 characters of name or a number, like `searchCards`.
- URL params: `b` binder, `p` page, `card` = `r<scan_results.id>` (pocket mode) or `l<collection_items.id>` (group mode), `hl` highlighted slot. Page flips use `router.replace`; opening the panel and search jumps use `router.push`; closing the panel uses `router.replace` without `card`.
- Copy (exact): "Page {n} of {total}", "Scan this page", "Not on a page yet", "Not in your collection", "Wrong card? Rescan this page", "Remove this {name} from page {n}?", "Applies to all {n} copies in {binder}" (n = 2 reads "both copies"), "That pocket changed. Reload the page.", "No price yet".
- Commits end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01ECDx5Qx13N9K2BN5oXu9LE
  ```

## Review Focus

1. **Binder name typed differently in the URL** (`?b=main` or `?b=Main%20` for "Main"). Expected: the binder opens under its stored name. Pinned in Task 1 (`loadBinderPage` test "matches binder names case-insensitively").
2. **Stale panel**: the pocket was rescanned, removed or edited in another tab after the page loaded. Expected: the action returns "That pocket changed. Reload the page." and changes nothing; a double-click on Remove takes only one copy. Pinned in Task 3.
3. **Bad page params** (`p=0`, `p=99`, `p=abc`, unknown `b`). Expected: page is clamped to 1..pageCount; unknown binder falls back to the latest binder. Pinned in Task 6 (`parseBinderParams`).
4. **Card with no image** (`image_small` null). Expected: the pocket shows the name and number on a plain tile, and the panel falls back the same way. Pinned in Task 6 and Task 8.
5. **Odd search input** (one letter, `%`, `_`, only spaces). Expected: no results and no error. Pinned in Task 2.

---

### Task 1: `removed_at` column and page queries

**Files:**
- Modify: `packages/db/src/schema.ts` (scan_results), generate migration `packages/db/drizzle/0003_*.sql` with `pnpm db:generate`
- Create: `apps/web/lib/binder-view.ts`
- Test: `apps/web/lib/binder-view.test.ts`
- Modify: `apps/web/lib/scan-fixtures.ts` (add `commitPage` helper)

**Interfaces:**
- Produces:
  ```ts
  type PocketState = "card" | "empty" | "missing"
  type PocketView = {
    slot: number; state: PocketState; resultId: number | null; lotId: number | null
    cardId: string | null; name: string | null; setName: string | null; number: string | null; printedTotal: number | null
    imageSmall: string | null; variant: string | null; condition: Condition | null; marketCents: number | null
  }
  type BinderPage = { binder: string; page: number; pageCount: number; scanId: number | null; pockets: PocketView[]; valueCents: number; unpricedCount: number }
  type UnplacedLot = { lotId: number; cardId: string; name: string; setName: string; number: string; printedTotal: number; imageSmall: string | null; variant: string; condition: Condition; surplus: number; marketCents: number | null }
  function resolveBinder(db: Db, name: string): Promise<string | null>          // stored spelling, or null
  function loadBinderPage(db: Db, binder: string, page: number): Promise<BinderPage | null>
  function loadUnplaced(db: Db, binder: string): Promise<UnplacedLot[]>
  function pocketCounts(db: Db, lotIds: number[]): Promise<Map<number, number>> // live pockets pointing at each lot
  ```
  `scanResults.removedAt: timestamp("removed_at", { withTimezone: true })`, nullable.
  Fixture: `commitPage(db, opts: Parameters<typeof seedScan>[1]): Promise<{ scanId: number; resultIds: number[] }>` = `seedScan` + `commitScan`.

Definitions the tests pin:
- A **live pocket** is a `scan_results` row of a `committed` scan with `decision = 'confirmed'`, `empty = false`, `removed_at is null`.
- **Presence:** for each lot, its live pockets are ordered by page, then slot; the first `quantity` are `card`, the rest are `missing`. A live pocket whose `collection_item_id` is null is `missing`.
- `empty`: empty, rejected or removed pockets, and slots with no row. `pockets` always has 9 entries when `scanId` is set, and is `[]` for an unscanned page.
- `pageCount` = max committed page of the binder. A page from 1 to pageCount with no committed scan returns `{ scanId: null, pockets: [] }`; a page outside that range, or an unknown binder, returns `null`.
- `valueCents` sums `marketCents` of `card` pockets; `unpricedCount` counts `card` pockets with no price. Price = latest `price_snapshots.market_usd` for card and variant (same rule as `snapshotCents(0)` in `lib/collection.ts`).
- `surplus` = quantity − live pockets pointing at the lot, shown only when > 0. Lots in the binder with no pockets have surplus = quantity.

- [ ] **Step 1: Add the column and generate the migration.** Run `pnpm db:generate`. Expected: a new `0003_*.sql` containing `ALTER TABLE "scan_results" ADD COLUMN "removed_at" timestamp with time zone;`.
- [ ] **Step 2: Write failing tests in `binder-view.test.ts`:**
  - "a committed page shows nine pockets in slot order" — `commitPage` with pockets `[sv3pt5-199, empty, base1-58]` → states `["card","empty","card","empty",…]` (9 entries), names match.
  - "rejected and removed pockets show empty" — set one pocket `decision: "rejected"` before commit, set `removedAt` on another after → both `empty`.
  - "a lot with fewer copies than pockets marks the later pockets missing" — two `base1-58` pockets on page 3 and one on page 1 of Main; set lot quantity to 2 → page 1 slot and page 3 first slot `card`, page 3 second slot `missing`.
  - "a deleted lot leaves its pocket missing" — delete the lot → pocket `missing`, `lotId: null`.
  - "pageCount is the highest committed page and gaps are unscanned" — commits on pages 1 and 3 → `loadBinderPage(db,"Main",2)` returns `{ scanId: null, pockets: [], pageCount: 3 }`; page 4 returns `null`.
  - "page value counts only present, priced cards" — prices for two cards, one missing pocket, one unpriced → exact `valueCents` and `unpricedCount: 1`.
  - "matches binder names case-insensitively" — committed under "Main"; `resolveBinder(db, " main ")` → `"Main"`; unknown → `null`.
  - "unplaced lists surplus copies and pocketless lots" — `addItem` 2× base1-58 into "Main" by hand plus one pocket of it → surplus 2; a pocketless lot appears with its full quantity; lots in other binders don't appear.
- [ ] **Step 3: Run** `pnpm vitest run apps/web/lib/binder-view.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 4: Implement** the column, the fixture and `binder-view.ts`. Use raw `sql` queries like `lib/binders.ts`; do presence in TypeScript after loading the binder's live pockets with `row_number() over (partition by collection_item_id order by page, slot)` or an equivalent sort.
- [ ] **Step 5: Run** the test file, then `pnpm test`. Expected: all PASS (existing scan tests unaffected by the nullable column).
- [ ] **Step 6: Commit** `feat(db,web): removed_at on pockets and binder page queries`.

### Task 2: Owned search and card detail

**Files:**
- Modify: `apps/web/lib/collection.ts` (export `parseQuery` and `escapeLike`)
- Modify: `apps/web/lib/binder-view.ts`
- Test: `apps/web/lib/binder-view.test.ts`

**Interfaces:**
- Consumes: Task 1 presence and `pocketCounts`.
- Produces:
  ```ts
  type Where =
    | { kind: "pocket"; binder: string; page: number; slot: number; resultId: number }
    | { kind: "unplaced"; binder: string; lotId: number }
    | { kind: "loose"; lotId: number }                       // lot with no binder
  type OwnedHit = { cardId: string; name: string; setName: string; number: string; printedTotal: number; imageSmall: string | null; variant: string; condition: Condition; where: Where }
  type CardRef = { resultId: number } | { lotId: number }
  type CardDetail = {
    mode: "pocket" | "group"; resultId: number | null; lotId: number | null
    cardId: string; name: string; setName: string; number: string; printedTotal: number; rarity: string | null
    imageLarge: string | null; imageSmall: string | null; cardVariants: string[]; variant: string; condition: Condition
    lot: { quantity: number; pocketed: number; surplus: number; paidCents: number | null; acquiredOn: string | null; binder: string | null } | null
    price: { marketCents: number | null; previousCents: number | null; history: { date: string; cents: number }[] }
    places: { where: Where; thisOne: boolean }[]
    scanLink: { binder: string; page: number } | null       // for "Wrong card? Rescan this page"
  }
  function searchOwned(db: Db, q: string, limit?: number): Promise<OwnedHit[]>   // default limit 20
  function loadCardDetail(db: Db, ref: CardRef): Promise<CardDetail | null>
  ```
  `parseQuery(q: string): { name: string; number: string | null }` and `escapeLike(text: string): string` exported unchanged.

Ordering: hits for the same card list pockets by binder, page, slot, then unplaced, then loose. Only `card`-state pockets are pocket hits. `places` lists every live, present pocket and every surplus/loose lot of the same card (any variant), with `thisOne` set on the opened ref. `history` is ascending by date within 90 days of the newest snapshot. Pocket mode on a `missing` pocket returns detail with `lot: null`.

- [ ] **Step 1: Write failing tests:**
  - "search finds owned cards by name, number and both" — "char", "199", "charizard 199/165" each return the Main page-3 pocket hit with `where.kind === "pocket"`, slot and resultId.
  - "search covers every binder, unplaced and loose lots, and ignores unowned cards" — Mew ex not owned → no hit; pocket in "Trade", surplus in "Main", binder-less lot all returned in that order.
  - "odd search input returns nothing" — `"c"`, `"%"`, `"_"`, `"   "` → `[]`, no throw.
  - "detail for a pocket" — mode `pocket`, lot `{ quantity: 2, pocketed: 2, surplus: 0 }` for a two-pocket lot, `places` has two pocket entries with `thisOne` on the opened one, `scanLink` = `{ binder: "Main", page: 3 }`.
  - "detail for a lot has group mode and surplus" — hand-added 3, one pocket → `surplus: 2`, `scanLink: null`.
  - "price history is the last 90 days ascending" — snapshots at day 0, 30, 100 back from newest → two points; `previousCents` is the second-newest.
  - "unknown refs return null".
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement** both functions; reuse `parseQuery` for the name/number split and filter to cards present in `collection_items`.
- [ ] **Step 4: Run** the test file and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): search owned cards and load card detail`.

### Task 3: Pocket edits

**Files:**
- Create: `apps/web/lib/pocket-edit.ts`
- Test: `apps/web/lib/pocket-edit.test.ts`

**Interfaces:**
- Consumes: `addItem` (`lib/collection.ts`), `commitScan`, `commitPage` fixture.
- Produces:
  ```ts
  function movePocketCopy(db: Db, resultId: number, to: { variant: string; condition: Condition }): Promise<{ lotId: number }>
  function removePocketCopy(db: Db, resultId: number): Promise<void>
  function setLotDetails(db: Db, lotId: number, d: { paidCents: number | null; acquiredOn: string | null }): Promise<void>
  ```

Rules (spec, "Pocket mode"): one transaction; take the page lock; re-read the pocket inside it and throw `ValidationError("pocket", "That pocket changed. Reload the page.")` unless it is a live pocket of a committed scan. Move: if `to` equals the current lot's variant and condition, no-op. Otherwise lower the old lot by 1 (delete at 0), `addItem` one copy in the scan's binder, copy the old lot's `paidUsd` and `acquiredOn` onto the target lot only when it was just created, set the pocket's `collectionItemId`, `variant`, `condition`. Validate `to.variant ∈ cards.variants` and condition like `checkLot`. Remove: if the pocket is `present`, lower its lot by 1 (delete at 0); set `collectionItemId = null`, `removedAt = now()` either way. `setLotDetails` reuses `updateItem`'s paid/date validation (extract `checkPaid` and `checkAcquiredOn` helpers in `lib/collection.ts` if needed).

- [ ] **Step 1: Write failing tests:**
  - "changing condition on a ×2 lot splits off only this pocket's copy" — two base1-58 pockets → move slot 1 to LP: lots `[{NM,1},{LP,1}]`; slot 1 points at LP lot with `condition: "LP"`; slot 2 unchanged.
  - "moving into an existing lot merges" and "moving back merges back and deletes the emptied lot".
  - "a new lot inherits paid price and acquired date".
  - "a variant the card doesn't have is rejected" — `ValidationError` field `variant`.
  - "remove takes one copy and empties the pocket" — lot 2 → 1; pocket `collectionItemId: null`, `removedAt` set; `loadBinderPage` shows `empty`.
  - "remove on a missing pocket only marks it removed" — lot already at quantity matching other pockets; quantities unchanged.
  - "stale pocket is refused" — remove twice → second throws "That pocket changed. Reload the page.", lot lowered once; a pocket of a superseded scan → same error.
  - "rescan after a condition edit leaves counts correct" — edit slot 1 to LP, rescan page with same two cards (fresh `seedScan` + `commitScan`, conditions NM) → total quantity 2, no lot at ≤0.
  - "rescan after a remove leaves counts correct" — remove slot 1, rescan with both cards → quantity 2.
  - "setLotDetails validates and saves" — negative paid → `paidCents` error; future date → `acquiredOn` error; valid saves.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/lib/pocket-edit.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `pocket-edit.ts`.
- [ ] **Step 4: Run** the file and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): edit or remove one pocket's copy`.

### Task 4: Surplus edits (group mode)

**Files:**
- Modify: `apps/web/lib/pocket-edit.ts`
- Test: `apps/web/lib/pocket-edit.test.ts`

**Interfaces:**
- Consumes: `pocketCounts` (Task 1), `addItem`.
- Produces:
  ```ts
  type SurplusInput = { variant: string; condition: Condition; quantity: number; binder: string | null } // quantity = new surplus, 0..999
  function editSurplus(db: Db, lotId: number, input: SurplusInput): Promise<void>
  function removeSurplus(db: Db, lotId: number): Promise<void>
  ```

Rules (spec, "Group mode"): `pocketed` = live pockets pointing at the lot. If variant, condition and binder (trimmed, null for blank) are unchanged, set quantity = pocketed + input.quantity (delete when 0). Otherwise set the lot to `pocketed` (delete when 0) and, when input.quantity > 0, `addItem` input.quantity copies into the target lot, carrying paid price and date onto a newly created lot. Pockets and their `scan_results` never change. `removeSurplus` = `editSurplus` with quantity 0 and the lot's own key. Lot gone → `ValidationError("lot", "That card is no longer in your collection.")`.

- [ ] **Step 1: Write failing tests:**
  - "quantity edits change only the surplus" — lot 3 with 1 pocket; surplus → 5 gives lot 6; surplus → 0 gives lot 1.
  - "changing condition moves only the surplus" — lot NM 3 with 1 pocket → condition LP, quantity 2: NM lot 1 (pocket still points at it), LP lot 2.
  - "changing binder moves the surplus into another binder's lot".
  - "a pocketless lot behaves like a normal edit" — lot 2, no pockets, quantity 0 → deleted; condition change → lot moved (merging if one exists).
  - "removeSurplus never touches pocketed copies".
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): group edits touch only unpocketed copies`.

### Task 5: Rescans carry pocket edits over

**Files:**
- Create: `packages/scan/src/carry.ts`
- Modify: `packages/scan/src/run.ts` (after `claimDefaults`, before insert)
- Test: `packages/scan/src/carry.test.ts`, `packages/scan/src/run.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type CarryRow = { slot: number; chosenCardId: string | null; empty: boolean }
  function carryOver(db: Db, page: { binder: string; page: number }, rows: CarryRow[]): Promise<({ variant: string; condition: Condition } | null)[]>
  ```
  Returns, per row, the variant and condition of the same slot in the page's current committed scan when that slot is a live pocket (confirmed, not empty, not removed) with the same `chosenCardId`; else `null`. In `runScan`, a non-null carry overrides both the proposed variant and the claim condition.

- [ ] **Step 1: Write failing tests** in `carry.test.ts`: "same card in the same slot carries variant and condition"; "different card, empty slot, removed pocket or no committed scan gives null"; "binder matches case-insensitively". In `run.test.ts`: "a rescan starts edited pockets with their edited condition" — committed page with slot 2 Pikachu set to LP; `runScan` same page reading Pikachu in slot 2 → result `condition: "LP"`.
- [ ] **Step 2: Run** `pnpm vitest run packages/scan`. Expected: FAIL.
- [ ] **Step 3: Implement** `carry.ts` and wire it in `run.ts`.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(scan): rescans keep pocket variant and condition`.

### Task 6: `/binders` page, grid, pager and nav

**Files:**
- Create: `apps/web/app/binders/page.tsx`, `apps/web/app/binders/actions.ts`, `apps/web/lib/binder-params.ts`
- Create: `apps/web/components/binder/page-grid.tsx`, `pager.tsx`, `binder-picker.tsx`, `unplaced-strip.tsx`
- Modify: `apps/web/app/layout.tsx` (nav link "Binders" between Collection and Scans), `apps/web/app/scan/page.tsx` and `components/scan/capture-form.tsx` (prefill from `?binder=&page=`)
- Test: `apps/web/lib/binder-params.test.ts`, `apps/web/components/binder/page-grid.test.tsx`, `pager.test.tsx`, `apps/web/components/scan/capture-form.test.tsx`

**Interfaces:**
- Consumes: Task 1 queries; `listBinders`, `latestBinder`.
- Produces:
  ```ts
  type BinderParams = { binder: string | null; page: number; card: CardRef | null; hl: number | null }
  function parseBinderParams(raw: Record<string, string | string[] | undefined>, pageCount: (binder: string) => number): BinderParams
  function binderHref(p: { binder: string; page: number; card?: CardRef | null; hl?: number | null }): string  // "/binders?b=Main&p=3&card=r12&hl=2"
  // components (client)
  PageGrid(props: { page: BinderPage; highlightSlot: number | null; onOpen: (ref: CardRef) => void })
  Pager(props: { binder: string; page: number; pageCount: number })
  BinderPicker(props: { binders: string[]; current: string })
  UnplacedStrip(props: { lots: UnplacedLot[]; highlightLotId: number | null; onOpen: (ref: CardRef) => void })
  CaptureForm: new optional prop `initialPage?: number`
  ```
  Server actions in `app/binders/actions.ts` (all `"use server"`, return `ActionResult` like `app/actions.ts`, map `ValidationError` to `{ ok: false, field, message }`, and `revalidatePath("/binders")` + `revalidatePath("/")` after writes): `movePocketAction(resultId, to)`, `removePocketAction(resultId)`, `setLotDetailsAction(lotId, d)`, `editSurplusAction(lotId, input)`, `removeSurplusAction(lotId)`, `searchOwnedAction(q): Promise<OwnedHit[]>`.

Page behavior: resolve `b` with `resolveBinder`, else `latestBinder`, else the first `listBinders`, else an empty state with a "Scan a page" link to `/scan`. Page clamped to 1..pageCount. Unscanned page renders 9 dashed pockets and a "Scan this page" link to `/scan?binder=<b>&page=<p>`. Under the grid: "Page {n} of {total}" and the value via `lib/money` formatting, with "{n} unpriced" when > 0. `UnplacedStrip` renders under the last page only, titled "Not on a page yet", tiles show "×n" when surplus > 1. When `card` is set, the page loads `loadCardDetail` and renders the panel from Task 8 (leave a placeholder slot in this task).

Pocket buttons: `aria-label` "Pocket {slot}: {name}, {number}/{printedTotal}" for cards, "Pocket {slot}: empty", "Pocket {slot}: {name}, not in your collection" for missing (rendered dimmed, still opens the panel). With `highlightSlot`, that pocket gets `data-highlight` and the others `data-dimmed`. No image → name and number on a plain tile.

Pager: previous/next buttons (`aria-label` "Previous page"/"Next page"; they stay enabled and do nothing at the first and last page), clickable dots (`aria-label` "Page {n}", `aria-current="page"` on the current one), ArrowLeft/ArrowRight on the document when no input is focused, and pointer swipe on the grid: horizontal travel ≥ 50 px and more horizontal than vertical. All flips call `router.replace(binderHref({ binder, page }))` (drops `hl` and `card`).

- [ ] **Step 1: Write failing tests:**
  - `binder-params.test.ts`: `p` of `"0"`, `"99"`, `"abc"`, missing → clamped (1, pageCount, 1, 1); `card=r12` → `{ resultId: 12 }`, `card=l7` → `{ lotId: 7 }`, `card=x` → null; `hl` outside 1–9 → null; `binderHref` round-trips through `parseBinderParams` and encodes spaces.
  - `page-grid.test.tsx`: renders 9 pocket buttons in slot order with the labels above; a card without an image shows its name and number; highlight sets `data-highlight` on one and `data-dimmed` on the rest; clicking a card pocket calls `onOpen({ resultId })`; clicking an empty pocket does nothing.
  - `pager.test.tsx` (mock `next/navigation`): "Next page" calls `replace("/binders?b=Main&p=4")`; dot 1 calls `replace` with `p=1`; ArrowLeft flips back; a 80 px left swipe flips forward; a mostly vertical drag does nothing.
  - `capture-form.test.tsx`: with `initialPage={5}` the page field starts at 5.
- [ ] **Step 2: Run** `pnpm vitest run apps/web/lib/binder-params.test.ts apps/web/components/binder apps/web/components/scan/capture-form.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the helpers, components, actions, page, nav link and capture-form prefill. Pocket grid uses `aspect-ratio: 63 / 88` tiles in a 3-column grid capped at about 22rem wide, matching the app's existing tokens (`border-line`, `bg-surface`).
- [ ] **Step 4: Run** the tests, `pnpm test` and `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): binders screen with page grid and pager`.

### Task 7: Search box

**Files:**
- Create: `apps/web/components/binder/search-box.tsx`
- Modify: `apps/web/app/binders/page.tsx`
- Test: `apps/web/components/binder/search-box.test.tsx`

**Interfaces:**
- Consumes: `searchOwnedAction`, `binderHref`, `OwnedHit`.
- Produces: `SearchBox(props: { search: (q: string) => Promise<OwnedHit[]> })`.

Use the ui-sdk Combobox with `useAsyncOptions` the way `components/collection/add-card.tsx` does. Each option: thumbnail, "{name} · {setName} {number}/{printedTotal}", and where: "{binder} · page {page}, pocket {slot}", "{binder} · not on a page", or "No binder". Selecting: pocket → `router.push(binderHref({ binder, page, hl: slot }))`; unplaced → `router.push(binderHref({ binder, page: <current page>, card: null, hl: null }) + "#unplaced-" + lotId)` and the strip highlights that tile; loose → `router.push(binderHref({ binder: current, page: current, card: { lotId } }))`.

- [ ] **Step 1: Write failing tests:** typing "char" calls `search("char")` once after the debounce (fake timers, 250 ms); options show the where-text for each kind; picking a pocket hit pushes `/binders?b=Main&p=3&hl=2`; picking a loose hit pushes a URL with `card=l<id>`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** and mount it above the grid.
- [ ] **Step 4: Run** the test, `pnpm test`, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): search owned cards from the binder view`.

### Task 8: Card panel and edits

**Files:**
- Create: `apps/web/components/binder/card-panel.tsx`, `sparkline.tsx`, `pocket-edit-form.tsx`, `surplus-edit-form.tsx`
- Modify: `apps/web/app/binders/page.tsx`, `apps/web/components/ui/modal.tsx` (optional `variant: "dialog" | "sheet"` prop; sheet = full-width, bottom-anchored below the `sm` breakpoint)
- Test: `apps/web/components/binder/card-panel.test.tsx`, `sparkline.test.tsx`

**Interfaces:**
- Consumes: `CardDetail`, Task 6 actions, `LotFields`, `parseUsd`, `binderHref`.
- Produces:
  ```ts
  CardPanel(props: { detail: CardDetail; closeHref: string })
  Sparkline(props: { points: { date: string; cents: number }[] })   // renders nothing for < 2 points
  ```

Panel content per spec "Detail panel": `imageLarge` → `imageSmall` → name tile; name, set, number/total, rarity, variant, condition; market price with change since previous, or "No price yet"; `Sparkline`; places list (pocket places link to `binderHref({ binder, page, hl: slot })`, current one labeled "This pocket"); paid price and acquired date; actions Edit and Remove; in pocket mode a "Wrong card? Rescan this page" link to `/scan?binder=&page=`. Closing (dialog close, Escape, backdrop) calls `router.replace(closeHref)` and focus returns to the opening pocket (the grid keeps a ref by slot).

Pocket-mode edit form: variant and condition through `LotFields` with no quantity input (pass a prop to hide it, or render only the selects), paid and acquired fields; variant/condition change calls `movePocketAction`, paid/date change calls `setLotDetailsAction`; when `lot.quantity > 1`, the paid/date fields show "Applies to all {n} copies in {binder}" ("both copies" for 2). Remove opens an AlertDialog "Remove this {name} from page {n}?" and calls `removePocketAction`. A `missing` pocket (`lot: null`) shows only Remove and the rescan link.

Group-mode form: variant, condition, quantity (= surplus), binder, paid, acquired; save calls `editSurplusAction` and `setLotDetailsAction`; Remove calls `removeSurplusAction`. Field errors use the `failure.field` pattern from `edit-dialog.tsx`.

- [ ] **Step 1: Write failing tests:**
  - `sparkline.test.tsx`: 3 points → one `polyline` with 3 coordinate pairs; 1 point → renders nothing.
  - `card-panel.test.tsx` (mock actions and `next/navigation`): pocket mode has no quantity field; changing condition to LP and saving calls `movePocketAction(resultId, { variant, condition: "LP" })`; with `lot.quantity` 2 the paid field shows "Applies to both copies in Main"; Remove confirm text is "Remove this Pikachu from page 3?" and confirming calls `removePocketAction`; group mode shows quantity = surplus and save calls `editSurplusAction`; an action returning `{ ok: false, message: "That pocket changed. Reload the page." }` shows that message in an alert; no prices shows "No price yet"; no images shows the name tile; closing calls `replace(closeHref)`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement** the components and render `CardPanel` from the page when `card` resolves; `closeHref` = `binderHref({ binder, page })`. Pocket clicks in the grid and strip call `router.push(binderHref({ binder, page, card: ref }))`.
- [ ] **Step 4: Run** the tests, `pnpm test`, `pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): card panel with pocket and group edits`.

### Task 9: Verify the whole branch

- [ ] **Step 1:** `pnpm test`, `pnpm typecheck` and `pnpm --filter web build`. Expected: all pass, no type errors, build succeeds.
- [ ] **Step 2:** Apply the migration to the dev database with `pnpm db:migrate`, run `pnpm --filter web dev`, and walk through: open Binders, flip with buttons, dots, keys and (on a phone or touch emulation) swipe; open an unscanned page and follow "Scan this page" (form prefilled); search "char" and pick a hit (page and pocket highlighted); open a pocket, change condition, check the Collection list shows the split; remove a pocket and see it empty; open a "Not on a page yet" tile and change its quantity. Note anything that misbehaves and fix it before handing over.
- [ ] **Step 3:** Update `README.md` with a short "Binders" section (what the screen does; rescans keep pocket edits). Commit `docs: binders screen`.
