# Poketrack Phase 2 (Photo ID): Design

Date: 2026-11-15 · Owner: HB · Status: approved
Parent spec: "Pokémon Card Tracker — Spec" (https://claude.ai/artifact/HoScc4kb2nX6Sp3JLhBTHh), section "Photo identification"
Builds on: `docs/superpowers/specs/2026-11-14-poketrack-phase-1-design.md`

Lines marked **(call)** are decisions made while writing this doc, not things HB said. Everything else comes from the parent spec or the conversation.

## Intent

HB's cards live in 9-pocket binders. Typing each one into the Combobox is slow, so Phase 2 lets him photograph a binder page on his phone and have the app identify the cards. Nothing is saved until he confirms it on a review grid.

For now he plans to scan just a few pages, so the flow is one page at a time: photo, then review, then add.

**A scan is the record of a binder page.** It is not just "add these cards". Rescanning a page replaces what that page's earlier scan put in the collection, so retaking a photo or rearranging a page never double-counts. Cards HB already typed in by hand are matched up with the scanned ones instead of being counted twice (HB chose this).

**Done when:** a full binder page (9 cards) goes in with 2 or fewer corrections.

## Goals

1. Capture a binder page photo from the phone and store it.
2. Read all 9 pockets in one Claude vision call.
3. Match each pocket to a catalog card (TCGdex mirror) using set code, number, printed total and name.
4. Review on a 3×3 grid: confirm, correct or reject each pocket, set variant and condition, then add.
5. Keep every read and every decision in `scan_results` so accuracy can be measured.
6. Rescanning a page replaces that page's earlier contribution to the collection.
7. Cards already entered by hand without a binder are claimed by the scan instead of duplicated.

## Non-goals (Phase 2)

- Many pages in a row with background processing and a review queue (approach B below).
- Matching by image similarity (approach C below).
- Single loose cards, toploaders or photos that aren't of a binder page.
- A separate 1st-edition price variant.
- Alerts, digest, chat, card detail page and binders screen.

## Anti-goals

- A card that gets added without HB confirming it.
- A wrong card shown as a confident match. Low-confidence pockets must look different and must not start checked.
- Losing a photo or its reads when the add fails. The scan stays reviewable.
- Counts that drift: a rescanned page, or a card that was both typed in and scanned, must never end up counted twice.
- Exposing the Anthropic key to the browser.

## Constraints

- Everything in Phase 1's constraints still applies: ui-sdk pinned at `0.1.0-beta.1` (public entry points only), Windows dev machine with cross-platform scripts only, and single user.
- **Card data is TCGdex.**
  - Card `number` is the bare `localId` (for example `199`), and `printed_total` comes from `cardCount.official`.
  - `sets.ptcgo_code` is TCGdex's `abbreviation.official`, or `tcgOnline` when that is missing. It can be null on older sets.
  - Variants are only `normal`, `holofoil` and `reverseHolofoil`. There is no 1st edition.
- **One vision call per page.** HB fixed this for Phase 2. A close-up second pass is a TODO (see Later).
- **Vercel function duration.** The scan request does one vision call plus a few queries, so give the route a `maxDuration` of 60 s **(call)**.
- **Phone access.** Deployment Protection would require a Vercel sign-in on the phone. Phase 2 replaces it with one shared passcode (see Access) **(call)**.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | One request: upload to Vercel Blob, then a route handler does the vision call, matches, saves `scans` and `scan_results`, and redirects to the review page. | Least to build. HB waits about 10–30 s on a spinner. Fits a few pages. |
| B | Upload returns right away. Read and match run in the background (`after()` or a queue), and the review page polls the scan status. | Better for scanning many pages in a row. Needs polling and failure states this phase doesn't need. |
| C | Match photo crops against embeddings of every catalog image. | Survives glare that hides text. Needs a vector index and an image backfill. A fallback only if text reading proves too inaccurate. |

HB picked A. Because `scans.status` is recorded and the pipeline is plain functions, moving to B later changes no data.

## Layout

```
packages/scan     read (Claude call + schema), parse, match, crop math. No Next.js imports.
apps/web/app/scan            capture page
apps/web/app/scans/[id]      review page
apps/web/app/api/scans       POST: create scan and run the pipeline
packages/db                  new tables and migration
```

`packages/scan` depends on `packages/db` and the Anthropic SDK. It has no dependency on the web app **(call)**.

## Data model

Two new tables:

| Table | Fields | Notes |
|---|---|---|
| `scans` | `id`, `image_url`, `image_width`, `image_height`, `binder` (required), `page` (required int), `status` (`reading` / `ready` / `failed` / `committed` / `superseded`), `error`, `model`, `prompt_version`, `created_at`, `committed_at` | `binder` + `page` identify the physical page. At most one `committed` scan per (`binder`, `page`), enforced by a partial unique index **(call)**. `binder` is written onto the collection rows, so lots are per binder **(call)**. |
| `scan_results` | `id`, `scan_id`, `slot` (1–9, row by row from the top left), `empty` bool, `read_name`, `read_number`, `read_printed_total`, `read_set_code`, `read_cues` jsonb (`holo`, `reverse`, `first_edition`), `confidence` (0–1), `box` jsonb (`x`, `y`, `w`, `h` as fractions of the image), `candidates` jsonb (up to 3 `{card_id, score, via}`), `chosen_card_id`, `variant`, `condition`, `decision` (`pending` / `confirmed` / `rejected`), `claim_manual` bool, `collection_item_id`, `claimed_from_item_id` | Unique (`scan_id`, `slot`). |

- **Link to the collection.** The parent spec put `scan_result_id` on `collection_items`. But Phase 1 merges matching lots into one row by bumping quantity, so a single row can come from several scans. The link goes the other way instead: `scan_results.collection_item_id` **(call)**. `collection_items` gets no new column.
- **What a page contributes.** Each confirmed pocket is worth exactly one copy in its `collection_item_id` lot. A page's contribution is the set of confirmed pockets of its `committed` scan. That is enough to undo it on rescan without a separate ledger table **(call)**.
- **Binder names** are picked from existing binders (distinct `scans.binder`, then `collection_items.binder`) or typed new. They are matched case-insensitively and trimmed, so "main" and "Main " are the same binder **(call)**.
- **Accuracy.** `candidates[0]` versus `chosen_card_id` is the record of whether the first guess was right. "Corrections" for the done-when count are confirmed pockets where they differ, plus non-empty pockets HB rejected or had to search for by hand.

## Access

Replace Deployment Protection with a shared passcode **(call)**:

- `APP_PASSCODE` env var. Middleware checks for a signed, httpOnly cookie on every route except `/login` and `/api/cron/nightly`. The cron route keeps using `CRON_SECRET`.
- `/login` is one password field. A correct passcode sets the cookie for 90 days.
- Turn off Deployment Protection on the production deployment once this ships. Preview deployments can keep it.

## Pipeline

### 1. Capture (`/scan`)

- Fields:
  - a file input (`accept="image/*" capture="environment"`)
  - binder, required: a ui-sdk Combobox over existing binders that can create a new one, defaulting to the last one used
  - page number, required, defaulting to the last page + 1
- If that binder and page already has a committed scan, the form says "Replaces the scan from Nov 15 (8 cards)" before upload. It is a notice, not a blocker.
- In the browser, the photo is shrunk to 2000 px on the long edge and re-encoded as JPEG at about 0.85 quality, with EXIF orientation applied. It then goes to Vercel Blob as a client upload (`@vercel/blob/client`), so the photo never passes through a function body **(call)**.
- Then `POST /api/scans` with `{ imageUrl, width, height, binder, page }`.
- The page shows a spinner with "Reading 9 pockets…" until the response redirects to `/scans/[id]`.

### 2. Read

- One Anthropic Messages call with the image and a tool or JSON schema that forces this output:

```
{ slots: [ { slot: 1..9, empty: bool, name, number_as_printed, set_code, cues: {holo, reverse, first_edition}, confidence, box: {x,y,w,h} } ] }
```

- The model and prompt version are stored on the scan. The default model comes from `ANTHROPIC_MODEL` **(call)**.
- The prompt tells the model to:
  - report text exactly as printed and not guess. A name or number it can't read comes back as null with low confidence.
  - lower its confidence for glare, sleeves at an angle, or a partly hidden number.
  - mark empty pockets as `empty: true`.
- Retry once on a timeout or a 5xx. After that, the scan is set to `failed` with the error, and the capture page offers "Try again".

### 3. Parse

- `number_as_printed` like `199/165` splits into number `199` and printed total `165`.
- Strip leading zeros to match TCGdex `localId` (`058` → `58`), but keep letter prefixes (`TG05`, `SV049`, `GG12`). Compare case-insensitively.
- Promo numbers without a slash (`SWSH123`, `SVP 085`) keep the whole string as the number.

### 4. Match

For each non-empty slot, in order, and stop at the first rule that finds something:

1. **Set code + number.** `sets.ptcgo_code = set_code` and `cards.number = number`. Score 1.0.
2. **Printed total + number.** Sets with `printed_total = read_printed_total`, a card with that number, and a name similar to the read name (trigram similarity ≥ 0.4). Score 0.9 if one card qualifies. With several, rank by name similarity and give a score of at most 0.8.
3. **Fuzzy name.** The existing `searchCards` trigram search on the name, boosted when the number matches. Keep the top 3 with scores of at most 0.7.

- The slot's `confidence` is the **lower** of the vision confidence and the match score **(call)**.
- Candidates and the method used (`via`) are stored for each slot.
- Variant proposal:
  - `reverse` cue and the card offers `reverseHolofoil` → `reverseHolofoil`.
  - else `holo` cue and the card offers `holofoil` → `holofoil`.
  - else the last-used default from Phase 1.
  - The choice is always limited to the card's `variants`.
- A `first_edition` cue becomes a visible "1st edition?" note on the slot. It doesn't change the variant.

### 5. Review (`/scans/[id]`)

```
Main · page 3                      7 matched · 1 check · 1 empty
┌──────────────┬──────────────┬──────────────┐
│ [crop][cat]  │ [crop][cat]  │ [crop][cat]  │
│ ✓ Charizard ex│ ✓ Pikachu    │ ? Mew ex  ▾  │
│ 151 199/165  │ Base 58/102  │ pick 1 of 3  │
│ Holo · NM    │ Normal · NM  │              │
├──────────────┼──────────────┼──────────────┤
│      …       │      …       │   (empty)    │
└──────────────┴──────────────┴──────────────┘
Arrows move · Enter confirms · X rejects          [Add 8 cards]
```

- Each pocket shows HB's crop next to the catalog image. The crop is drawn client-side from `box` on the stored photo, using CSS `object-position` and scale, so no image processing happens on the server **(call)**.
- Pockets scored 0.9 or higher start confirmed. Lower ones start pending and show a ui-sdk Combobox with the candidates, which can also search the whole catalog through the existing `/api/cards/search`.
- Per pocket: a variant Select (the card's variants), a condition Select (default NM), and a reject action. Empty pockets show "(empty)" and are skipped.
- Keyboard follows the parent spec: arrow keys move between pockets, Enter confirms, X rejects, and Tab reaches the Combobox and Selects. Grid focus uses ui-sdk list and selection behaviors.
- Every choice saves to `scan_results` as it happens (a server action per change), so a reload or a closed tab loses nothing **(call)**.
- **Already in the collection.** Each confirmed pocket shows what HB already owns of that card and variant:
  - **A hand-entered lot with no binder:** a "Typed in earlier, use that copy" toggle, on by default **(call)**. When on, the commit moves one copy out of that lot instead of adding a new one (`claim_manual`). A lot with quantity 3 can be claimed by up to 3 pockets across scans. Once it reaches 0, the toggle no longer appears.
  - **The same card on another binder page:** an info note only, "Also in Main · page 2". Owning two copies is normal.
- **Rescan view.** When this scan replaces an earlier one, the header shows the change compared with the earlier scan: "+2 new, −1 removed, 6 unchanged". Removed cards are listed so HB can see what will leave the collection.
- **Add N cards** is enabled when no non-empty pocket is pending. On a rescan, the button reads **Replace page**.
- On a phone the grid stays 3×3 with smaller tiles. Tapping a pocket opens it full-width to edit.

### 6. Commit

One transaction that locks the (`binder`, `page`) pair **(call)**:

1. **Undo the previous page scan, if there is one.**
   - For each confirmed pocket of the old `committed` scan, lower its `collection_item_id` lot by 1, never below 0 **(call)**, and delete the lot when it reaches 0.
   - A copy that pocket had claimed from a manual lot is not given back, because the scan has since become the record of it **(call)**.
   - The old scan becomes `superseded`.
2. **Apply the new scan.** For each confirmed pocket:
   - If `claim_manual` is on, lower the hand-entered lot by 1 (deleting it at 0) and record `claimed_from_item_id`. If that lot had a `paid_usd`, it carries over to the new copy when the target lot has none **(call)**.
   - Add one copy through Phase 1's `addItem` with `source = 'scan'`, the scan's `binder`, and the chosen variant and condition. Matching lots in the same binder merge and bump quantity.
   - Write the resulting row id to `collection_item_id`.
3. Mark the scan `committed`, with `committed_at` set.

After commit:
- After the transaction, Phase 1's price-on-add runs for each card that has no snapshot today. A price failure doesn't undo the add.
- Rejected pockets stay in `scan_results`.
- A committed or superseded scan opens read-only, so it can't be applied twice.
- Editing a scanned lot by hand later (quantity, condition) is allowed. A later rescan undoes only the pocket copies, clamped at 0, so hand edits can lower what a rescan removes but never make a count negative.
- Then go to the collection screen, with a note like "Added 8 cards from Main · page 3".

## Other screens

- **Collection header:** a "Scan a page" link next to the add Combobox.
- **`/scans`:** past scans grouped by binder and page, with the current scan first and superseded ones under it (date, status, how many cards). It also shows a simple accuracy line: first-guess right / non-empty pockets, over all committed scans **(call)**.

## Configuration

New env vars:
- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL`
- `BLOB_READ_WRITE_TOKEN` (from connecting a Vercel Blob store to the project)
- `APP_PASSCODE`
- `SESSION_SECRET` (signs the passcode cookie)

Add them all to `.env.example`.

HB supplies: an Anthropic API key, a Blob store on the Vercel project, and a passcode.

## Testing

- **Parse:** `199/165`, `058/102`, `TG05/TG30`, `SV049/SV122`, `SWSH123`, `SVP 085`, plus null and garbage input.
- **Match:** against a seeded catalog.
  - Set code hit, and a set code that is null.
  - Printed total with one set, and with two sets sharing a printed total.
  - Fuzzy fallback.
  - Confidence is the lower of the two scores.
  - Variant proposal from the cues and the card's variants.
- **Read:** the response is parsed against the schema using saved model outputs (fixtures). A malformed output fails the scan cleanly. The live API is never called in tests.
- **Commit:**
  - Merges into an existing lot in the same binder.
  - Writes `collection_item_id`.
  - Refuses a second commit of the same scan.
  - Leaves rejected pockets alone.
- **Rescan:**
  - Replacing a page with the identical cards leaves every count unchanged.
  - A removed card loses one copy, and its lot is deleted at 0.
  - A moved card (page 2 → page 3) nets out.
  - The old scan becomes `superseded`.
  - A hand-lowered lot clamps at 0.
  - Two commits racing for the same page: one wins, the other fails cleanly.
- **Claim:**
  - Moves one copy from a binder-less manual lot and deletes it at 0.
  - Carries `paid_usd` over.
  - Stops offering the claim once the manual lot is used up.
  - A claimed copy is not restored when its page is later rescanned without it.
- **Access:** middleware lets `/login` and the cron route through and blocks everything else without the cookie.
- **Real-photo check (manual, before calling Phase 2 done):** scan 3 real pages, including one with holos under sleeves. Each page must get 2 or fewer corrections **(call)**. Record the results from the `/scans` accuracy line.

## Later (TODO)

- **Close-up second pass (HB asked for this as a TODO).** The API scales the photo down, so each card is about 500 px wide and small print like "199/165" can be hard to read under sleeves. If the real-photo check misses its target, add a second call that re-reads only the low-confidence pockets from server-side crops of the full-resolution upload. This means keeping the original upload, adding an image library to `packages/scan`, and rechecking `maxDuration` and cost per page. `scans.prompt_version` and `model` already let results be compared before and after.
- Approach B (many pages in a row) and approach C (image matching), as above.

## Left to the builder

- Exact prompt wording, and whether to use tool use or a JSON response format.
- Trigram thresholds and score numbers beyond the ordering above.
- JPEG quality, and how the browser resize is done (canvas or `createImageBitmap`).
- Cookie signing method.
- Visual design of the grid, within "HB owns the markup and styles".
