# Agent prompt: simplify and harden HKFC Squad Selection

You are working in the repository at the current directory (React 19 + Vite frontend in `src/`, Cloudflare Worker API in `worker/src/`, Supabase for identity only, Airtable for data, vitest tests in `tests/`). Read `docs/APP_REVIEW_2026-09-06.md` first; it contains the findings this prompt is based on, with file and line references.

## Goal

Make the app **sleek and simple**: remove dead and dormant code, collapse duplicated logic into single implementations, fix the confirmed bugs, and make the docs match the code. **Do not add features.** The result should be a smaller codebase that does exactly what the current one does for users, minus the bugs.

## Non-negotiable rules

1. **No user-visible feature changes** other than the bug fixes listed in Phase 2. If a change would alter what a coach or player sees or can do, stop and leave a note in the final report instead.
2. **Eligibility semantics are frozen.** `tests/golden-eligibility.test.ts` and `tests/eligibility.test.ts` must pass unchanged in their assertions (you may only move shared factories into helpers). Do not reorder the 8 steps in `worker/src/eligibility.ts` or alter any reason string.
3. **No new runtime dependencies.** Removing dependencies is encouraged.
4. **Run the full pipeline after every phase** and do not proceed while it is red:
   ```
   npx tsc --noEmit
   npx tsc --noEmit -p worker/tsconfig.json
   npx vitest run
   npx vite build
   ```
5. **One commit per phase** on a new branch `cleanup/simplify` created from `main`. Commit messages: short imperative summary, then a bullet per notable change. Do not push.
6. When you delete a route, function, hook, component, or export, **grep for every reference** (`src/`, `worker/src/`, `tests/`, `README.md`, `docs/`) and remove or update them in the same commit. A failing import in a test after deletion is the expected signal; fix the test, don't skip it.
7. Prefer deleting over abstracting. Introduce a shared helper only when it replaces two or more existing copies.
8. Keep comments that explain *why*. Delete comments that record history ("was missing", "reverted per feedback", "backwards-compatible").
9. If something in this prompt turns out not to match the code, follow the code, note the discrepancy in the report, and continue.

## Owner decisions already made

- **Remove** the automatic re-registration service (`worker/src/registration.ts`, cron, `scheduled()` handler, `AUTO_REGISTRATION_ENABLED`, `/api/registration/reconcile`, `tests/registration.test.ts`, `tests/registrationRoutes.test.ts`, README/roadmap sections). It has never been enabled; the 4th-play-up block in `eligibility.ts` already delivers the user-visible rule. Leave a one-paragraph note in README under "Removed features" saying it can be restored from git history (commit hash of the removal).
- **Keep** the recommendations panel, auto-select, WhatsApp notify, season stats, calendar feeds, kit colour. Fix their bugs; do not remove them.
- **Keep** the two-Worker deployment (assets Worker + API Worker) for now. Do not attempt to merge them.

---

## Phase 0 — Baseline

1. Run the four verification commands and record: test file count, test count, build chunk sizes (the `index-*.js` size in particular).
2. Create branch `cleanup/simplify`.
3. Produce `docs/cleanup-baseline.txt` with those numbers plus `git rev-parse HEAD`. You will compare against it at the end.

---

## Phase 1 — Delete dead code, dormant features, dead config

### 1a. Worker routes with no caller (verify each with grep over `src/` before deleting)

Remove these routes from `worker/src/index.ts` and delete the handler functions they were the only callers of:

- `GET /api/eligibility-metrics`, `POST /api/eligibility-metrics/reset` → delete `worker/src/metrics.ts`, `worker/src/perf.ts`, `countAirtableCall()` in `airtable.ts`, the timing wrappers in `auth.ts` (the `user.perf` object is never read), and the `evaluatePlayerEligibility` metrics wrapper at the bottom of `eligibility.ts` (keep the underlying evaluator; rename if needed so callers still resolve). Delete `tests/perf.test.ts`. Rename `tests/cachePerf.test.ts` → `tests/cache.test.ts` (it is a correctness test).
- `GET /api/player-fixtures/:id` (route only; `getPlayerFixtures` stays because `calendar.ts` uses it).
- `GET /api/players/active`, `GET /api/reference-data`, `GET /api/player-by-email`.
- `GET /api/recent-availability` and `getRecentAvailability` in `dashboard.ts` (hardcoded empty stub).
- `POST /api/select-player`, `POST /api/remove-selection` → delete `selectPlayer` and `removeSelection` in `squad.ts`.
- `POST /api/set-availability` (coach bulk route). Keep the internal function only if Phase 3d uses it as the single upsert; otherwise delete.
- `POST /api/ranking/backfill` alias (keep `/api/ranking/initialize`).
- `GET /api/calendar/team.ics` (`handleTeamCalendarExport`); keep `team-link` and `team-feed.ics`.
- `POST /api/registration/reconcile` and everything listed under "Owner decisions" for registration, including the `[triggers] crons` block in `worker/wrangler.toml` and the `scheduled` export.
- Delete the selection-event log block in `squad.ts` (the `try { const events ... }` block around lines 241-271, capped at 10 rows, never read) and the `SELECTION_EVENTS_*` constants at the top of that file.
- In `eligibility.ts`: delete `REASON_TAGS`, `lookupReasonTag`, `reasonTag`/`warningTags` outputs, the `trace` option and all `t(...)` calls, and the unread `EvaluationContext` fields `allSelections`, `allExceptions`, `sameDayMatches`. Each rule check should return `{ ruleId, reason }` directly. Update the golden test only if it passed `{ trace: true }`; it must still assert the same statuses and reasons.

### 1b. Frontend dead code

Delete: `src/lib/auth.ts`; `src/api/removeSelection.ts`; `src/components/shared/AvailabilityChip.tsx` (and its export in `shared/index.ts`); in `src/lib/queries.ts` the `authGet` wrapper (call `apiGet` directly), `useMoveRanking`, `useMoveRankingRelative`, `useInitializeRanking`, `useRecentAvailability`, `RecentAvailabilityChange`, and the unused `RecentChange` import; in `src/lib/readiness.ts` everything except `detectSameDayConflicts`, `SameDayConflict`, and `playUpWatchLabel` (update `tests/readiness.test.ts` accordingly); `proposedDirection` in `rankingHistory.ts`; the `bulkSelectMode`/`onToggleBulk` props in `PlayerFilters.tsx`; the `variant`/`size` props in `ui/button.tsx`; the `open === undefined` shim in `ui/sheet.tsx` (make `open` required); the three `dark:` variants in `PlayerRanking.tsx`. Remove the `existingExceptionId` parameter from `src/api/setMyAvailability.ts` and its callers **only if** Phase 3d removes it from the worker; otherwise leave it.

Also delete the corresponding worker routes' frontend hooks if any remain (e.g. `useInitializeRanking` has no caller; if `/api/ranking/initialize` then has no caller either, delete that route too and note it).

### 1c. Config and dependencies

- Delete `tailwind.config.ts` (Tailwind v4 ignores it; all tokens live in `src/index.css`).
- `npm uninstall zod @supabase/ssr tailwindcss-animate autoprefixer`; remove `autoprefixer` from `postcss.config.js`.
- Delete `worker/package.json` and `worker/package-lock.json`. Change root `package.json` scripts: `typecheck:worker` → `tsc --noEmit -p worker/tsconfig.json`; `dev:api` and `deploy:api` already point at `worker/wrangler.toml`, keep them.
- In `worker/tsconfig.json` remove `"node"` from `types`; replace the hand-listed `../src/lib/*.ts` includes with the directory the shared code lives in after Phase 3h.
- Remove `"references": []` from root `tsconfig.json`.
- In `worker/wrangler.toml` add `[observability] enabled = true` and remove `account_id` (wrangler resolves it from login). Add `worker/.dev.vars.example` containing `ALLOWED_ORIGIN=http://localhost:5173` and reference it in README's local-dev steps.
- Delete `tests/toggleSelection.test.ts` (it tests a function defined inside the test file).

### 1d. Verify, commit

Expect a large negative diff and every test still green (fewer tests, because deleted suites were for deleted code).

---

## Phase 2 — Fix confirmed bugs

Each item: fix, then add or extend a test in `tests/` that would have failed before the fix (worker bugs) or a pure-helper test where the logic is extractable (frontend bugs).

### Worker

1. **Background writes** — `worker/src/rankingEvents.ts` (`void (async () => ...)` around lines 100-133) and the two `recordRankingEvents(...)` calls in `ranking.ts` that are not awaited: `await` them. Remove the `catch(() => {})` swallow so failures surface as 502 via the normal error path. Extend `tests/rankingEvents.test.ts` to assert the event batch is created before the response resolves (replace the `setTimeout` tick with a direct await).
2. **Squad sheet side** — `worker/src/index.ts` route `GET /api/match/:id/squad`: read `url.searchParams.get("side")` exactly as the `/players` route does and pass it to `getSquadForMatch`. Test: home vs away derby returns the respective list.
3. **`activatePlayer` rank hole** — `worker/src/ranking.ts`: if the player already appears in `fetchActiveRankingFromAirtable` (Applicant with a `sectionRank`), only set `Active=true` and keep the rank; otherwise append at N+1. After activate and deactivate, renumber the active list 1..N using the existing batch-update machinery from `reorderRanking`. Test: activating an in-list Applicant leaves ranks contiguous.
4. **Recommendations target team** — `worker/src/recommendations.ts:160-164`: `const targetTeamName = match.hkfcTeam;` and remove the `?? 12` fallback (throw a 400 with a clear message if the team rank is unknown). Extend `tests/recommendations.test.ts` with an HKFC-away fixture.
5. **One Hong Kong date key** — create `hkDateKey(iso: string): string` (YYYY-MM-DD in `Asia/Hong_Kong` via `Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong" })`) in the shared code directory. Replace `.split("T")[0]` in `seasonContext.ts`, `fixtures.ts`, `availability.ts`, `src/pages/PlayerDashboard.tsx` (`dateKey`), and `safeFormat(f.date, 'yyyy-MM-dd')` in `src/pages/FixtureList.tsx`. Make `currentSeason()` use the HKT month. Test: a 03:00 HKT kick-off is grouped with the HKT date, not the UTC one.
6. **Stop swallowing Airtable errors** — remove the try/catch in `getAvailabilityForMatch` (`squad.ts` ~442-446) and the silent fallback in the play-up gate in `fixtures.ts` (~332-335). Errors propagate.
7. **Single coach derivation** — in `worker/src/auth.ts`, `requireAuthorizedUser` returns an `AuthorizedUser` with `id`, `email`, `role`, `coachTeams: string[]`, `isSectionCaptain: boolean`, computed from team `Coach` and `Section Captain` links only. **Delete the `Player/Coach` substring fallback.** Replace the derivations in `profile.ts`, `fixtures.ts` (both `getMyFixtures` and `getUpcomingFixtures`), and `ranking.ts` (`setAbilityGroupConfig` Section-Captain check) with the values on the request user. Section Captain sees all teams everywhere (this is the current behaviour of the most permissive path; keep it). Extend `tests/authorization.test.ts` to assert `Player/Coach` alone does not grant coach.
8. **Gate ranking history** — `GET /api/recent-changes` and `GET /api/playup-watch` → `requireCoach`. Update `tests/authorization-routes.test.ts`.
9. **Airtable client** — in `airtable.ts`: retry once on 429 honouring `Retry-After` (max 2 retries, then throw); set `AIRTABLE_WRITE_CONCURRENCY = 1` in `ranking.ts`; cache the People-by-email lookup in `auth.ts` for 60 s (the Supabase session check still runs per request). In `index.ts` map `AirtableError` to `errorJson("Upstream data service error", 502, origin, "UPSTREAM_ERROR")` and `console.error` the detail; never return the Airtable URL or body to the client.
10. **CORS** — make `ALLOWED_ORIGIN` required: throw at request time with a clear 500 if unset; remove the `|| "*"` fallback and the `apikey, x-client-info` headers from `http.ts`.
11. **Cache in-flight de-dup** — in the cache module, store the pending promise so concurrent misses share one fetch. Extend `tests/cache.test.ts`.
12. **Calendar** — compare HMAC signatures with `crypto.subtle.timingSafeEqual` (or a constant-time loop) in `calendar.ts`. Move the player display-team lookup inside the cached block (or read it from cached reference data) so a feed poll that hits cache makes no Airtable call.
13. **Route prefix** — rename `POST /squad/sync` → `POST /api/squad/sync` in `index.ts` and `src/pages/SquadSelection.tsx`.

### Frontend

14. **Auto-select uses stale availability** — `src/pages/SquadSelection.tsx`: one `computeAutoSelectIds(players)` function that runs over `mergedPlayers` (poll-merged), used by both the initial effect and `handleToggleAutoSelect`. Delete the duplicated filter in `handleToggleAutoSelect`. Extract the pure filter into `src/lib/autoSelect.ts` and add `tests/autoSelect.test.ts`.
15. **Filter URL double-encoding** — `handleFilterChange` in `SquadSelection.tsx` and `filtersToParams`/`paramsToFilters` in `PlayerFilters.tsx`: `filtersToParams` returns a `URLSearchParams` (or an object), and `handleFilterChange` merges it with `URLSearchParams` methods. Initialise `filters` from `searchParams`, not `window.location.search`. Extend `tests/playerFilters.test.ts` with a name containing a space and an ampersand round-tripping through the URL.
16. **Login page side effects** — remove `useMyProfile()` and the redirect effect from `src/pages/Login.tsx` (the effect is unreachable: `AuthGate` unmounts `Login` when the session arrives). Confirm no unauthenticated `/api/my-profile` request fires on the login page. Post-login landing stays on `/` (player view) as it does today.
17. **Radius token scale** — in `src/index.css` `@theme`, define the full scale explicitly and monotonic (`--radius-sm: 6px; --radius-md: 8px; --radius-lg: 12px; --radius-xl: 16px; --radius-2xl: 20px;`) and delete the `--radius`-derived values and the unused `--sidebar-*` and `--chart-*` tokens. Remove the `rounded-[5px]` workaround in `SeasonStats.tsx`. Visually check the login card, fixture cards, chips, and bottom sheets still look intentional (screenshots in the report).
18. **Local type copies** — delete the locally redeclared `Player`/`Fixture`/`MatchInfo` types in `PlayerRow.tsx`, `FixtureCard.tsx`, `PlayerFixtureCard.tsx`, `PlayerAvailabilitySheet.tsx`, `MatchHeader.tsx`; import `MatchPlayer`, `UpcomingFixture`, `MyFixture`, `MatchInfo` from `src/api/*`. Add `kit?: KitColour` to `MyFixture` (the worker already sends it).
19. **Derived state** — `SquadSelection.tsx`: `const hasChanges = pendingDeltas.length > 0;` (delete the state + effect). `FixtureList.tsx`: derive `activeTab` and `showPast` from `searchParams` directly; delete the `useState` + sync effect.
20. **Ranking draft protection** — `PlayerRanking.tsx`: while `draftIds` is non-null, disable Activate/Deactivate with a tooltip "Save or discard your reorder first" instead of silently `setDraftIds(null)`.

Verify, commit.

---

## Phase 3 — Consolidate duplication

### Worker

- **3a.** One `linkId` in the shared utils; delete `safeLinkId` (`eligibility.ts`), `linkedMatchId` (`playUp.ts`), `firstLinkId` (`playerStats.ts`), and `singleSelect` (identical to `linkId`; update the mappers).
- **3b.** One `hkfcSides(match, hkfcTeamNames)` helper returning `{ home?: SideInfo; away?: SideInfo }` in a new `worker/src/match.ts`. Replace `resolveHkfcSide` + wrappers in `squad.ts`, `hkfcTeamNameSafe` in `eligibility.ts`, both inline resolvers in `fixtures.ts`, and the one in `recommendations.ts`.
- **3c.** Move `currentSeason()` from `dashboard.ts` into `seasonContext.ts` next to `previousSeason()`; fix imports in `playerStats.ts`. Delete `dashboard.ts` if only `getRecentChanges` (a one-line wrapper) remains — call `getRankingEvents` directly.
- **3d.** One availability upsert: `setMyAvailability` becomes a thin call into the bulk `setAvailability` with `matchIds: [matchId]`. Remove the `existingExceptionId` "trust but verify" path and the field from the API and from `src/api/setMyAvailability.ts` + callers (`PlayerDashboard.tsx`, `PlayerAvailabilitySheet.tsx`, `PlayerFixtureCard.tsx`). Rewrite `findPlayerExceptions` in `availability.ts` to use `getScheduledMatches` + `getExceptionsForSeasons` instead of per-match `airtableFindById` + an uncached season scan.
- **3e.** Export one `UNRANKED_TEAM_RANK = 99` constant from the shared code; replace the five literals.
- **3f.** In `ranking.ts`: `initializeRanking` calls `fetchActiveRankingFromAirtable`; `annotateWithDerivedRanks` is the only team/positional counter. Delete the duplicated formula string and loop.
- **3g.** Cache invalidation: two functions in the cache module or a small `invalidation.ts` — `invalidateSelectionCaches()` and `invalidateAvailabilityCaches()` — each a coarse prefix wipe. Replace the five hand-rolled fan-outs (`squad.ts` ×2, `availability.ts`, `ranking.ts`, and any remaining). Remove the `all-matches` read that exists only to compute keys to invalidate.
- **3h.** Move shared code to `shared/` at the repo root: `src/generated/*` (rename the directory to `shared/schema/` — it is hand-maintained, see Phase 6), `src/mappers/*`, `src/lib/cache.ts` (worker-only; put it under `worker/src/cache.ts` instead), `displayTeam.ts`, `abilityGroup.ts`, `abilityRank.ts`, `airtableValueUtils.ts`, and the new `hkDateKey`. Update both tsconfigs (`paths` + `include`), `vite.config.ts` alias if needed, and all imports. Rule to add to README: `worker/src` never imports from `src/`; `src/` never imports from `worker/`.
- **3i.** Special-goalkeeper view in `fixtures.ts`: express it as "all HKFC fixtures, category `own`" through the same `buildCard` pipeline; delete `buildSpecialGoalkeeperCard` and the separate branch. `tests/gkFixtures.test.ts` must pass unchanged.
- **3j.** Move `computeSuspensionStates` into the cached `SeasonContext` so it is computed once per cache lifetime, not once per candidate side.
- **3k.** Tidy: delete the duplicated 12-line doc comment in `seasonContext.ts`; re-indent `index.ts` to two spaces; in `rankingEvents.ts` replace the hand-built fake Player (hardcoded `"Preferred Name"` etc. + `as never`) with `mapPlayer`; replace `"system"` actor sentinels with `undefined`; make `Env` live in `worker/src/env.ts`.

### Frontend

- **3l.** One `POS_SHORT` and one `initials()` in `src/lib/format.ts`; delete the five copies.
- **3m.** Replace both `isMobile` resize listeners with a single `useMediaQuery('(max-width: 639px)')` hook in `src/lib/useMediaQuery.ts`.
- **3n.** One bottom-sheet primitive. Make `src/components/ui/sheet.tsx` the only overlay: backdrop, panel, header with close button, Escape to close, body scroll lock while open, `role="dialog" aria-modal`. Migrate `ModalSheet` (PlayerRanking), `PlayerAvailabilitySheet`, `CalendarSheet` (sheet mode), `NotifySquadSheet`, the AppFooter help sheet, and `ConfirmDialog` onto it. Use one z-index pair (backdrop 40 / panel 50) everywhere; the photo lightbox and ConfirmDialog may sit at 60. No behaviour change beyond Escape/scroll-lock.
- **3o.** Calendar links: have `/api/calendar/link` and `/api/calendar/team-link` return the full `url`. Delete the `baseUrl` hacks in `CalendarSyncSheet.tsx` and `CoachCalendarExport.tsx`.
- **3p.** Remove the redundant `useAbilityGroupConfig` query from `PlayerRanking.tsx` (config comes with `/api/ranking`); keep the mutation writing into the `['ranking']` cache. Delete the `/api/ranking/config` GET route if nothing else calls it.
- **3q.** Delete the `"Reverted to 15s per ChatGPT feedback"` comment; keep the value with a one-line reason ("Section Captains expect prompt updates").

Verify, commit.

---

## Phase 4 — One data layer and one auth model in the frontend

- **4a.** `AuthProvider` in `src/lib/auth.tsx` wrapping the router: one `getSession()` + one `onAuthStateChange` subscription; `useAuth()` reads context. Remove the `isLoading || !user` re-checks from `PlayerDashboard.tsx` and `CoachLayout.tsx` (AuthGate already guarantees a user). One `logout()`; `AppHeader` uses it instead of calling `supabase.auth.signOut()` directly.
- **4b.** `apiClient.ts` 401 handling: sign out via the same `logout()` path and let `AuthGate` render `Login`; remove the `window.location.href = '/'` hard reload. Keep the 403 handling.
- **4c.** `PlayerDashboard.tsx`: replace the manual `useState`/`useEffect` fetch with `useQuery(['myFixtures'])` and mutations with `onMutate` optimistic updates + `onError` rollback via `queryClient.setQueryData` (replace the `previousData` snapshot logic). `onSaved` in the availability sheet invalidates `['myFixtures']`.
- **4d.** `SeasonStats.tsx`: `useQuery(['playerStats', playerId])`. `PlayerAvailabilitySheet.tsx`: `useQuery(['matchSquad', matchId, side], { staleTime: 30_000 })`; delete the module-level `squadCache`.
- **4e.** Deploy-refresh handling: keep the `vite:preloadError` one-shot reload in `main.tsx`; keep `RouteError` but make its copy generic ("Something went wrong. Reload to try again."). No third mechanism.

Verify, commit.

---

## Phase 5 — Naming and navigation consistency

- One product name everywhere: **"HKFC Squad Selection"** (login heading, both headers, PWA `name`); PWA `short_name` **"HKFC Squad"**. Fix the manifest icon declaration to the real PNG dimensions or resize `public/assets/apple-touch-icon.png` to 512×512 and add `purpose: "any maskable"`.
- Collapse `/coach` and `/coach/fixtures` into one route `/coach` (dashboard = Play-Up Watch + fixture list). Update `AppHeader` active-state logic, `SquadSelection`'s back link, and any tests/README references. Redirect `/coach/fixtures` → `/coach`.
- Use `text-primary-foreground` (not `text-white`) on primary buttons in `SquadSelection.tsx` and `PlayerRanking.tsx` save bars.

Verify, commit.

---

## Phase 6 — Tests

- Create `tests/helpers/airtable.ts` with one `fakeAirtable(tables)` fetch stub and `tests/helpers/factories.ts` with the `t/p/m/mc/ctx` builders. Migrate every hand-rolled stub (`availabilitySecurity`, `bulkAvailability`, `cache`, `calendarPlayer`, `coachFixtures`, `displayTeam`, `gkFixtures`, `rankingEvents`, `authorization`) and the factories in `eligibility`, `golden-eligibility`, `suspension`. Assertions must not change.
- Add `tests/ranking.test.ts` against `worker/src/ranking.ts`: reorder keeps ranks contiguous, stale `version` returns 409, activate (in-list Applicant and new player) and deactivate keep 1..N contiguous, `setAbilityGroupConfig` rejects over-capacity.
- Type-check tests: add `tests` to a `tsconfig.test.json` (or to root `include`) and run it in `npm run verify` and CI; fix the four `'body' is of type 'unknown'` errors in `tests/registrationRoutes.test.ts` if that file still exists (it will not after Phase 1; otherwise fix whatever surfaces).
- Make `.github/workflows/ci.yml` call `npm run verify` instead of re-listing the steps.

Verify, commit.

---

## Phase 7 — Docs match the code

Edit `README.md`:
- Remove every hard-coded test count and the per-file test table (badge line included). Replace with "run `npx vitest run`".
- Rewrite "Run locally" and "Deploy" to match `package.json` scripts and the Workers-with-assets deployment. Delete all Cloudflare Pages instructions. Mention `worker/.dev.vars.example` and `ALLOWED_ORIGIN`.
- Auth: "email one-time code / magic link via Supabase" (not password/PKCE).
- Repository tree: regenerate from the actual file list after Phase 3h.
- Replace the "Code Generation" section with "Airtable schema mapping" describing `shared/schema/` as hand-maintained and pointing at `docs/Airtable Schema.json` as the source of truth. Remove every "MUST NOT be edited manually" statement.
- Add "Removed features" (re-registration service, metrics endpoints) with the removal commit hashes.
- Add the shared-code import rule from Phase 3h.

Edit `docs/Implementation_Roadmap_v4.md`: retitle it "Architecture overview (historical spec)", add a banner that the README and code are authoritative, fix `PUT` → `POST` for ranking config, remove INV-031 and the generator claims, and list the endpoints that exist today in §10 (or delete §10 and point at `index.ts`). Do not try to make every paragraph current; make it stop claiming authority.

Commit.

---

## Final report (write to `docs/cleanup-report.md`)

1. Baseline vs final: test files, tests, `index-*.js` size, total lines in `src/`, `worker/src/`, `tests/` (`git diff --shortstat main`).
2. Table of every route deleted, every file deleted, every dependency removed.
3. Each Phase 2 bug: one line on the fix and the test that covers it.
4. Anything in this prompt you did **not** do, with the reason.
5. Anything you found that is out of scope but worth a follow-up (one line each; do not fix them).
6. Screenshots or a short description of the three screens most affected by the radius change (login, coach fixture list, squad selection).
