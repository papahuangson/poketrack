# Poketrack

A single-user web app for cataloging a Pokémon card collection and tracking its value.

Phase 1 covers a mirrored card catalog, adding cards by search, nightly prices and the collection screen. The design and plan are in `docs/superpowers/`.

```
apps/web        Next.js app (collection screen, settings, cron route)
packages/db     Drizzle schema and migrations
packages/jobs   TCGdex provider, catalog sync, price refresh, run lock, CLI
docker/         NAS runner image
```

## First-time setup

You need Node 22 and pnpm 10 (`corepack enable` gives you pnpm).

1. **Install.** `pnpm install`
2. **Database.** Create a Neon project. Keep the default `main` branch for production and add a `dev` branch for local work.
3. **Environment.** Copy `.env.example` to `.env` in the repo root and to `apps/web/.env.local`. Fill in `DATABASE_URL` (the `dev` branch connection string) in both. `pnpm db:migrate` and `pnpm jobs …` read the root `.env`; the web app reads `apps/web/.env.local`. Card data needs no API key.
4. **Create the tables.** `pnpm db:migrate`
5. **Load the catalog.** `pnpm jobs backfill` fetches every set and card from TCGdex: about 22,000 requests, a few minutes. It prints one line per set. If it stops partway, run it again and it resumes with the sets that have not loaded. `pnpm jobs backfill --full` reloads everything.
6. **Run the app.** `pnpm --filter web dev`, then open http://localhost:3000.

Before going live, repeat steps 4 and 5 once against the `main` branch. A variable set in your shell overrides `.env`, so in PowerShell:

```powershell
$env:DATABASE_URL = "postgres://…main…"
pnpm db:migrate
pnpm jobs backfill
Remove-Item Env:DATABASE_URL
```

Use Neon's direct connection string for `pnpm db:migrate` and the pooled one for Vercel.

## Commands

| Command | What it does |
|---|---|
| `pnpm test` | All tests. They use an in-memory Postgres and saved API responses, so they need no network. |
| `pnpm typecheck` | Type-checks every package. |
| `pnpm jobs backfill` | Catalog load; resumes if interrupted. Add `--full` to reload every set. |
| `pnpm jobs nightly` | One nightly run: claim the run, sync changed sets, refresh prices for owned and watched cards. |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema.ts`. |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL`. |

## Vercel

1. Import the GitHub repo and set the **root directory** to `apps/web`.
2. Add environment variables: `DATABASE_URL` (Neon `main`) and `CRON_SECRET` (any long random string).
3. Add the Phase 2 variables:
   - `APP_PASSCODE`: the passcode you'll type to open the app.
   - `SESSION_SECRET`: any long random string. It signs the sign-in cookie. Changing it, or changing the passcode, signs every device out.
   - `ANTHROPIC_API_KEY`: reads scan photos.
   - `ANTHROPIC_MODEL` (optional): the model for scans. Defaults to `claude-sonnet-5-5`.
   Set them for both Production and Preview. If the passcode or secret is missing, the app shows only the login page.
4. In the project's **Storage** tab, create a **Blob** store and connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`, which scan photo uploads need.
5. Run `pnpm db:migrate` against the Neon `main` branch so the scan tables exist, then deploy.
6. Open the production address in a private window. You should land on the passcode page, and the passcode should open the collection. Once that works, turn **off** Deployment Protection for Production so your phone can reach the app without a Vercel sign-in. Preview deployments can keep it on.
7. After the first deploy, run `vercel crons run /api/cron/nightly` and confirm a row appears on the Settings page (or that the NAS already ran that night).

`apps/web/vercel.json` schedules `/api/cron/nightly` for 10:00 UTC, which is 4:00 AM Central in winter and 5:00 AM in summer. It only does the work when the NAS has not already finished that night's run.

## NAS

The NAS is the primary runner. Every push to `main` builds `ghcr.io/papahuangson/poketrack-jobs` in GitHub Actions.

1. On GitHub, create a personal access token with `read:packages`.
2. On the NAS: `docker login ghcr.io -u papahuangson` and paste the token.
3. Make a folder, for example `/volume1/docker/poketrack`, and copy `docker/compose.yaml` into it.
4. Next to it, create `.env` with `DATABASE_URL` (Neon `main`).
5. `docker compose up -d`

The container runs the nightly job at 2:00 AM Central and logs to `docker logs poketrack-jobs`.

**Updating the NAS.** `docker compose pull && docker compose up -d`. The Settings page warns when the NAS last ran a different version than the deployed site.

**Run it once by hand.** `docker exec poketrack-jobs node /app/cli.cjs nightly`

## Card data

Catalog and prices come from [TCGdex](https://tcgdex.dev), which is free and needs no key. Prices are TCGplayer market prices in USD, with the Cardmarket trend in EUR alongside. Card IDs are TCGdex's (`sv03.5-199`).

- TCGdex has no "last updated" stamp on sets, so the nightly job re-fetches a set's cards only when its card count changes. A correction to an existing card (a rarity fix, say) reaches cards you own on the next nightly run, and everything else on the next `pnpm jobs backfill --full`.
- Pokémon TCG Pocket sets are skipped, since they are digital.
- `packages/jobs/src/providers/pokemontcgio.ts` is the earlier provider, kept but unused. pokemontcg.io stopped issuing API keys and uses different card IDs, so switching back means reloading the catalog.

## How the two runners stay in step

Each run starts by inserting a row into `job_runs` for that calendar date (Central time). Only the runner whose insert succeeds does the work. The other may take over only when the row is `failed`, or has been `running` for more than an hour. Every step is an upsert, so a takeover partway through causes no duplicates.

## Done check for Phase 1

Add 20 cards. The next morning, Settings should show an `ok` run from `NAS`, and the collection total should show a change figure.

## Scanning binder pages (Phase 2)

On your phone, open the app, sign in with the passcode, and tap **Scan a page**. Pick the binder, check the page number, and take a photo of the whole 9-pocket page. After about 10–30 seconds the review grid appears:

- Matches the app is sure of are already ticked. Pockets marked **Check** need you to pick the card.
- Arrow keys move between pockets, Enter confirms, and X rejects. On a phone, use the buttons.
- **Typed in earlier, use that copy** moves a card you entered by hand into this binder instead of counting it twice.
- Scanning a page you've already added replaces what that page added before. The grid shows what will change before you tap **Replace page**.

## Done check for Phase 2

Scan 3 real binder pages, including one with holo cards in sleeves. Each page should need **2 or fewer corrections**: a pocket where you picked a different card, rejected a card that was there, or had to search for it.

Write the line from the **Scans** page here when you've done it:

> First guess right: _ of _ pockets (_%)

If a page needs more than 2 corrections, see "Later" in `docs/superpowers/specs/2026-11-15-poketrack-phase-2-design.md` (a second, close-up read of unclear pockets).

