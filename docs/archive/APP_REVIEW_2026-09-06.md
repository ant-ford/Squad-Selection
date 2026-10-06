# HKFC Squad Selection — Detailed App Review

Date: 6 September 2026
Scope: every file in `src/`, `worker/src/`, `tests/`, all build/deploy config, README and roadmap.
Method: full read of the frontend, two parallel deep reviews of the worker and of tests/config/docs, then spot-verification of every High/Medium claim against the source.

---

## 1. Verdict

The app's core is in good shape: identity always comes from the Supabase session, the Airtable token never reaches the browser, the eligibility engine is pure and pinned by golden tests, and the verification pipeline (typecheck, worker typecheck, 470 tests, build) is green.

What is dragging it away from "sleek and simple" is **accretion**, not architecture:

| Symptom | Evidence |
|---|---|
| Dead routes and code | 13 of 46 worker routes have no frontend caller; ~1,000 lines removable with no user-visible change |
| Dormant features | `registration.ts` (656 lines + cron + ledger table) has never been switched on; `metrics.ts`/`perf.ts` report per-isolate numbers that are meaningless on Cloudflare |
| Same thing done N ways | 4 link-id helpers, 5 HKFC-side resolvers, 4–5 coach-role derivations, 2 availability upserts, 6 hand-rolled overlay/sheet implementations, `POS_SHORT` copied into 5 files |
| Real bugs from bolt-ons | derby squad sheet ignores `side`; recommendations score the opponent's team on away fixtures; `activatePlayer` leaves a hole in the ranking; auto-select reads stale availability; name filter double-encodes in the URL; radius design tokens are inverted |
| Docs that describe a different app | README deploy section is for Cloudflare Pages (app deploys as a Worker); "generated code" has no generator; auth described as password+PKCE (it is email OTP); test counts stale in 6 places |

Nothing here requires a rewrite. It requires deletion, consolidation, and about a dozen targeted fixes.

---

## 2. Confirmed bugs

### Backend (worker)

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| B1 | High | `worker/src/index.ts:60`; `rankingEvents.ts:100-133`; `squad.ts:268`; `ranking.ts:377-379, 422-424` | Fire-and-forget Airtable writes are never passed to `ctx.waitUntil`. Cloudflare may cancel them once the response is sent, so ranking audit rows silently go missing. | `await` them (one small batch each), or thread `ctx` and `waitUntil`. |
| B2 | High | `worker/src/index.ts:137-141` | `GET /api/match/:id/squad` never reads `?side=`, though the frontend sends it and `getSquadForMatch` accepts it. On a derby the away player sees the home squad. | Read `side` exactly like the `/players` route at line 147. |
| B3 | High | `worker/src/ranking.ts:364-372` | `activatePlayer` sets `sectionRank = activeCount + 1` even when the player (an Applicant) is already in the active list with a rank. Leaves a hole and an out-of-range rank; derived ability group is then skipped. | If already in list, keep rank; otherwise append. Renumber 1..N after any activate/deactivate. |
| B4 | Med | `worker/src/recommendations.ts:160-164` | Target team = `side === "away" ? awayTeam : homeTeam`. `side` is undefined for non-derby fixtures, so every HKFC-away fixture scores proximity against the opponent and falls back to magic rank `12`. | Use `match.hkfcTeam`; delete the `?? 12`. |
| B5 | Med | `seasonContext.ts:61-63`, `fixtures.ts:253`, `availability.ts:279`, `dashboard.ts:9-12` vs `src/pages/FixtureList.tsx:95` | "Same day" is UTC in the worker and HKT in the coach fixture list. Any 00:00–07:59 HKT kick-off is on different days in different screens and in the same-day eligibility rule. | One shared `hkDateKey()` using `Asia/Hong_Kong`. |
| B6 | Med | `squad.ts:442-446`; `fixtures.ts:332-335` | Airtable errors are swallowed and an empty result is cached for 25 s. During an outage everyone shows as Available. | Let it throw; the frontend already handles query errors. |
| B7 | Med | `auth.ts:86-94`, `profile.ts:17-24`, `fixtures.ts:136-141`, `fixtures.ts:417-421`, `ranking.ts:159-165` | Coach role derived five different ways. The `Player/Coach` substring heuristic grants API `role: coach` to people the profile says are not coaches. | Compute `{role, coachTeams, isSectionCaptain}` once in `requireAuthorizedUser`; delete the rest and the heuristic. |
| B8 | Med | `index.ts:303-315` | `/api/recent-changes` and `/api/playup-watch` are player-gated but expose every player's rank moves. | `requireCoach`. |
| B9 | Med | `airtable.ts:34-55`; `ranking.ts:63`; `auth.ts:64`; `availability.ts:68-86` | No 429 handling; 4 parallel PATCH streams per reorder; an uncached People read on every request including the 30 s poll. | Retry-on-429, write concurrency 1, cache People-by-email 30–60 s. |
| B10 | Med | `src/lib/cache.ts:14-29` | No in-flight de-dup; concurrent cold misses each rebuild the season context (5 table scans). | Store the pending promise. |
| B11 | Med | `http.ts:17`; `index.ts:536-537` | CORS falls open to `*` if `ALLOWED_ORIGIN` unset. Airtable error messages (URL, base id, formula with email, response body) are returned to the client. | Require the var; map `AirtableError` to a fixed 502. |
| B12 | Low | `squad.ts:241-271` | Selection-event log caps at 10 rows per sync and nothing reads it. | Delete. |
| B13 | Low | `calendar.ts:183, 242` | HMAC compare is not constant-time. | `crypto.subtle.timingSafeEqual`. |

### Frontend

| # | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| F1 | High | `src/pages/SquadSelection.tsx:78-116, 145-170` | Auto-select filters on `data.players` (initial fetch), not `mergedPlayers` (poll-merged). A player who becomes Available via the 30 s poll is never auto-added; one who becomes Unavailable is still added. Logic is also duplicated between `applyAutoSelect` and `handleToggleAutoSelect`. | One function over `mergedPlayers`. |
| F2 | Med | `src/pages/SquadSelection.tsx:253-265` + `PlayerFilters.tsx:25-44` | `filtersToParams` URL-encodes `name`, then `handleFilterChange` splits the string on `&`/`=` and `URLSearchParams.set` encodes it again. A name filter with a space reloads as `a%20b`. | Build `URLSearchParams` directly; never round-trip through a string. |
| F3 | Med | `src/pages/Login.tsx:43, 46-55`; `src/lib/apiClient.ts:42-50` | Login calls `useMyProfile()` while logged out. Each visit fires two unauthenticated `/api/my-profile` requests (retry: 1) that 401 and each trigger `supabase.auth.signOut()`. The coach-redirect effect is effectively dead because `AuthGate` unmounts `Login` in the same render the session arrives. | Remove the profile query and effect from Login. Do post-login routing in one place (or accept "player view first", which is what happens today). |
| F4 | Med | `src/index.css:23-25, 58` | `--radius: 1.3rem` makes `rounded-sm/md/lg` ≈ 17–21px while `rounded-xl/2xl` keep Tailwind defaults (12px/16px). The scale is inverted; `SeasonStats.tsx:136-138` already hacks around it with `rounded-[5px]`. | Define the full radius scale explicitly (e.g. sm 6px, md 8px, lg 12px, xl 16px, 2xl 20px) and remove the hack. |
| F5 | Med | `src/api/getMyFixtures.ts` vs `src/components/PlayerFixtureCard.tsx:24` | `MyFixture` has no `kit`, but the card's locally redeclared `Fixture` type does. Works at runtime only because the worker happens to send it. Five components redeclare API types locally (`PlayerRow`, `FixtureCard`, `PlayerFixtureCard`, `PlayerAvailabilitySheet`, `MatchHeader`). | Import the API types; delete local copies. |
| F6 | Low | `src/pages/SquadSelection.tsx:394` | Only route not under `/api`: `POST /squad/sync`. | Rename to `/api/squad/sync` in both places. |
| F7 | Low | `src/pages/SquadSelection.tsx:239-242`; `src/pages/FixtureList.tsx:17-54` | Derived state stored in state via effects (`hasChanges`), and a two-way URL↔state sync loop. | Derive from `pendingDeltas.length` / from `searchParams` directly. |
| F8 | Low | `src/pages/PlayerRanking.tsx:342, 353` | Activate/deactivate calls `setDraftIds(null)`, silently discarding an unsaved reorder. | Block those actions while a draft exists, or confirm. |
| F9 | Low | `src/lib/useAuth.ts` used in `App.tsx`, `Login.tsx`, `PlayerDashboard.tsx`, `CoachLayout.tsx` | Four independent auth subscriptions and `getSession()` calls; each page re-checks `isLoading || !user` that `AuthGate` already guarantees. | One `AuthProvider` + context. |

---

## 3. Dead code and unused features

### Worker routes with no frontend caller (13)

`GET /api/eligibility-metrics`, `POST /api/eligibility-metrics/reset`, `GET /api/player-fixtures/:id` (route only; function is used by calendar), `GET /api/players/active`, `GET /api/reference-data`, `GET /api/player-by-email`, `GET /api/recent-availability` (worker returns a hardcoded empty stub), `POST /api/select-player`, `POST /api/remove-selection`, `POST /api/set-availability`, `POST /api/ranking/backfill`, `GET /api/calendar/team.ics`, `POST /api/registration/reconcile`.

### Modules that are bloat

- `worker/src/metrics.ts`, `worker/src/perf.ts` and their call sites in `auth.ts`, `airtable.ts`, `eligibility.ts:800-814`. Per-isolate counters; Workers observability already logs requests.
- `worker/src/registration.ts` + cron trigger + `scheduled()` handler + `AUTO_REGISTRATION_ENABLED` flag + `tests/registration*.test.ts`. Dormant; the user-visible rule (4th play-up blocks) already exists in `eligibility.ts:499-506`.
- `eligibility.ts:168-291` `REASON_TAGS`/`lookupReasonTag` (never sent to client) and the `trace` plumbing (only the golden test passes `{trace:true}`).
- `EvaluationContext.allSelections / allExceptions / sameDayMatches` (`eligibility.ts:638-656`) — never read.

### Frontend dead code

- `src/lib/auth.ts` (`getCurrentSupabaseUser`) — no importers.
- `src/api/removeSelection.ts` — no importers.
- `src/lib/queries.ts`: `useMoveRanking`, `useMoveRankingRelative`, `useInitializeRanking`, `useRecentAvailability`, `RecentAvailabilityChange`, the no-op `authGet` wrapper.
- `src/lib/readiness.ts`: `calculateTeamReadiness`, `missingPositions`, `expectedComposition`, `daysUntil`, `severityOrder` — only `detectSameDayConflicts` and `playUpWatchLabel` are used.
- `src/lib/rankingHistory.ts`: `proposedDirection`; `src/lib/abilityGroup.ts`: `validateConfig` (frontend side).
- `src/components/shared/AvailabilityChip.tsx` — no importers.
- `src/components/PlayerFilters.tsx`: `bulkSelectMode` / `onToggleBulk` props — never passed.
- `src/generated/domainTypes.ts`: `RecentChange` — imported, never used.
- `src/components/ui/button.tsx` accepts `variant`/`size` and ignores both.
- `src/components/ui/sheet.tsx:12-13` "backwards-compatible" shim for a missing `open` prop.
- `dark:` variants in `PlayerRanking.tsx` (3 uses) with no dark theme defined and `color-scheme: light` forced in `index.html`.

### Config / dependencies

- `tailwind.config.ts` is dead (Tailwind v4 via `@import "tailwindcss"` ignores it without `@config`); it is the only importer of `tailwindcss-animate`.
- Unused deps: `zod`, `@supabase/ssr`, `tailwindcss-animate`, `autoprefixer` (redundant with v4).
- `worker/package.json` + `worker/package-lock.json` duplicate root devDeps; CI bypasses them.
- `@supabase/supabase-js` pulls ~360 kB of storage/postgrest/realtime source for an app that only uses `.auth.*`; main chunk is 641 kB.
- `tests/toggleSelection.test.ts` tests a function defined inside the test and contains `expect(true).toBe(true)`.
- `tests/perf.test.ts` asserts JSON round-trips.

---

## 4. Patchwork and duplication

### Backend

- **Link-id helpers ×4**: `airtableValueUtils.ts:5 linkId`, `eligibility.ts:89 safeLinkId`, `playUp.ts:19 linkedMatchId`, `playerStats.ts:73 firstLinkId`; `singleSelect` is byte-identical to `linkId`.
- **HKFC side resolvers ×5**: `squad.ts:51-74`, `eligibility.ts:132-139`, `fixtures.ts:82-102`, `fixtures.ts:254-266`, `recommendations.ts:160`.
- **Availability upserts ×2**: `availability.ts:121-172` and `:183-239`.
- **Season helpers split**: `currentSeason()` in `dashboard.ts`, `previousSeason()` in `seasonContext.ts`; `playerStats` imports from `dashboard`.
- **`99` unranked sentinel ×5** across `teamMapper`, `reference`, `eligibility`, `fixtures`, `registration`.
- **Active-ranking formula and derived-rank counters duplicated** inside `ranking.ts` (`:75` vs `:434`; `:43-58` vs `:464-485`).
- **Special-GK fixture branch** (`fixtures.ts:67-125, 194-223`) is a near-copy of the main pipeline.
- **Cache invalidation** hand-rolled per write in five files with nine keys/prefixes; one path reads `all-matches` just to compute which keys to drop.
- **Cosmetic scars**: identical 12-line doc comment twice in `seasonContext.ts`; `index.ts` body indented six spaces; `rankingEvents.ts:193-198` builds a fake Player with hardcoded field names and `as never`.

### Frontend

- **`POS_SHORT` in 5 files**; `initials()` in 2.
- **`isMobile = window.innerWidth < 640` + resize listener** in `PlayerFilters.tsx:94-100` and `PlayerRanking.tsx:130-136` (should be CSS or one hook).
- **Six overlay implementations**: `ui/sheet.tsx`, `ModalSheet` in `PlayerRanking`, hand-rolled in `PlayerAvailabilitySheet`, `CalendarSheet`, `NotifySquadSheet`, `AppFooter`, plus `ConfirmDialog`. None trap focus, handle Escape, or lock scroll. Z-indices: 40/50/70/100 ad hoc.
- **Calendar link base-URL hack** duplicated in `CalendarSyncSheet.tsx:8-9` and `CoachCalendarExport.tsx:13-14` (`http://` fallback). Worker should return the full URL.
- **Three data-fetching styles**: React Query (most), manual `useState`/`useEffect` (`PlayerDashboard`, `SeasonStats`), and a module-level TTL cache (`PlayerAvailabilitySheet.tsx:42-43`).
- **Two logout paths**: `useAuth.logout()` and `AppHeader` calling `supabase.auth.signOut()` directly; a third hard-redirect path in `apiClient` on 401.
- **Three "new deploy broke a chunk" mitigations**: `main.tsx:7-14` preloadError reload, `App.tsx:39-56` RouteError copy, PWA `autoUpdate`.
- **Product naming**: "HKFC Squad Selection" (header), "HKFC Squad Manager" (login), "HKFC Hockey / Squad Selection" (player header), "Squad Select" (PWA short name).
- **Two routes render the same screen**: `/coach` (dashboard = watch list + FixtureList) and `/coach/fixtures` (FixtureList alone). Back links point at different ones.
- **Ranking-page config query** (`useAbilityGroupConfig`) is redundant; the config is embedded in `/api/ranking` (the comment in `queries.ts:102-104` says so).
- **`useRanking` staleTime comment**: "Reverted to 15s per ChatGPT feedback" — decision provenance, not a reason.

---

## 5. Structure

- `src/` is not "the frontend": the worker imports `src/generated`, `src/mappers`, `src/lib/cache.ts` (worker-only), `displayTeam`, `abilityGroup`, `abilityRank`, `airtableValueUtils` via `../../src/...` and hand-listed `include` entries in `worker/tsconfig.json`. A `shared/` directory makes the boundary honest.
- `src/generated/*` is hand-maintained (git history shows prose doc-comments added per feature). README:485-513 and roadmap INV-031 claim a generator and "MUST NOT be edited manually". Neither is true.
- Two Workers (`wrangler.jsonc` assets-only, `worker/wrangler.toml` API) means cross-origin + CORS + one hard-coded `ALLOWED_ORIGIN`. Local dev as documented is CORS-blocked (no `.dev.vars`). The split is documented as a Windows dev-plugin workaround (`vite.config.ts:8-25`).
- `worker/tsconfig.json` includes `node` types in a Workers project; `tests/` is type-checked by nothing (4 real errors in `tests/registrationRoutes.test.ts:110,119,141,152` pass silently).

---

## 6. Tests

- 470 tests, worker logic well covered; **zero component tests** and `vitest.config.ts` only matches `tests/**/*.test.ts`.
- **Biggest gap**: no test of `worker/src/ranking.ts` (move/reorder contiguity, stale-version 409, activate/deactivate). README maps it to `abilityGroup/abilityRank` tests, which cover pure helpers only.
- 10 files each hand-roll a fake Airtable `fetch`; `eligibility`/`golden`/`suspension` each redefine the same factories; `authorization-routes` and `registrationRoutes` mock 13 modules to boot the router. No `tests/helpers/`.
- `cachePerf.test.ts` is a correctness test with a misleading name.

---

## 7. Docs

- README deploy section describes Cloudflare Pages; the app deploys as a Worker with static assets.
- README says "email/password auth with PKCE"; it is email OTP + magic link.
- Test counts stale in 6 places; per-file table wrong for 8 suites and missing 7.
- Repository tree lists files that don't exist (`worker/src/abilityGroup.ts`) and omits 8 that do.
- Roadmap §10 omits 10 live endpoints; §16 says "9 files, 159 tests"; INV-016/053 say `PUT` where the router says `POST`.

---

## 8. What to leave alone

- The eligibility rule order and every reason string pinned by `tests/golden-eligibility.test.ts`.
- The Worker-first / session-derived-identity model and the per-request Supabase check.
- React Query as the data layer, `sonner` for toasts, dnd-kit + virtualiser on the ranking page.
- The exception-based availability model and single persisted Section Rank.
- The 8-step evaluation in `eligibility.ts` (only its plumbing should change).
