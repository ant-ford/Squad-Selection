# Migration: Direct Airtable Access → Cloudflare Worker API

## Result

```
React App  →  Cloudflare Worker (hkfc-api)  →  Airtable
```

The browser bundle contains no Airtable token, no Airtable base ID, and no
`airtable` npm package. Every read/write goes through
`https://hkfc-api.squad-selections.workers.dev`.

A scoped `tsc --strict --noEmit` pass over every new/changed file (Worker +
frontend data-access layer) passes with **zero errors**.

---

## 1. New Worker files (`worker/src/`)

| File | Purpose |
|---|---|
| `airtable.ts` | Low-level REST client: `airtableList`, `airtableFindAll` (paginated), `airtableFindById`, `airtableCreate`, `airtableUpdate`, `airtableDelete`, `AirtableError`, `linkId()`, `escapeFormulaValue()`. The **only** file that holds the Airtable token. |
| `http.ts` | `json()`, `errorJson()`, `handleOptions()`, CORS headers, `HttpError`, `requireParam()`. |
| `reference.ts` | `getReferenceData` (Teams + People join, cached 10 min), `getPlayerByEmail`, `getActivePlayers`. |
| `eligibility.ts` | `evaluatePlayerEligibility` — moved verbatim from the old `src/api/getPlayersForMatch.ts` private helper (it wasn't shared/exported before, so this isn't a duplication, just a relocation). |
| `fixtures.ts` | `getMyFixtures`, `getPlayerFixtures`, `getUpcomingFixtures` — ported 1:1 from the equivalent `src/api/*.ts` files. |
| `squad.ts` | `getPlayersForMatch`, `selectPlayer`, `removeSelection` — ported 1:1. |
| `availability.ts` | `setAvailability`, `setMyAvailability` — ported 1:1, with corrected Airtable field payloads (see Bugs Fixed below). |
| `index.ts` | Router: matches method + path, wraps everything in CORS + `try/catch` → consistent `{ error }` JSON on failure. |
| `tsconfig.json` | Editor/type-check support (Wrangler bundles with esbuild regardless). |
| `.dev.vars.example` | Template for local `wrangler dev` secrets. |

**No duplicated mapping logic.** Per your instruction, the Worker does **not**
have its own copy of field maps or mappers. It imports directly from the
existing frontend modules:

```ts
import { TABLES } from "../../src/generated/tableNames";
import { PEOPLE_FIELDS, SQUADSELECTIONS_FIELDS, AVAILABILITYEXCEPTIONS_FIELDS } from "../../src/generated/fieldMaps";
import { mapPlayer } from "../../src/mappers/playerMapper";
import { mapTeam } from "../../src/mappers/teamMapper";
import { mapMatch } from "../../src/mappers/matchMapper";
import { mapSelection } from "../../src/mappers/selectionMapper";
import { mapAvailability } from "../../src/mappers/availabilityMapper";
import { getCached } from "../../src/lib/cache";
```

These are plain TypeScript (no browser APIs), so Wrangler's esbuild bundler
pulls them into the Worker bundle unmodified. `src/generated/domainTypes.ts`
is imported as types only (zero runtime cost). One consequence: **the Worker
and the frontend are no longer independently movable** — if `src/mappers/`
or `src/generated/` are relocated, update the two `../../src/...` import
sites in `worker/src/*.ts`.

## 2. Modified frontend files

| File | Change |
|---|---|
| `src/lib/apiClient.ts` **(new)** | Shared `apiGet` / `apiPost` wrapper around `fetch(VITE_API_URL + path)`, with a typed `ApiError`. Every `src/api/*.ts` file uses this instead of a repository. |
| `src/lib/auth.ts` | `getCurrentPeople()` now calls `apiGet('/api/player-by-email', { email })` instead of `peopleRepository.getByEmail()`. |
| `src/api/getClubReferenceData.ts` | Calls `GET /api/reference-data`; the Teams+People join moved server-side. Return type simplified to reuse `Player[]`/`Team[]` from `generated/domainTypes` directly instead of ad-hoc `CachedPlayer`/`CachedTeam` types. |
| `src/api/getMyFixtures.ts` | Calls `GET /api/my-fixtures?email=`. |
| `src/api/getPlayerFixtures.ts` | Calls `GET /api/player-fixtures/:playerId`. |
| `src/api/getUpcomingFixtures.ts` | Calls `GET /api/upcoming-fixtures?email=&team=`. |
| `src/api/getPlayersForMatch.ts` | Calls `GET /api/match/:matchId/players`. |
| `src/api/selectPlayer.ts` | Calls `POST /api/select-player` with `{ matchId, playerId, selectionStatus, actingEmail }`. |
| `src/api/removeSelection.ts` | Calls `POST /api/remove-selection` with `{ selectionId }`. |
| `src/api/setAvailability.ts` | Calls `POST /api/set-availability`. |
| `src/api/setMyAvailability.ts` | Calls `POST /api/set-my-availability`. |
| `src/api/getMyProfile.ts` | Unchanged data-access-wise (never touched Airtable directly) — only touched to satisfy stricter optional-field typing on `Team`. |
| `src/generated/fieldMaps.ts` | Added the missing `updatedBy: "Updated By"` mapping (see Bugs Fixed). |
| `package.json` | Removed the `airtable` dependency (no longer used anywhere in `src/`). |
| `worker/package.json` | Real scripts (`dev`, `deploy`, `typecheck`), added `@cloudflare/workers-types` + `typescript` devDependencies, `"type": "module"`. |
| `worker/wrangler.toml` | Added `[vars] AIRTABLE_BASE_ID`, documented `ALLOWED_ORIGIN` and the `wrangler secret put AIRTABLE_TOKEN` step. |

**Every page/component (`src/pages/*.tsx`, `src/components/*.tsx`,
`CoachLayout.tsx`, `App.tsx`, etc.) is untouched.** All the `src/api/*`
function signatures kept the same parameters and return shapes, so nothing
that calls them needed to change.

## 3. Files deleted (safe to delete)

```
src/services/airtable.ts
src/repositories/baseRepository.ts
src/repositories/peopleRepository.ts
src/repositories/teamsRepository.ts
src/repositories/matchesRepository.ts
src/repositories/selectionsRepository.ts
src/repositories/availabilityRepository.ts
src/repositories/index.ts
src/api/playersApi.ts        (dead code — nothing imported it; superseded by apiClient.ts)
worker/src/players.ts        (folded into worker/src/reference.ts)
```

`src/generated/*` and `src/mappers/*` are **kept** (per your instruction)
and are now actively imported by the Worker — not vestigial.

## 4. Endpoint reference

| Method | Path | Params | Notes |
|---|---|---|---|
| GET | `/api/players/active` | — | kept for backward compatibility |
| GET | `/api/reference-data` | — | `{ players, teams, teamRankMap, teamNames }`, cached 10 min |
| GET | `/api/player-by-email` | `?email=` | 404 if not found |
| GET | `/api/my-fixtures` | `?email=` | |
| GET | `/api/player-fixtures/:playerId` | — | unauthenticated (Fillout URL flow) |
| GET | `/api/upcoming-fixtures` | `?email=&team=` (both optional) | `team` overrides coach-team filtering |
| GET | `/api/match/:matchId/players` | — | full eligibility-annotated player list |
| POST | `/api/select-player` | `{ matchId, playerId, selectionStatus, actingEmail? }` | re-validates eligibility server-side |
| POST | `/api/remove-selection` | `{ selectionId }` | |
| POST | `/api/set-availability` | `{ playerId, matchIds[], status, notes? }` | coach bulk update |
| POST | `/api/set-my-availability` | `{ email, matchId, status, notes?, existingExceptionId? }` | player self-service |

All responses are JSON; errors are `{ "error": "message" }` with an
appropriate status code (400/404/409/422/500).

## 5. Environment variables

**Frontend (`.env.local`, see `.env.example`):**
```
VITE_API_URL=https://hkfc-api.squad-selections.workers.dev
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
`VITE_AIRTABLE_TOKEN` / `VITE_AIRTABLE_BASE_ID` must be removed from
`.env.local` **and** from your Cloudflare Pages project's environment
variable settings (wherever the frontend is actually deployed from) — an
env var that's merely unused in code but still set in the build
environment isn't a leak, but there's no reason to keep it configured.

**Worker (`worker/.dev.vars` locally / `wrangler secret` in production, see `worker/.dev.vars.example`):**
```
AIRTABLE_TOKEN=...        # secret — wrangler secret put AIRTABLE_TOKEN --config worker/wrangler.toml
AIRTABLE_BASE_ID=appG6amyHthm3Nnde   # not sensitive, already in wrangler.toml [vars]
ALLOWED_ORIGIN=...        # optional, defaults to "*"
```

## 6. Bugs fixed while porting the write endpoints

These were pre-existing issues in `src/repositories/*` + `src/api/selectPlayer.ts` /
`setAvailability.ts` / `setMyAvailability.ts`, found while porting the logic
into the Worker. None of these are new behavior changes beyond "the write
now actually reaches Airtable correctly":

1. **`AVAILABILITYEXCEPTIONS_FIELDS` was missing `updatedBy`.** The old code
   wrote `updatedBy: user.id` but there was no field-name mapping for it, so
   it was silently dropped. Fixed in `src/generated/fieldMaps.ts` (now
   `updatedBy: "Updated By"`), shared by both the Worker and (if ever
   needed again) the frontend.
2. **Write payloads used camelCase keys instead of real Airtable column
   names.** `baseRepository.create()`/`.update()` passed objects like
   `{ match: matchId, availabilityStatus: status }` straight to Airtable's
   REST API, which only recognizes the actual column names (`"Match"`,
   `"Availability Status"`, etc.). The Worker's `selectPlayer`/
   `setAvailability`/`setMyAvailability` now build payloads keyed by the
   `*_FIELDS` constants.
3. **Link fields weren't arrays.** Airtable's `multipleRecordLinks` fields
   (`Match`, `Player`, `Selected By`, `Updated By`) must be written as
   `["recXXXX"]`, not a bare string. Fixed in the same write paths.
4. **`selectedAt` was being set manually.** `"Selected At"` is a
   `createdTime` formula field in the schema — Airtable rejects or ignores
   writes to it. Removed from the create payload; Airtable sets it
   automatically.
5. **`getActivePlayers` didn't paginate.** The old `worker/src/players.ts`
   fetched a single page (≤100 records via `airtableRequest`). The new
   `airtableFindAll()` follows `offset` until exhausted.

## 7. Deployment steps

1. `wrangler secret put AIRTABLE_TOKEN --config worker/wrangler.toml`
2. Confirm/update `AIRTABLE_BASE_ID` in `worker/wrangler.toml` `[vars]`.
3. (Optional) set `ALLOWED_ORIGIN` in `worker/wrangler.toml` to your Pages domain.
4. `npm run deploy:api` (root script → `wrangler deploy --config worker/wrangler.toml`).
5. Set `VITE_API_URL` (and Supabase vars) in your frontend's `.env.local` /
   Pages project settings, per `.env.example`.
6. Remove any `VITE_AIRTABLE_TOKEN` / `VITE_AIRTABLE_BASE_ID` settings from
   the frontend hosting environment.
7. `npm install` at the repo root to refresh `package-lock.json` now that
   `airtable` has been removed from `package.json`.
8. `npm run deploy:web` (or your normal Pages deploy).
9. Smoke test (see §9).

## 8. Known limitations carried over unchanged

Not introduced by this migration — these were true before it too, and this
refactor deliberately only replaces the data-access layer, not the
eligibility engine:

- Play-up counts always return `0`; goalkeeper/U21 exemptions, same-day
  cross-team conflict badges, and cup rules are still Phase 3 work per
  `Implementation_Roadmap_v2.md`.
- `getPlayersForMatch` still doesn't check that the caller is actually a
  coach — it never did.
- Endpoints that need "the current user" (`my-fixtures`,
  `upcoming-fixtures`, `select-player`, `set-my-availability`) trust a
  client-supplied `email` rather than verifying the Supabase JWT
  server-side. Moving the Airtable token out of the browser (this
  migration) is the main security improvement in scope; verifying the
  Supabase access token in the Worker (e.g. against Supabase's JWKS) would
  be a good follow-up before this is exposed to less-trusted users.
- Several services still do a full-table `airtableFindAll` on Squad
  Selections / Availability Exceptions with no formula filter, matching the
  original `repository.findAll({})` behavior, rather than querying just the
  relevant match. Fine at current data volume; worth an index-style formula
  filter later if the tables grow large.
- `Zite_Code.md` is a stale snapshot from before this migration and still
  shows the old client-side Airtable wiring pattern. It's not a live
  credential leak (the Airtable token shown is redacted, and the Supabase
  key is a public-safe "publishable" anon key by design), but it's worth
  deleting or updating so nobody copies the old pattern by accident.

## 9. Smoke test before merging

- [ ] `wrangler dev --config worker/wrangler.toml` (with `worker/.dev.vars`
      filled in) and `curl` each endpoint in §4.
- [ ] `npm run dev` against that local Worker (`VITE_API_URL=http://localhost:8787`)
      and walk through: login → player dashboard → update availability →
      coach view → fixture list → squad selection → select / reserve /
      remove a player.
- [ ] Browser devtools Network tab shows **zero** requests to
      `api.airtable.com` — everything goes to the Worker origin.
- [ ] `npm run build` then `grep -r "airtable" dist/` (case-insensitive)
      returns nothing, and the bundle contains no Airtable token substring.
