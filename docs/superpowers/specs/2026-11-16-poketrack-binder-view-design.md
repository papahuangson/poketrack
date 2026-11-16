# Poketrack Binder View: Design

Date: 2026-11-16 · Owner: HB · Status: approved
Builds on: `docs/superpowers/specs/2026-11-14-poketrack-phase-1-design.md`, `docs/superpowers/specs/2026-11-15-poketrack-phase-2-design.md`

Lines marked **(call)** are decisions made while writing this doc, not things HB said. Everything else comes from the conversation.

## Intent

HB keeps his cards in 9-pocket binders and scans pages into Poketrack. Right now the app only shows the collection as a list. He wants to **flip through each binder in the app like the real thing, and search to find where a card is**. Tapping a card opens its **detailed view, where he can edit it**.

The binder view is a picture of the physical binder. Committed scans already record which card sits in which pocket, so the view is built from that record.

**Done when:** HB can open a binder, flip page by page with each card in its real pocket, search for a card and land on its page with the pocket highlighted, and open and edit the card in that pocket without losing his place.

## Goals

1. A **Binders** screen (top nav link) showing one binder page at a time as a 3×3 grid of card images in their pockets (HB picked one page over a two-page spread).
2. Flip with arrows, page dots and swipe on phones.
3. Search across all binders. Pick a result to jump to its binder and page with the pocket highlighted.
4. Tapping a card opens a detail panel over the page (HB picked approach A) with a large image, card facts, prices, where his copies are, and edits.
5. Edits from a pocket change **only the card in that pocket** (HB's choice), not every identical copy.

## Non-goals

- A two-page spread layout.
- A standalone `/cards/[id]` page, or opening the panel from the Collection list (the panel is built so this can come later).
- Moving a card between pockets or pages in the app. The page is changed by rescanning it.
- Changing which card is in a pocket. That stays on the scan review page.
- Any change to scanning, matching or the nightly job, except the rescan carry-over below.

## Anti-goals

- Counts that drift. A pocket edit or removal followed by a rescan of that page must leave the collection correct (no double counting, no negative quantities).
- An edit on one pocket silently changing a copy in another pocket.
- A page showing a card that is no longer in the collection as if it were.
- Losing his place: closing the panel or pressing back returns to the same page.

## Constraints

- Phase 1 and 2 constraints still apply: ui-sdk `0.1.0-beta.1` public entry points only, Windows dev machine with cross-platform scripts, single user, passcode sign-in via `proxy.ts`.
- Lots (`collection_items`) are unique per (card, variant, condition, binder). Each confirmed pocket in a committed scan points at a lot through `scan_results.collection_item_id`. Several pockets can point at one lot.
- Rescan undo (`commitScan`, step 1) takes one copy from each old pocket's `collection_item_id`. Any pocket edit must keep that link pointing at the lot that actually holds the pocket's copy.
- Card images come from TCGdex (`cards.image_small`, `image_large`). Prices come from `price_snapshots` (card, variant, date, `market_usd`).

## Approaches considered (detail view)

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | Panel over the binder page: dialog on desktop, bottom sheet on phones. Card is in the URL (`&card=`), so back closes it. Reuses the existing edit fields and `Modal`. | Least new code, keeps his place. No standalone card page yet. |
| B | Full `/cards/[id]` page; back returns to the binder. | More room, reusable from the Collection list. Every tap leaves the binder, which fights "flip through it like the real thing". |
| C | Both through Next intercepting routes. | Most flexible. Fiddly with the passcode proxy; more than a single-user app needs now. |

HB picked A. A full page can be added later without redoing the panel.

Edit scope: whole group (as the Collection list does) vs. only the pocket's copy. HB picked **only the pocket's copy**.

## Screen: `/binders`

URL state: `/binders?b=<binder>&p=<page>&card=<pocket ref>&hl=<slot>`. All optional. Bookmarkable; browser back works through page flips and panel open/close **(call)**.

- **Default:** the most recently scanned binder (`latestBinder`), page 1. A binder picker (ui-sdk Select or Combobox) lists `listBinders` **(call)**. With no binders at all, an empty state with a "Scan a page" button.
- **Page count:** `max(page)` over the binder's committed scans. Pages between 1 and that max with no committed scan are shown as blank pages with a "Scan this page" button linking to `/scan?binder=<b>&page=<p>`, which prefills the capture form **(call)**. The capture form needs to accept those two params.
- **A page:** 3×3 grid, slots 1–9 in reading order, from that page's committed scan:
  - Confirmed, non-empty pocket: the card's `image_small` (fallback: name and number on a plain tile).
  - Empty or rejected pocket: dashed outline.
  - Pocket removed in the app (see Edits): dashed outline.
  - Pocket whose lot no longer exists (`collection_item_id` is null because the lot was removed from the Collection list): card image dimmed with "Not in your collection" **(call)**.
- Under the grid: "Page 3 of 6" and the page value (sum of current market price of its present cards; unpriced cards are skipped and counted, like the Collection total) **(call)**.
- **Flipping:** previous/next buttons, page dots (clickable), left/right arrow keys, and horizontal swipe on touch devices with plain pointer events, no new library **(call)**. Flips update `p` with `router.replace` so a back-press doesn't step through every page turned; opening the panel and search jumps use `push`, so back closes the panel or returns to where he was **(call)**.
- **Not on a page yet:** after the last page, a strip of the binder's lots that no pocket points at (hand-typed with this binder, or quantities beyond the number of pockets). Shown as small card tiles with "×2" where needed **(call)**.

## Search

- A search box above the page. Matches by card name and number using the same parsing as `searchCards` (`parseQuery`: "charmander", "char 4", "4/102") **(call)**, but only over cards he owns.
- Searches **every binder** plus binder-less lots **(call)**. Results update as he types (debounced, about 250 ms) in a dropdown list: image thumbnail, name, set and number, and where it is: "Main · page 3, pocket 2", "Main · not on a page", or "No binder".
- Picking a pocket result navigates to that binder and page with `hl=<slot>`. The pocket gets an accent outline and the other pockets are dimmed until the search is cleared or he flips **(call)**. Picking an unplaced result scrolls to the "Not on a page yet" strip and highlights that tile; a binder-less result opens the detail panel in group mode **(call)**.
- Implementation: a server function returning owned matches; the collection is small, so no index work is needed **(call)**.

## Detail panel

Opens when a pocket or a "Not on a page yet" tile is tapped. Dialog on desktop, bottom sheet on narrow screens (same ui-sdk Dialog, styled by breakpoint) **(call)**. Closing returns focus to the pocket that opened it.

Shows:
- `image_large` (fallback `image_small`).
- Name, set, number/printed total, rarity, variant, condition.
- Today's market price, change since the previous snapshot, and a small sparkline of the last 90 days of `market_usd` for this card and variant, drawn as inline SVG with no chart library **(call)**. "No price yet" when there are no snapshots.
- Where his copies are: every pocket and lot holding this card, e.g. "This pocket · Main page 3", "Also in Main · page 7", "Trade binder · not on a page" **(call)**.
- Paid price and acquired date of its lot.
- Actions: **Edit** and **Remove**. A "Wrong card? Rescan this page" link to `/scan?binder=<b>&page=<p>`. A committed scan is read-only, so rescanning is the only way to change which card is in a pocket **(call)**.

## Edits

Two modes, decided by how the panel was opened **(call)**:

### Pocket mode (opened from a pocket)

The pocket holds exactly one copy, so there is no quantity field and no binder field (moving cards is done by rescanning).

- **Variant or condition change:** move this one copy to the right lot in one transaction:
  1. Lock the page the same way `commitScan` does (advisory lock on binder + page).
  2. Lower the old lot by 1. Delete it if it reaches 0.
  3. Add one copy through `addItem` (same binder; merges into an existing matching lot).
  4. Point the pocket's `scan_results.collection_item_id` at the new lot and update its `variant` and `condition` so the scan record matches.
  5. Copy the old lot's paid price and acquired date onto the new lot when the new lot was just created **(call)**.
- **Paid price and acquired date:** these belong to the lot, not the copy, because lots are unique per card/variant/condition/binder and can't be split by price. Editing them changes the lot, and the form says so when the lot has more than one copy: "Applies to both copies in Main" **(call)**.
- **Remove (one copy):** lower the lot by 1 (delete at 0), set the pocket's `collection_item_id` to null and mark the pocket removed so the page shows it empty. A later rescan of the page then takes nothing for that pocket, which is correct because the copy is already gone. Confirm first: "Remove this Charmander from page 3?"
- New column `scan_results.removed_at timestamptz null` marks removed pockets. It keeps the scan record's read and decision intact, so scan accuracy numbers don't change **(call)**.

### Group mode (opened from "Not on a page yet" or a binder-less search result)

These tiles are the copies **no pocket accounts for**. Following HB's "only the card in the pocket" rule, group mode acts on those copies only and never on pocketed ones **(call)**:

- **Lot with no pockets pointing at it:** exactly today's edit dialog and Remove (`updateItemAction`, `removeItemAction`), including quantity and binder.
- **Lot that pockets also point at (surplus copies):** the surplus count is `quantity − pockets pointing at it`. Quantity edits change only the surplus: the field shows the surplus, and 0 removes it all. Changing variant, condition or binder moves the surplus copies out into their own lot (merging if one matches), the same way a pocket edit moves its one copy. Remove takes away only the surplus. Paid price and acquired date stay lot-level, as in pocket mode.

The Collection list's edit and remove are not changed in this phase. They still act on the whole lot, as they do today **(call)**.

### Lots with fewer copies than pockets

This can already happen. Phase 2 allows hand edits to scanned lots, and Collection-list edits can lower a quantity. When a lot has fewer copies than pockets pointing at it, the copies fill pockets in binder page order, then slot order. Any pocket left over is shown dimmed with "Not in your collection", like a pocket whose lot was deleted. The page value counts only present copies. Pocket-mode Remove on a left-over pocket only marks it removed, since there is no copy to take away **(call)**.

## Rescans keep pocket edits

HB chose this. When a page is rescanned, a pocket's starting values on the review grid come from the page's current committed scan if the new read matched **the same card in the same slot**. In that case it starts with that pocket's `variant` and `condition`, which pocket edits keep up to date, instead of the cue-based variant and NM. This happens where `packages/scan/src/run.ts` sets the starting `variant` and `condition` for each result. It takes priority over the cue proposal and the hand-typed-lot condition **(call)**. A different card, or a slot that was empty before, gets today's defaults.

A pocket removed in the app gets no special treatment. If the card is still in the sleeve, the rescan reads it and it comes back, because the photo shows it is there **(call)**.

## Layout

```
apps/web/app/binders/page.tsx          server page: loads binder, page, pockets, unplaced lots
apps/web/app/binders/actions.ts        pocket edit, pocket remove, search
apps/web/lib/binder-view.ts            queries: page contents, page count, unplaced lots, owned search, card detail
apps/web/lib/pocket-edit.ts            move-one-copy and remove-one-copy transactions
apps/web/components/binder/*           page grid, pager + swipe, search box, detail panel, pocket edit form
packages/db                            migration for scan_results.removed_at
packages/scan/src/run.ts               rescan carry-over of variant and condition
```

Reuse `LotFields`, `Modal`, `money` helpers and the `snapshotCents` approach from `lib/collection.ts` **(call)**.

## Testing

Following the existing Vitest + Testing Library + real Postgres pattern:

- `pocket-edit`: condition change on a ×2 lot splits off one copy and repoints only that pocket; change into an existing lot merges; change back merges back; old lot deleted at 0; paid price carried to a new lot; remove lowers by one and empties the pocket.
- **Rescan after edits:** edit a pocket's condition, then rescan the page with the same cards: quantities end where they started, nothing negative, nothing left at 0. Same for a removed pocket.
- `binder-view` queries: page count with gaps, rejected/empty/removed/missing-lot pockets, unplaced lots including quantity surplus.
- Rescan carry-over: same card in the same slot keeps the edited variant and condition; a different card or a newly filled slot gets the defaults.
- Group mode on a lot that pockets point at: quantity, variant/condition and Remove touch only the surplus; pockets and their `scan_results` are unchanged.
- Fewer copies than pockets: leftover pockets show as missing, and the page value counts only present copies.
- Search: name, number and name+number queries; results across binders; only owned cards.
- Components: grid renders pockets in slot order; highlight dims others; pager and keys; panel opens from URL and closes on back.

## Left to the builder

- Exact ui-sdk components for the binder picker, sheet styling and search dropdown.
- Debounce and swipe thresholds.
- Visual styling, within the app's existing look.
