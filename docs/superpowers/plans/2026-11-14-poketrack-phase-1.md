# Poketrack Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user web app where HB adds Pokémon cards from a mirrored catalog and sees per-row and total collection value, with prices refreshed nightly by a NAS job backed up by Vercel Cron.

**Architecture:** pnpm workspace. `packages/db` owns the Drizzle schema and migrations. `packages/jobs` owns the pokemontcg.io provider, catalog sync, price refresh and the run lock, exposed as functions and a CLI. `apps/web` is a Next.js App Router app that reads and writes Postgres through server components and server actions, and calls `packages/jobs` for the cron route and price-on-add.

**Tech Stack:** Node 22, pnpm 10, TypeScript (strict, ESM), Next.js (current stable, App Router), React 19, `@ui-sdk/react` + `@ui-sdk/core` `0.1.0-beta.1`, Tailwind CSS v4, Drizzle ORM + drizzle-kit, `pg`, PGlite (tests), Vitest, tsup, Docker (`node:22-alpine` + supercronic), GitHub Actions + GHCR, Neon Postgres, Vercel.

**Spec:** `docs/superpowers/specs/2026-11-14-poketrack-phase-1-design.md`

## Global Constraints

- `@ui-sdk/react` and `@ui-sdk/core` pinned to exactly `0.1.0-beta.1` (no `^`). Import from per-component entries only (`@ui-sdk/react/combobox`). Never import `@ui-sdk/core/internal/*`.
- After installing ui-sdk, run `npx skills add vercel-labs/ui --skill ui-sdk` and follow that skill for every component: read `node_modules/@ui-sdk/react/docs/llms.txt`, then only the component pages needed. Do not hand-roll anything with a `role=` that ui-sdk ships.
- App components wrapping ui-sdk live in `apps/web/components/ui`.
- All scripts are cross-platform: Node/tsx scripts only, no bash-only steps in `package.json`.
- Money is stored as `numeric(10,2)` and handled in application code as **integer cents**.
- Calendar dates (`run_date`, snapshot `date`) are `YYYY-MM-DD` in `America/Chicago`.
- Variant values are the provider's keys verbatim (`normal`, `holofoil`, `reverseHolofoil`, `1stEditionHolofoil`, `1stEditionNormal`, `unlimitedHolofoil`, …).
- Conditions: `NM`, `LP`, `MP`, `HP`, `DMG`. Default `NM`.
- Price history is written only for cards in `collection_items` or `watchlist`.
- No auth code. No scan, alert, digest, chat, card-detail, chart, binder-screen or watchlist-UI code.
- NAS image platform: `linux/amd64`.
- Tests never touch the network or a real database: provider tests use saved JSON fixtures, DB tests use PGlite.

## Execution Environment

- The live pokemontcg.io API and Neon are not reachable from the agent's workspace. Everything is verified against fixtures and PGlite; Task 11 is the live check HB runs.
- The agent's shell on HB's machine is Linux over a Windows folder. Never run `pnpm install` into the poketrack folder from that shell. Build and test in the agent's own workspace; `node_modules`, `.next` and `dist` never get copied to HB's folder.

## Review Focus

1. **Provider failure mid-run** (429, 5xx, timeout): the nightly run ends `failed` with the error text recorded, and the other runner can take over. → test in Task 6.
2. **Card with no TCGplayer prices** (promos, brand-new sets): it can be added, shows "—", and is counted as unpriced, not as $0. → tests in Tasks 2 and 7.
3. **Search text with accents, apostrophes or SQL wildcards** ("flabebe", "farfetch'd", "100%"): finds Flabébé and Farfetch'd, and `%`/`_` match literally. → test in Task 7.
4. **Bad edit input** (quantity 0, negative or fractional; negative paid price): rejected with a message, row unchanged. → test in Task 7.
5. **Empty or large collection in the nightly job**: zero owned cards finishes `ok` with no provider price calls; 120 owned cards are fetched in batches of 50. → test in Task 5.

---

## File Structure

```
package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts
.gitignore  .env.example  README.md
packages/db/
  src/schema.ts        tables
  src/client.ts        createDb, Db type
  src/dates.ts         chicagoDate
  src/constants.ts     CONDITIONS
  src/testing.ts       createTestDb (PGlite + migrations)
  src/index.ts
  drizzle/             generated SQL migrations
  drizzle.config.ts  scripts/migrate.ts
packages/jobs/
  src/types.ts         CatalogSet, CatalogCard, CardPrice, PricedCard, providers
  src/normalize.ts     normalizeText, reprintKey
  src/providers/pokemontcgio.ts  (+ fixtures/*.json)
  src/catalog-sync.ts  syncCatalog
  src/run-lock.ts      claimRun, finishRun
  src/prices.ts        refreshPrices, snapshotCard
  src/nightly.ts       runNightly
  src/cli.ts           backfill | nightly
  src/index.ts
apps/web/
  app/layout.tsx  app/globals.css
  app/page.tsx                 collection screen
  app/settings/page.tsx
  app/actions.ts               server actions
  app/api/cards/search/route.ts
  app/api/cron/nightly/route.ts
  lib/db.ts  lib/collection.ts  lib/money.ts  lib/variants.ts  lib/job-runs.ts
  components/ui/               ui-sdk wrappers (combobox, select, menu, dialog, alert-dialog, field)
  components/collection/       total-header, add-card, add-card-form, filters, collection-list, row-menu, edit-dialog
  vercel.json
docker/Dockerfile  docker/crontab  docker/compose.yaml
.github/workflows/ci.yml
```

---

### Task 1: Workspace and database schema

**Files:**
- Create: root config files, everything under `packages/db/`
- Test: `packages/db/src/schema.test.ts`, `packages/db/src/dates.test.ts`

**Interfaces:**
- Produces (from `@poketrack/db`):
  - tables `sets`, `cards`, `collectionItems`, `watchlist`, `priceSnapshots`, `jobRuns`, with the columns in the spec's Data model table. Additions: `cards.nameSearch text not null` (normalized name, GIN trigram index), `collectionItems.id serial`, `collectionItems.createdAt timestamptz default now()`, `jobRuns.error text`. Unique index on `collection_items (card_id, variant, condition, coalesce(binder,''))`. Unique on `job_runs (job, run_date)`. PK on `price_snapshots (card_id, variant, date)`. PK on `watchlist (card_id, variant)`.
  - `type Db` — Drizzle Postgres database typed with the schema, satisfied by both the `pg` and PGlite drivers.
  - `createDb(url: string): Db`
  - `chicagoDate(now?: Date): string`
  - `CONDITIONS: readonly ['NM','LP','MP','HP','DMG']`, `type Condition`
- Produces (from `@poketrack/db/testing`): `createTestDb(): Promise<Db>` — fresh in-memory PGlite with `pg_trgm` loaded and all migrations applied.

- [ ] **Step 1:** `git init`; create the workspace (`apps/*`, `packages/*`), `tsconfig.base.json` (strict, `moduleResolution: bundler`, `noUncheckedIndexedAccess`), Vitest workspace, `.gitignore` (`node_modules`, `.next`, `dist`, `.env*` except `.env.example`), and `.env.example` listing `DATABASE_URL`, `POKEMONTCG_API_KEY`, `CRON_SECRET`, `RUNNER`, `GIT_SHA`. Root scripts: `test` (vitest run), `typecheck` (`tsc -b`), `jobs` (`pnpm --filter @poketrack/jobs cli`), `db:migrate`.
- [ ] **Step 2: Write failing tests**

```ts
// dates.test.ts
expect(chicagoDate(new Date('2026-11-15T03:30:00Z'))).toBe('2026-11-14') // 21:30 CST
expect(chicagoDate(new Date('2026-11-15T06:00:00Z'))).toBe('2026-11-15') // 00:00 CST
expect(chicagoDate(new Date('2026-07-01T04:59:00Z'))).toBe('2026-06-30') // 23:59 CDT
expect(chicagoDate(new Date('2026-07-01T05:00:00Z'))).toBe('2026-07-01')

// schema.test.ts (createTestDb)
// inserting two job_runs with the same (job, run_date) rejects
// inserting two price_snapshots with the same (card_id, variant, date) rejects
// inserting two collection_items with same card, variant, condition and null binder rejects
// collection_items.condition defaults to 'NM', quantity to 1, source to 'manual'
```

- [ ] **Step 3:** Run `pnpm test` — expect FAIL (modules missing).
- [ ] **Step 4:** Implement schema, client, dates, constants, testing helper. First migration starts with `CREATE EXTENSION IF NOT EXISTS pg_trgm;`. Generate SQL with drizzle-kit into `packages/db/drizzle/`. `scripts/migrate.ts` applies migrations to `DATABASE_URL`.
- [ ] **Step 5:** Run `pnpm test` and `pnpm typecheck` — expect PASS.
- [ ] **Step 6:** Commit `feat(db): workspace and schema`.

### Task 2: Domain types, text normalization, pokemontcg.io provider

**Files:**
- Create: `packages/jobs/src/types.ts`, `normalize.ts`, `providers/pokemontcgio.ts`, `providers/fixtures/{sets.json,cards-page.json,cards-by-id.json}`
- Test: `packages/jobs/src/normalize.test.ts`, `providers/pokemontcgio.test.ts`

**Interfaces:**
- Produces:

```ts
type CatalogSet = { id: string; name: string; series: string; printedTotal: number;
  releaseDate: string /* YYYY-MM-DD */; ptcgoCode: string | null; symbolUrl: string | null;
  updatedAt: string /* provider value, verbatim */ }
type CatalogCard = { id: string; name: string; setId: string; number: string; printedTotal: number;
  rarity: string | null; imageSmall: string | null; imageLarge: string | null;
  legalities: Record<string, string>; rulesText: string; variants: string[] }
type CardPrice = { cardId: string; variant: string; marketCents: number | null;
  lowCents: number | null; cardmarketTrendEurCents: number | null }
type PricedCard = { card: CatalogCard; prices: CardPrice[] }
interface CatalogProvider { listSets(): Promise<CatalogSet[]>; listCardsInSet(setId: string): Promise<CatalogCard[]> }
interface PriceProvider { getPrices(cardIds: string[]): Promise<PricedCard[]> }
function createPokemonTcgIo(opts: { apiKey?: string; fetch?: typeof fetch; retryDelayMs?: number }): CatalogProvider & PriceProvider
function normalizeText(s: string): string
function reprintKey(name: string, rulesText: string): string
class ProviderError extends Error { status?: number }
```

- Provider rules: base URL `https://api.pokemontcg.io/v2`, header `X-Api-Key`, `pageSize=250`, follow pages until `page * pageSize >= totalCount`. `listCardsInSet` queries `q=set.id:<id>`. `getPrices` splits ids into batches of **50** and queries `q=id:(a OR b …)`; ids the API does not return are simply absent from the result. Each request: 20 s timeout, up to 3 attempts, retry on 429/5xx/timeout with delay `retryDelayMs * 2^attempt` (default 1000), otherwise throw `ProviderError`.
- Mapping: `releaseDate` `2023/09/22` → `2023-09-22`. `variants` = keys of `tcgplayer.prices`, `[]` when absent. One `CardPrice` per variant key: `marketCents`/`lowCents` from that variant's `market`/`low` (dollars → cents, rounded; missing → `null`). `cardmarketTrendEurCents` from `cardmarket.prices.reverseHoloTrend` when variant is `reverseHolofoil`, else `cardmarket.prices.trendPrice`. `rulesText` = every attack's `name` + `text`, every ability's `name` + `text`, and every entry of `rules`, in API order, joined with `\n`.
- `normalizeText`: NFKD, strip combining marks, lowercase, replace every run of non-alphanumerics with one space, trim. `reprintKey` = sha256 hex of `normalizeText(name) + '|' + normalizeText(rulesText)`.

- [ ] **Step 1: Write failing tests**

```ts
expect(normalizeText("Flabébé")).toBe('flabebe')
expect(normalizeText("Farfetch'd  ex")).toBe('farfetch d ex')
expect(reprintKey('Pikachu', 'Gnaw\n')).toBe(reprintKey('PIKACHU', ' gnaw'))
expect(reprintKey('Pikachu', 'Gnaw')).not.toBe(reprintKey('Pikachu', 'Thunder Jolt'))

// provider, with a stub fetch serving fixtures
// listSets maps id, printedTotal, releaseDate '2023-09-22', updatedAt verbatim
// listCardsInSet requests page 2 when totalCount is 300 and returns 300 cards
// getPrices(['sv3pt5-199']) → variants ['holofoil'], marketCents 9840 for market 98.4
// reverseHolofoil price uses reverseHoloTrend; holofoil uses trendPrice
// card with no tcgplayer block → variants [], prices []
// getPrices with 120 ids makes exactly 3 requests
// 429 then 200 → resolves after one retry; three 500s → rejects ProviderError with status 500
// request carries X-Api-Key when apiKey is set
```

Fixtures are hand-built to the documented v2 response shape and must include: a card with `holofoil` + `reverseHolofoil`, a card with only `normal`, a card with no `tcgplayer`, and a card with no `cardmarket`.

- [ ] **Step 2:** Run tests — expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests and typecheck — expect PASS.
- [ ] **Step 5:** Commit `feat(jobs): pokemontcg.io provider`.

### Task 3: Catalog sync

**Files:**
- Create: `packages/jobs/src/catalog-sync.ts`
- Test: `packages/jobs/src/catalog-sync.test.ts`

**Interfaces:**
- Consumes: `Db`, `createTestDb`, `CatalogProvider`, `normalizeText`, `reprintKey`.
- Produces: `syncCatalog(db: Db, provider: CatalogProvider, opts?: { full?: boolean }): Promise<{ setsUpserted: number; setsFetched: number; cardsUpserted: number }>` and `upsertCards(db: Db, cards: CatalogCard[]): Promise<number>` (also used by Task 5).
- Behavior: upsert every set. Fetch a set's cards when `opts.full`, or the set is new, or its `updatedAt` differs from stored `provider_updated_at`. A set's `provider_updated_at` is written only **after** its cards are upserted, so a crash mid-set retries it next run. `upsertCards` sets `game = 'pokemon'`, `nameSearch = normalizeText(name)`, `reprintKey`, and overwrites all catalog columns on conflict.

- [ ] **Step 1: Write failing tests** (fake provider recording calls)

```ts
// first run with 2 sets → setsFetched 2, cards rows exist with name_search and reprint_key set
// second run, nothing changed → setsFetched 0
// set B updatedAt changes → setsFetched 1, only B requested
// { full: true } → setsFetched 2
// listCardsInSet throws for set B → rejects; set A stored; set B provider_updated_at still null/old; next run fetches B
// re-running does not duplicate rows (count stable)
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(jobs): catalog sync`.

### Task 4: Run lock

**Files:**
- Create: `packages/jobs/src/run-lock.ts`
- Test: `packages/jobs/src/run-lock.test.ts`

**Interfaces:**
- Produces:

```ts
type Runner = 'nas' | 'vercel'
function claimRun(db: Db, a: { job: string; runDate: string; runner: Runner; gitSha: string; now?: Date }): Promise<boolean>
function finishRun(db: Db, a: { job: string; runDate: string; status: 'ok' | 'failed'; error?: string; now?: Date }): Promise<void>
```

- `claimRun`: `INSERT … ON CONFLICT DO NOTHING RETURNING`; if no row returned, one conditional `UPDATE … WHERE job = ? AND run_date = ? AND (status = 'failed' OR (status = 'running' AND started_at < now - 1 hour)) RETURNING`, which resets `runner`, `git_sha`, `status = 'running'`, `started_at = now`, `finished_at = null`, `error = null`. Return whether either statement returned a row. `error` text is truncated to 2000 characters in `finishRun`.

- [ ] **Step 1: Write failing tests**

```ts
// first claim → true, row running with runner and git_sha
// second claim same date, other runner → false
// after finishRun ok → claim false
// after finishRun failed → claim true, runner replaced, error cleared
// running for 61 minutes → claim true; running for 59 minutes → claim false
// different run_date → true
// two claimRun calls via Promise.all → exactly one true
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(jobs): run lock`.

### Task 5: Price refresh

**Files:**
- Create: `packages/jobs/src/prices.ts`
- Test: `packages/jobs/src/prices.test.ts`

**Interfaces:**
- Consumes: `PriceProvider`, `upsertCards`.
- Produces:
  - `refreshPrices(db: Db, provider: PriceProvider, date: string): Promise<{ cardsRequested: number; snapshotsWritten: number }>`
  - `snapshotCard(db: Db, provider: PriceProvider, cardId: string, date: string): Promise<number>` (snapshots written)
- Behavior: card ids = distinct `card_id` from `collection_items` ∪ `watchlist`. With zero ids, return without calling the provider. For each `PricedCard`: `upsertCards([card])`, then upsert one snapshot per `CardPrice` whose `marketCents` is not null, **for every variant the provider returns** (not only owned variants, so changing a row's variant later still has history). Upsert on the PK overwrites the same day's values.

- [ ] **Step 1: Write failing tests**

```ts
// owned card + watched card → both requested, snapshots for date written
// card that is neither owned nor watched → never requested, no snapshot
// zero owned/watched → provider.getPrices not called, returns { cardsRequested: 0, snapshotsWritten: 0 }
// 120 owned cards → getPrices receives all 120 ids in one call (batching is the provider's job, proven in Task 2)
// variant with marketCents null → no row
// running twice same date → row count unchanged, values from second run
// refreshed card's legalities overwrite the stored ones
// snapshotCard for a card with no prices → 0, no throw
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS.
- [ ] **Step 5:** Commit `feat(jobs): price refresh`.

### Task 6: Nightly orchestration and CLI

**Files:**
- Create: `packages/jobs/src/nightly.ts`, `cli.ts`, `index.ts`, `tsup.config.ts`
- Test: `packages/jobs/src/nightly.test.ts`

**Interfaces:**
- Produces: `runNightly(db: Db, provider: CatalogProvider & PriceProvider, a: { runner: Runner; gitSha: string; now?: Date }): Promise<{ claimed: false } | { claimed: true; status: 'ok' | 'failed'; error?: string }>`. Job name constant `NIGHTLY_JOB = 'nightly'`. `runDate = chicagoDate(now)`.
- Order: `claimRun` → `syncCatalog` → `refreshPrices(runDate)` → `finishRun ok`. Any throw → `finishRun failed` with the message; `runNightly` itself does not throw.
- CLI (`pnpm jobs <cmd>`, dev via tsx, bundled by tsup to `dist/cli.js`): `backfill` runs `syncCatalog({ full: true })` and prints the counts; `nightly` runs `runNightly` with `RUNNER` and `GIT_SHA` from env and exits 1 when status is `failed`. Both require `DATABASE_URL`; a missing variable prints which one and exits 2.
- `index.ts` re-exports everything `apps/web` needs: `createPokemonTcgIo`, `runNightly`, `snapshotCard`, types.

- [ ] **Step 1: Write failing tests**

```ts
// happy path → { claimed: true, status: 'ok' }, job_runs row ok with finished_at
// already claimed today → { claimed: false }, provider untouched
// provider.listSets throws ProviderError(429) → status 'failed', job_runs.error contains the message  [Review Focus 1]
// after that failure, a second runNightly with runner 'vercel' → claimed true, status 'ok'
// provider.getPrices throws → status 'failed'; catalog rows from the sync step remain
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS; `pnpm --filter @poketrack/jobs build` produces `dist/cli.js`.
- [ ] **Step 5:** Commit `feat(jobs): nightly job and cli`.

### Task 7: Collection data layer

**Files:**
- Create: `apps/web/lib/collection.ts`, `lib/money.ts`, `lib/variants.ts`
- Test: `apps/web/lib/collection.test.ts`, `lib/money.test.ts`
- (Scaffold `apps/web` here with create-next-app: App Router, TypeScript, Tailwind v4, no `src/` dir; add `@poketrack/db` and `@poketrack/jobs` as workspace deps with `transpilePackages`.)

**Interfaces:**
- Produces:

```ts
type CardHit = { id: string; name: string; setName: string; number: string; printedTotal: number; imageSmall: string | null; variants: string[] }
function searchCards(db: Db, q: string, limit?: number /* 20 */): Promise<CardHit[]>

type AddInput = { cardId: string; variant: string; condition: Condition; quantity: number; binder?: string | null }
function addItem(db: Db, input: AddInput): Promise<{ id: number; merged: boolean }>
type EditInput = { variant: string; condition: Condition; quantity: number; paidCents: number | null; acquiredOn: string | null; binder: string | null }
function updateItem(db: Db, id: number, input: EditInput): Promise<void>
function removeItem(db: Db, id: number): Promise<void>
class ValidationError extends Error { field: string }

type Sort = 'value' | 'name' | 'set' | 'added'
type CollectionRow = { id: number; cardId: string; name: string; setId: string; setName: string; number: string; printedTotal: number;
  imageSmall: string | null; variant: string; condition: Condition; quantity: number;
  paidCents: number | null; acquiredOn: string | null; binder: string | null; cardVariants: string[];
  marketCents: number | null; rowTotalCents: number | null }
function listCollection(db: Db, f: { setId?: string; variant?: string; condition?: Condition; sort?: Sort }): Promise<CollectionRow[]>
function collectionTotals(db: Db): Promise<{ totalCents: number; changeCents: number | null; unpricedCount: number }>
function collectionFilterOptions(db: Db): Promise<{ sets: { id: string; name: string }[]; variants: string[] }>
function defaultVariant(db: Db, cardVariants: string[]): Promise<string>

// money.ts
function formatUsd(cents: number | null): string   // 128450 → '$1,284.50', null → '—'
function parseUsd(text: string): number | null     // '12.5' → 1250, '' → null, throws ValidationError on junk or negative
// variants.ts
function variantLabel(v: string): string           // 'reverseHolofoil' → 'Reverse Holo', unknown keys → spaced Title Case
```

- Rules:
  - `searchCards`: normalize `q` with `normalizeText`. Fewer than 2 characters → `[]`. If the last token is all digits, or `digits/digits`, treat it as the collector number (match `cards.number` equal to the digits before any `/`, ignoring leading zeros) and the rest as the name; a query that is only a number searches by number alone. Name match is `name_search LIKE '%…%'` with `%`, `_` and `\` escaped. Order: exact name match, then prefix match, then set `release_date` descending, then `number`.
  - `addItem`: quantity must be an integer 1–999; variant non-empty; card must exist. If a row matches card, variant, condition and binder (null and `''` equal), add to its quantity and return `merged: true`.
  - `updateItem`: same quantity rule; `paidCents` ≥ 0 or null; `acquiredOn` a valid date not in the future, or null. If the edit makes the row collide with another row under the merge rule, throw `ValidationError` on `variant` ("You already have this card with that variant and condition. Change its quantity instead.").
  - Latest price for a (card, variant) = its most recent snapshot row. Previous = the row before that. `marketCents` null when there is no snapshot.
  - `totalCents` = Σ quantity × latest. `unpricedCount` = number of rows with no snapshot. `changeCents` = Σ quantity × (latest − previous) over rows that have both; `null` when no row has both.
  - `sort` default `value` (row total descending, unpriced last). `name` ascending, `set` by release date descending then number, `added` newest first.
  - `defaultVariant`: the variant of the most recently created collection item if `cardVariants` includes it; else `cardVariants[0]`; else `'normal'`.

- [ ] **Step 1: Write failing tests**

```ts
// search: 'chariz' finds Charizard ex; 'charizard 199' returns only number 199; '199/165' works; '4' matches number '004' style ids
// search: 'flabebe' finds Flabébé; "farfetch'd" finds Farfetch'd; '100%' returns [] without error and '_' is literal  [Review Focus 3]
// search: 'c' → []
// add: new row → merged false; same card/variant/condition/binder again → merged true, quantity summed
// add: different condition → second row
// add: quantity 0, -1, 1.5, 1000 → ValidationError('quantity'); unknown cardId → ValidationError('cardId')
// update: quantity 0 / -2 / 2.5 → ValidationError, row unchanged; paidCents -1 → ValidationError('paidCents')  [Review Focus 4]
// update into a collision → ValidationError('variant')
// totals: 2× card at 410 + 1× card at 9840 → totalCents 10660
// totals: card with no snapshot → excluded from total, unpricedCount 1, row marketCents null  [Review Focus 2]
// totals: latest 9840, previous 9000, quantity 2 → changeCents 1680; only one snapshot anywhere → changeCents null
// list: filters by set, variant, condition; sort 'value' puts unpriced rows last
// formatUsd(128450) '$1,284.50'; formatUsd(null) '—'; parseUsd('12.5') 1250; parseUsd('abc') throws
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run tests and typecheck — PASS.
- [ ] **Step 5:** Commit `feat(web): collection data layer`.

### Task 8: App shell, cron route, settings page

**Files:**
- Create: `apps/web/lib/db.ts`, `lib/job-runs.ts`, `app/layout.tsx`, `app/globals.css`, `app/settings/page.tsx`, `app/api/cron/nightly/route.ts`, `vercel.json`
- Test: `apps/web/lib/job-runs.test.ts`, `apps/web/app/api/cron/nightly/route.test.ts`

**Interfaces:**
- Consumes: `runNightly`, `createPokemonTcgIo`, `createDb`.
- Produces:
  - `getDb(): Db` — module-level singleton from `DATABASE_URL`.
  - `recentRuns(db: Db, limit?: number /* 14 */): Promise<JobRun[]>` newest first; `runnerShaMismatch(runs: JobRun[]): { nas: string; vercel: string } | null` — compares the `git_sha` of the most recent `ok` run of each runner; `null` when equal or when either runner has none.
  - `GET /api/cron/nightly`: 401 unless `Authorization: Bearer ${CRON_SECRET}` (also 401 when `CRON_SECRET` is unset). Otherwise runs `runNightly` with `runner: 'vercel'`, `gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? 'unknown'`; responds 200 with the result JSON, or 500 when status is `failed`. `export const maxDuration = 300`, `dynamic = 'force-dynamic'`.
  - `vercel.json`: `{ "crons": [{ "path": "/api/cron/nightly", "schedule": "0 10 * * *" }] }`.
- Layout: header with app name "Poketrack" and links Collection (`/`) and Settings (`/settings`). `globals.css` starts with `@layer ui-sdk;` above `@import "tailwindcss"`.
- Settings page: table of the last 14 runs (date, runner, status, duration, first 7 chars of sha, error text when failed). Above it, when `runnerShaMismatch` is non-null: "The NAS and Vercel are running different versions (nas abc1234, vercel def5678). Pull the latest image on the NAS." Empty state: "No runs yet. The first nightly run is at 2:00 AM Central."

- [ ] **Step 1: Write failing tests**

```ts
// runnerShaMismatch: nas ok 'aaa', vercel ok 'bbb' → { nas: 'aaa', vercel: 'bbb' }
// same sha → null; only nas runs → null; latest vercel run failed but an older ok one differs → uses the ok one
// route: no header → 401; wrong secret → 401; CRON_SECRET unset → 401
// route: correct secret, runNightly mocked ok → 200; mocked failed → 500; mocked { claimed: false } → 200
```

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run tests, typecheck and `next build` — PASS.
- [ ] **Step 5:** Commit `feat(web): shell, cron route, settings`.

### Task 9: Collection screen (read side)

**Files:**
- Create: `apps/web/app/page.tsx`, `components/ui/select.tsx`, `components/collection/{total-header,filters,collection-list}.tsx`
- Test: `apps/web/components/collection/collection-list.test.tsx`, `total-header.test.tsx` (Vitest + Testing Library, jsdom)

**Interfaces:**
- Consumes: `listCollection`, `collectionTotals`, `collectionFilterOptions`, `formatUsd`, `variantLabel`.
- Page is a server component. Filters and sort live in the URL: `?set=&variant=&condition=&sort=`; invalid values are ignored.
- `TotalHeader({ totalCents, changeCents, unpricedCount })`: total via `formatUsd`; change as "▲ $12.10 since last update" / "▼ $3.00 since last update", omitted when `null` or 0; "3 cards unpriced" when > 0 (singular "1 card unpriced"); a persistent note "Values use market price and ignore condition."
- `Filters`: three ui-sdk Selects (Set, Variant, Condition), each with an "All" option, plus a Sort Select (Value, Name, Set, Date added). Changing one updates the URL.
- `CollectionList({ rows })`: one row per item with thumbnail (`next/image`, pokemontcg.io image host allowed in `next.config`), name, "`setName` · `number`/`printedTotal`", variant label, condition, "×quantity", market price, row total, and a slot for the row menu (Task 10). Empty state: "No cards yet. Search above to add your first card." Filtered-empty state: "No cards match these filters."

- [ ] **Step 1:** Install ui-sdk at the pinned version, add the ui-sdk skill, read `llms.txt` and the Select page.
- [ ] **Step 2: Write failing tests**

```tsx
// TotalHeader: 128450 → '$1,284.50'; changeCents 1210 → '▲ $12.10 since last update'; -300 → '▼ $3.00…'; null → no change text
// TotalHeader: unpricedCount 3 → '3 cards unpriced'; 1 → '1 card unpriced'; 0 → absent
// CollectionList: unpriced row shows '—' in both price cells
// CollectionList: row shows 'Reverse Holo', 'NM', '×2'
// CollectionList: [] → empty-state text
```

- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run tests, typecheck, `next build` — PASS.
- [ ] **Step 6:** Commit `feat(web): collection screen`.

### Task 10: Add, edit and remove

**Files:**
- Create: `apps/web/app/actions.ts`, `app/api/cards/search/route.ts`, `components/ui/{combobox,menu,dialog,alert-dialog,field}.tsx`, `components/collection/{add-card,add-card-form,row-menu,edit-dialog}.tsx`
- Modify: `apps/web/app/page.tsx` (mount add-card above filters, pass row menu)
- Test: `apps/web/app/actions.test.ts`, `components/collection/add-card.test.tsx`

**Interfaces:**
- Consumes: Task 7 functions, `snapshotCard`, `createPokemonTcgIo`, `chicagoDate`.
- Produces:
  - `GET /api/cards/search?q=` → `CardHit[]` JSON.
  - Server actions, each returning `{ ok: true } | { ok: false; field: string; message: string }` and revalidating `/`:
    `addCardAction(input: AddInput)`, `updateItemAction(id, input: EditInput)`, `removeItemAction(id)`, plus `defaultVariantAction(cardVariants: string[]): Promise<string>`.
  - `addCardAction` after a successful add: if the card has no snapshot for `chicagoDate()`, call `snapshotCard`; a throw there is caught and logged, and the action still returns `{ ok: true }`.
- UI:
  - `AddCard`: ui-sdk Combobox labelled "Add a card", placeholder "Search cards to add…", options loaded from the search route as the user types (debounced 200 ms, stale responses discarded). Each option: thumbnail, name, "`setName` · `number`/`printedTotal`". No-results text: "No cards found." Choosing an option opens `AddCardForm` for that card and clears the combobox.
  - `AddCardForm` (ui-sdk Dialog titled with the card name): Variant Select (options from the card's `variants`, or just Normal when empty; initial value from `defaultVariantAction`), Condition Select (default NM), Quantity Number Input (default 1, min 1, max 999), buttons "Add" and "Cancel". On success close and return focus to the combobox input. Field errors render in the Field's error part.
  - `RowMenu`: ui-sdk Menu on a "⋯" button with `aria-label="Actions for <card name>"`: "Edit" opens `EditDialog`; "Remove" opens an ui-sdk Alert Dialog: title "Remove <card name>?", body "This removes all <quantity> from your collection.", actions "Remove" and "Cancel".
  - `EditDialog`: variant, condition, quantity, paid price per copy (text, parsed with `parseUsd`), acquired date (native `type="date"` inside a Field), binder (text). "Save" and "Cancel".
  - The full add flow works by keyboard alone: type, Down Arrow, Enter, Tab through the form, Enter.

- [ ] **Step 1:** Read the ui-sdk Combobox, Dialog, Alert Dialog, Menu, Field and Number Input pages.
- [ ] **Step 2: Write failing tests**

```ts
// addCardAction: valid input → ok, row exists, snapshotCard called once with today's Chicago date
// addCardAction: snapshot already exists for today → snapshotCard not called
// addCardAction: snapshotCard throws → still { ok: true }, row exists
// addCardAction: quantity 0 → { ok: false, field: 'quantity' }, no row, snapshotCard not called
// updateItemAction: collision → { ok: false, field: 'variant' }
// removeItemAction: row gone
// search route: q='chariz' → 200 array; q missing → 200 []
// AddCard (jsdom, fetch stubbed): typing 'char' shows the option; ArrowDown + Enter opens the form titled 'Charizard ex'
// AddCard: response for an older query arriving late does not replace newer results
// AddCard: card with variants [] offers only 'Normal'
// agent test from the ui-sdk skill's agent-ready reference for the collection screen
```

- [ ] **Step 3:** Run — FAIL. **Step 4:** Implement. **Step 5:** Run tests, typecheck, `next build` — PASS.
- [ ] **Step 6:** Check contrast and keyboard flow in a real browser against a PGlite- or Neon-dev-backed dev server seeded from the fixtures (`pnpm --filter web dev`), per the ui-sdk skill.
- [ ] **Step 7:** Commit `feat(web): add, edit and remove cards`.

### Task 11: NAS runner, CI, and go-live runbook

**Files:**
- Create: `docker/Dockerfile`, `docker/crontab`, `docker/compose.yaml`, `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- `Dockerfile` (build context = repo root, `linux/amd64`): build stage installs with pnpm and runs the jobs build; runtime stage is `node:22-alpine` with `tzdata`, supercronic, `dist/cli.js`, and the `packages/db/drizzle` migrations. `ARG GIT_SHA` → `ENV GIT_SHA`. `ENV TZ=America/Chicago RUNNER=nas`. Entrypoint: supercronic with `docker/crontab`.
- `crontab`: `0 2 * * * node /app/cli.js nightly`.
- `compose.yaml`: service `poketrack-jobs`, image `ghcr.io/<owner>/poketrack-jobs:latest`, `restart: unless-stopped`, `env_file: .env` (`DATABASE_URL`, `POKEMONTCG_API_KEY`).
- `ci.yml`: on every push and PR: install, `pnpm typecheck`, `pnpm test`. On push to `main` after tests pass: build the image with `GIT_SHA=${{ github.sha }}` and push to GHCR tagged `latest` and the sha.
- `README.md` runbook, in this order: prerequisites (Node 22, pnpm); `pnpm install`; create Neon project with `main` and `dev` branches; copy `.env.example` to `.env`; `pnpm db:migrate`; `pnpm jobs backfill` (expect several minutes); `pnpm --filter web dev`; Vercel setup (root directory `apps/web`, env vars `DATABASE_URL`, `POKEMONTCG_API_KEY`, `CRON_SECRET`, enable Deployment Protection); NAS setup (GHCR login with a read-only token, copy `compose.yaml` and `.env`, `docker compose up -d`); updating the NAS (`docker compose pull && docker compose up -d`); the done check ("add 20 cards, and the next morning Settings shows an `ok` run from `nas` and the collection shows a change figure").

- [ ] **Step 1:** Write the files.
- [ ] **Step 2:** Verify: `docker build -f docker/Dockerfile --build-arg GIT_SHA=test .` succeeds; `docker run --rm <image> node /app/cli.js nightly` with no env exits 2 and names `DATABASE_URL`. If Docker is unavailable in the workspace, say so in the handoff and leave this for CI.
- [ ] **Step 3:** Commit `feat: NAS runner, CI and runbook`.
- [ ] **Step 4 (HB, live):** follow the README runbook through the done check. Report anything where the live API differs from the fixtures.
