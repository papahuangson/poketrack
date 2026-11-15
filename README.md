# Poketrack

A single-user web app for cataloging a Pokémon card collection and tracking its value.

Phase 1 covers a mirrored card catalog, adding cards by search, nightly prices and the collection screen. The design and plan are in `docs/superpowers/`.

```
apps/web        Next.js app (collection screen, settings, cron route)
packages/db     Drizzle schema and migrations
packages/jobs   pokemontcg.io provider, catalog sync, price refresh, run lock, CLI
docker/         NAS runner image
```

## First-time setup

You need Node 22 and pnpm 10 (`corepack enable` gives you pnpm).

1. **Install.** `pnpm install`
2. **Database.** Create a Neon project. Keep the default `main` branch for production and add a `dev` branch for local work.
3. **API key.** Get a free key at https://dev.pokemontcg.io.
4. **Environment.** Copy `.env.example` to `.env` in the repo root and to `apps/web/.env.local`. Fill in `DATABASE_URL` (the `dev` branch connection string) and `POKEMONTCG_API_KEY` in both. `pnpm db:migrate` and `pnpm jobs …` read the root `.env`; the web app reads `apps/web/.env.local`.
5. **Create the tables.** `pnpm db:migrate`
6. **Load the catalog.** `pnpm jobs backfill` fetches every set and card. Expect it to take several minutes. It is safe to re-run.
7. **Run the app.** `pnpm --filter web dev`, then open http://localhost:3000.

Before going live, repeat steps 5 and 6 once against the `main` branch. A variable set in your shell overrides `.env`, so in PowerShell:

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
| `pnpm jobs backfill` | Full catalog load. |
| `pnpm jobs nightly` | One nightly run: claim the run, sync changed sets, refresh prices for owned and watched cards. |
| `pnpm db:generate` | Generate a migration after changing `packages/db/src/schema.ts`. |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL`. |

## Vercel

1. Import the GitHub repo and set the **root directory** to `apps/web`.
2. Add environment variables: `DATABASE_URL` (Neon `main`), `POKEMONTCG_API_KEY`, and `CRON_SECRET` (any long random string).
3. Turn on **Deployment Protection**. The app has no login of its own, so this is the only thing keeping it private.
4. **Check that it worked.** Open your production address (`<project>.vercel.app`) in a private browser window. You should be asked to log in to Vercel. If the collection loads instead, the production address is not covered by your plan's protection level, and anyone with the link can view and change your collection. Do not leave it that way: raise the protection level, or hold off on real data until the app has a passcode.
5. After the first deploy, run `vercel crons run /api/cron/nightly` and confirm a row appears on the Settings page (or that the NAS already ran that night).

`apps/web/vercel.json` schedules `/api/cron/nightly` for 10:00 UTC, which is 4:00 AM Central in winter and 5:00 AM in summer. It only does the work when the NAS has not already finished that night's run.

## NAS

The NAS is the primary runner. Every push to `main` builds `ghcr.io/papahuangson/poketrack-jobs` in GitHub Actions.

1. On GitHub, create a personal access token with `read:packages`.
2. On the NAS: `docker login ghcr.io -u papahuangson` and paste the token.
3. Make a folder, for example `/volume1/docker/poketrack`, and copy `docker/compose.yaml` into it.
4. Next to it, create `.env` with `DATABASE_URL` (Neon `main`) and `POKEMONTCG_API_KEY`.
5. `docker compose up -d`

The container runs the nightly job at 2:00 AM Central and logs to `docker logs poketrack-jobs`.

**Updating the NAS.** `docker compose pull && docker compose up -d`. The Settings page warns when the NAS last ran a different version than the deployed site.

**Run it once by hand.** `docker exec poketrack-jobs node /app/cli.cjs nightly`

## How the two runners stay in step

Each run starts by inserting a row into `job_runs` for that calendar date (Central time). Only the runner whose insert succeeds does the work. The other may take over only when the row is `failed`, or has been `running` for more than an hour. Every step is an upsert, so a takeover partway through causes no duplicates.

## Done check for Phase 1

Add 20 cards. The next morning, Settings should show an `ok` run from `NAS`, and the collection total should show a change figure.
