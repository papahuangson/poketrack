# Poketrack Phase 1 (Foundation): Design

Date: 2026-11-14 · Owner: HB · Status: awaiting approval
Parent spec: "Pokémon Card Tracker — Spec" (https://claude.ai/artifact/HoScc4kb2nX6Sp3JLhBTHh)

Lines marked **(call)** are decisions made while writing this doc, not things HB said. Everything else comes from the parent spec or the conversation.

## Intent

HB wants a personal web app to catalog an English Pokémon card collection and track what it is worth. Phase 1 is the foundation the later phases (photo scanning, alerts and digest, chat) stand on: a mirrored card catalog, manual card entry, nightly prices, and a collection screen with a total value.

It also has to prove two things before anything else depends on them: that ui-sdk (beta) is workable for this UI, and that pokemontcg.io price data is good enough.

**Done when:** HB can type in 20 cards and see fresh prices for them the next day.

## Goals

1. Mirror the pokemontcg.io catalog (sets and cards) into Postgres and keep it current.
2. Add cards by searching the mirrored catalog in a ui-sdk Combobox, choosing variant, condition and quantity.
3. Refresh market prices nightly for owned and watched cards only, keeping history.
4. Show the collection with per-row and total value.
5. Run the nightly job on the NAS (primary) and Vercel Cron (backup) from the same code, never both on the same night.

## Non-goals (Phase 1)

- Photo scanning, alert rules, digest, email, web push, chat.
- Card detail page, price chart, binders screen, watchlist UI.
- Accounts or a passcode screen.
- Magic, non-English cards, graded values, buying and selling.

## Anti-goals

- A nightly run that executes twice, or silently not at all.
- Price history for cards HB neither owns nor watches (unbounded growth).
- A collection total that hides missing prices. Unpriced rows must be visible as unpriced.
- Building on ui-sdk internals that a beta bump would break. Use the public entry points only.

## Constraints

- **ui-sdk:** `@ui-sdk/react` and `@ui-sdk/core` pinned to exactly `0.1.0-beta.1`. Requires React 19. Components live in `apps/web/components/ui`. Install the library's agent skill (`npx skills add vercel-labs/ui --skill ui-sdk`) and follow it when building components.
- **Dev machine is Windows.** HB runs `pnpm install` and dev commands there. All scripts must be cross-platform (Node scripts, no bash-only steps).
- **NAS is a Synology DS920+** (x86_64). The job image is `linux/amd64`.
- **pokemontcg.io:** free key, 20,000 requests/day, 250 cards per page. Responses can be slow, so every call needs a timeout and retry with backoff.
- **Vercel functions** have a duration limit, so the nightly job must be small. The one-time full catalog backfill never runs on Vercel.
- **Single user, no auth.** The Vercel deployment is locked with Vercel Deployment Protection.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **A (chosen)** | pnpm workspace: `apps/web`, `packages/db`, `packages/jobs`, plus a small Docker image for the NAS. Full catalog mirror. | Most setup up front. NAS image stays small, and Phases 2 and 3 add code without restructuring. |
| B | Single Next.js app with jobs under `src/jobs`. Same mirror. | Quicker start. NAS image carries the whole web app, and the jobs would likely be split out later anyway. |
| C | No mirror. The Combobox queries pokemontcg.io live and only added cards are stored. | Fastest to 20 cards. Search depends on a third party's uptime, and Phase 3 reprint and new-set alerts need the mirror regardless. |

HB picked A.

## Layout

```
apps/web          Next.js App Router, React 19, ui-sdk
packages/db       Drizzle schema, migrations, client
packages/jobs     providers, catalog sync, price refresh, run lock, CLI
docker/           Dockerfile + compose file for the NAS runner
.github/workflows CI: test, build and push the NAS image
docs/
```

`apps/web` imports `packages/jobs` directly for the cron route and for the price fetch on add.

## Data model

Phase 1 creates six tables. `scans`, `scan_results`, `alert_rules` and `alert_events` arrive with their phases **(call)**.

| Table | Fields | Notes |
|---|---|---|
| `sets` | `id`, `name`, `series`, `printed_total`, `release_date`, `ptcgo_code`, `symbol_url`, `provider_updated_at` | `provider_updated_at` drives incremental sync **(call)**. |
| `cards` | `id` (provider ID, e.g. `sv3pt5-199`), `game` (= `pokemon`), `name`, `set_id`, `number`, `printed_total`, `rarity`, `image_small`, `image_large`, `legalities` jsonb, `reprint_key`, `variants` text[] | `variants` = the price variants the provider lists for this card, used to populate the variant picker **(call)**. `reprint_key` is computed at sync time so Phase 3 needs no backfill **(call)**. Trigram index on `name` for search. |
| `collection_items` | `id`, `card_id`, `variant`, `condition`, `quantity`, `paid_usd`, `acquired_on`, `source` (`manual` now, `scan` later), `binder`, `created_at` | `scan_result_id` is added in Phase 2. |
| `watchlist` | `card_id`, `variant`, `note` | Table only. The price job already reads it; UI comes later **(call)**. |
| `price_snapshots` | `card_id`, `variant`, `date`, `market_usd`, `low_usd`, `cardmarket_trend_eur`, PK (`card_id`, `variant`, `date`) | Upsert on the PK. |
| `job_runs` | `job`, `run_date`, `runner` (`nas` / `vercel`), `git_sha`, `status` (`running` / `ok` / `failed`), `started_at`, `finished_at`, `error`, unique (`job`, `run_date`) | Run lock and history. |

- **Variant** values are the provider's own keys (`normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`, …), shown with friendly labels **(call)**.
- **Condition** is one of NM, LP, MP, HP, DMG, default NM. Phase 1 prices every copy at the market price regardless of condition, and the UI says so **(call)**.
- **`reprint_key`** = hash of the normalized name plus rules text (attacks, abilities, or trainer text), as in the parent spec.
- **Adding a card that matches an existing row** on card, variant, condition and binder increments that row's quantity instead of creating a duplicate. `paid_usd` is per copy and optional **(call)**.
- **Dates** (`run_date`, snapshot `date`) are calendar dates in America/Chicago.

## Providers

`packages/jobs` defines `CatalogProvider` (`listSets`, `listCardsInSet`, `getCards(ids)`) and `PriceProvider` (`getPrices(ids)`). One `pokemontcgio` module implements both. Nothing outside that module knows the API's shape, so a move to Scrydex touches one module.

Price mapping: `market_usd` and `low_usd` come from the card's TCGplayer prices for the row's variant; `cardmarket_trend_eur` from the Cardmarket trend price. A variant with no price yields no snapshot row for that day.

## Jobs

**Backfill (one-off, CLI only).** `pnpm jobs backfill` loads every set and every card. Run once from the dev machine or the NAS. Safe to re-run (upserts).

**Nightly** (job name `nightly`), in order:
1. Claim the run (see lock below). If not claimed, exit quietly.
2. Sync sets. For sets that are new or whose `provider_updated_at` changed, upsert that set's cards.
3. Fetch owned and watched cards by ID in batches. Upsert today's `price_snapshots` and refresh those `cards` rows (including `legalities`).
4. Mark the run `ok`, or `failed` with the error text.

Every step is an upsert, so a takeover partway through causes no duplicates.

**Run lock.**
- Claim = `INSERT … ON CONFLICT DO NOTHING` on (`job`, `run_date`). The runner whose insert succeeds does the work.
- Takeover: if the insert conflicts, a runner may claim the existing row with one conditional `UPDATE` that succeeds only when the row is `failed`, or `running` for more than an hour. Otherwise it exits.
- Each run records `runner` and `git_sha`.

**Runners.**
- **NAS (primary):** container that stays up and runs the nightly job at 2:00 America/Chicago. `RUNNER=nas`, `GIT_SHA` baked in at build.
- **Vercel (backup):** `GET /api/cron/nightly`, protected by `CRON_SECRET`, scheduled `0 10 * * *` UTC. That is 4:00 Central in winter and 5:00 in summer, since Vercel Cron has no time zones **(call)**. `RUNNER=vercel`, sha from Vercel's commit env var.
- **Same code:** GitHub Actions builds the NAS image from each commit on `main` and pushes it to GHCR tagged with the sha. Updating the NAS to a new image is a manual pull in Phase 1; the settings page shows when the two runners' shas differ **(call)**.

**Price on add.** When a card is added and has no snapshot for today, the app fetches that one card and writes today's snapshot, so a new row shows a value immediately instead of the next morning **(call)**. If the fetch fails, the add still succeeds and the row shows as unpriced.

## Screens

**Collection (`/`)** — the main screen.

```
Collection                               $1,284.50   ▲ $12.10 since yesterday
[ Search cards to add…                ]             3 cards unpriced
Set [All ▾]  Variant [All ▾]  Condition [All ▾]     Sort [Value ▾]
──────────────────────────────────────────────────────────────────
[img] Charizard ex        151 · 199/165   Holo     NM  ×1   $98.40   $98.40  ⋯
[img] Pikachu             Base · 58/102   Normal   LP  ×2    $4.10    $8.20  ⋯
[img] Mew ex              151 · 151/165   Holo     NM  ×1       —        —   ⋯
```

- **Total** = Σ quantity × latest `market_usd` per (card, variant). The change figure compares against the previous snapshot date. Unpriced rows show "—" and are counted next to the total.
- **Add:** ui-sdk Combobox with async options, searching the mirrored catalog by name, or name plus number ("charizard 199"). Each option shows thumbnail, name, set and number. Picking one opens a small form: variant (from `cards.variants`, defaulting to the last one used), condition (default NM), quantity (default 1), then Add. Paid price, acquired date and binder are optional and live in the edit dialog **(call)**.
- **Filters and sort:** ui-sdk Select for set, variant and condition. Sort by value, name, set, or date added.
- **Row menu (ui-sdk Menu):** Edit (dialog) and Remove (with confirm).
- Keyboard: the whole add flow works without a mouse.

**Settings (`/settings`)** — last 14 job runs (date, runner, status, duration, sha) and a warning when the latest NAS and Vercel shas differ.

Data access is server components plus server actions; card search is a route handler **(call)**.

## Configuration

`DATABASE_URL`, `POKEMONTCG_API_KEY`, `CRON_SECRET`, `RUNNER`, `GIT_SHA`. Neon hosts Postgres, with a separate Neon branch for local development **(call)**. A `.env.example` lists them all.

HB supplies: a Neon project (main and dev connection strings), a pokemontcg.io API key, a private GitHub repo, and a Vercel project linked to it.

## Testing

- Provider mapping against saved API responses (variants, missing prices, cards with no TCGplayer data).
- Run lock: claim, conflict, takeover of `failed`, takeover of stale `running`, no takeover of fresh `running`.
- Collection value: quantities, unpriced rows, change since previous date.
- Add-merge rule for matching rows.

## Left to the builder

- Postgres driver, test database (for example PGlite), bundler for the jobs package, cron mechanism inside the NAS container.
- Styling approach and visual design, within "HB owns the markup and styles".
- Search ranking details, batch sizes, retry counts, timeouts.
- Friendly labels for variants.

## Amendment, 2026-11-15: card data moved to TCGdex

pokemontcg.io closed new API key registrations (existing keys work until 2027-03-01) and its successor Scrydex has no free plan, so HB chose to switch to TCGdex for now. Everything above that names pokemontcg.io now applies to TCGdex, with these differences:

- No API key and no `POKEMONTCG_API_KEY` variable.
- Card and set IDs are TCGdex's (`sv03.5-199`, set `sv03.5`).
- A full card, including prices, is one request per card. A set page lists its cards. The provider fetches up to 8 at a time. A full backfill is about 22,000 requests.
- Variant keys are TCGplayer's as TCGdex reports them, converted to the same naming as before (`reverse-holofoil` becomes `reverseHolofoil`). A card with no TCGplayer prices falls back to its printed variants.
- Sets carry no update stamp, so incremental sync keys on the set's card count **(call)**.
- Pokémon TCG Pocket sets are excluded **(call)**.
- `pnpm jobs backfill` resumes by default; `--full` forces a reload **(call)**.

Verified against the live API on 2026-11-15 by running the provider code in a browser: 206 sets, 21,660 cards, and TCGplayer prices on 1,169 of 1,185 sampled cards.
