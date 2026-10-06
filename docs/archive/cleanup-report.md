# Cleanup Report — `cleanup/simplify`

Branch `cleanup/simplify`, created from `main` at `2a2391b9`. Eight commits, one per phase (Phase 0 baseline + Phases 1–7). Not pushed; not merged. All work below is on this local branch only.

```
9c9aad7 Record cleanup baseline
b533df6 Delete dead routes, dormant features, and dead config      (Phase 1)
6e7aa58 Fix confirmed worker and frontend bugs                     (Phase 2)
a50a79d Consolidate duplication across the worker and frontend     (Phase 3)
9f18821 One data layer and one auth model in the frontend          (Phase 4)
9af06cf Naming and navigation consistency                         (Phase 5)
f69d6a0 Tests: shared helpers, ranking coverage, type-checked tests, simpler CI (Phase 6)
fd37bef Docs match the code                                        (Phase 7)
```

Net diff across all eight commits: **136 files changed, +3,704 / −7,530 lines** (git diff `main..cleanup/simplify`).

Eligibility semantics were frozen throughout: `tests/eligibility.test.ts` and `tests/golden-eligibility.test.ts` pass with the same reason strings, rule IDs and evaluation order as the baseline (the only changes to those two files were the deliberate removals specified in Phase 1 — `REASON_TAGS`/`trace`/`warningTags` — and moving the shared `t()`/`p()`/`m()`/`mc()` factories into `tests/helpers/factories.ts` in Phase 6).

---

## Baseline vs. final

| Metric | Baseline (`2a2391b9`) | Final (`cleanup/simplify`) |
|---|---|---|
| Test files | 28 | 31 |
| Tests | 486 | 445 |
| `npx tsc --noEmit` | clean | clean |
| `npx tsc --noEmit -p worker/tsconfig.json` | clean | clean |
| `npx tsc --noEmit -p tsconfig.test.json` | *(didn't exist)* | clean — **new** in Phase 6 |
| `npx vite build` | succeeds | succeeds |
| Main JS chunk | `index-BG8rDZwG.js` 647.98 kB (gzip 189.96 kB) | `index-*.js` 648.23 kB (gzip 190.15 kB) |
| Worker routes (`pathname ===` in `index.ts`) | 38 | 25 |
| Runtime dependencies removed | — | `zod`, `@supabase/ssr`, `tailwindcss-animate`, `autoprefixer` |
| Runtime dependencies added | — | none |

**Why the test count went down despite new tests being added:** Phase 1 deleted four test files for deleted code (`toggleSelection.test.ts`, `perf.test.ts`, `registration.test.ts`, `registrationRoutes.test.ts`) and trimmed the golden/eligibility suites' reason-tag assertions; Phase 6 removed one test for the deleted `GET /api/ranking/config` route. Phase 2 and Phase 6 together added seven new test files (`squadForMatch`, `hkDateKey`, `recommendationsRoute`, `airtableClient`, `autoSelect`, `fixturesErrorPropagation`, and extending `ranking.test.ts` with five new cases). Net: −41 tests, +3 files.

**Why the main bundle didn't shrink:** dead-code removal (Phase 1) and duplication removal (Phase 3) were offset by Phase 4's React Query conversions and Phase 3n's sheet-primitive consolidation, both of which are net-additive in code even though they remove duplication in *behavior*. The bundle is materially the same size; the goal of this cleanup was maintainability, not bundle size, and the vite build warning about the >500 kB main chunk (present in the baseline too) is unchanged — see Follow-ups.

---

## Removed

### Dead worker routes (13)

`GET /api/eligibility-metrics`, `POST /api/eligibility-metrics/reset`, `GET /api/player-fixtures/:id` (route only — `getPlayerFixtures` itself stays, `calendar.ts` uses it), `GET /api/players/active`, `GET /api/reference-data`, `GET /api/player-by-email`, `GET /api/recent-availability`, `POST /api/select-player`, `POST /api/remove-selection`, `POST /api/set-availability` (coach bulk route — the underlying function became the one true upsert path in Phase 3d instead), `POST /api/ranking/backfill`, `GET /api/calendar/team.ics`, `POST /api/registration/reconcile`.

**Cascading deletion caught during the pass:** removing the frontend's `useInitializeRanking` hook (dead, no caller) left `POST /api/ranking/initialize` with no caller either; deleted alongside, exactly as the phase's own instructions anticipated.

### Dormant features

- The automatic re-registration service in full: `worker/src/registration.ts`, its routes, and `tests/registration.test.ts` / `tests/registrationRoutes.test.ts`. Owner decision: never enabled in production, delete outright.
- Metrics/perf instrumentation: `worker/src/metrics.ts`, `worker/src/perf.ts`, `countAirtableCall()`, the `auth.ts` timing wrappers, the `evaluatePlayerEligibility` metrics wrapper, `tests/perf.test.ts`.
- The Worker's `scheduled()` cron export and the `[triggers]` block in `worker/wrangler.toml`.
- `src/lib/auth.ts` (superseded — a *different, new* `src/lib/auth.tsx` was created in Phase 4), `src/api/removeSelection.ts`, `src/components/shared/AvailabilityChip.tsx`.
- The selection-event log block in `squad.ts` (capped at 10 rows, never read) and its `SELECTION_EVENTS_*` constants.
- An orphaned dead function, `handleTeamCalendarExport` in `calendar.ts` — missed in the original Phase 1 pass, found and deleted while touching that file for a Phase 2 bug fix.
- `worker/src/ranking.ts`'s `initializeRanking()` — dead once `useInitializeRanking` and its route were gone.

### Dead config / dependencies

`tailwind.config.ts` (Tailwind v4 reads `src/index.css`, not a JS config), `worker/package.json` + `worker/package-lock.json` (worker never needed its own `node_modules`), and the npm packages `zod`, `@supabase/ssr`, `tailwindcss-animate`, `autoprefixer`.

### Files moved (not deleted) in Phase 3h

`src/generated/` → `shared/schema/`; `src/mappers/` → `shared/mappers/`; `src/lib/{displayTeam,abilityGroup,abilityRank,airtableValueUtils,hkDateKey}.ts` → `shared/`; `src/lib/cache.ts` → `worker/src/cache.ts` (it was already worker-only despite its old location). New rule, now stated in the README: `worker/src/` never imports from `src/`, and `src/` never imports from `worker/`.

---

## Bugs fixed (Phase 2)

All 20 items from the original punch list, each with a new or extended regression test:

| # | Bug | Fix |
|---|---|---|
| 1 | Ranking-event writes fired-and-forgot (`void (async () => …)`), swallowing failures | Awaited; `catch(() => {})` removed so failures surface as 502 |
| 2 | `GET /api/match/:id/squad` ignored `?side=` | Reads it the same way `/players` does |
| 3 | `activatePlayer` left a rank hole for in-list Applicants | Keeps the existing rank; renumbers 1..N after activate/deactivate |
| 4 | Recommendations silently defaulted an unknown team rank to `12` | Throws 400 instead |
| 5 | Same-day grouping split a 03:00 HKT kick-off onto the wrong UTC day | One `hkDateKey()` helper (Asia/Hong_Kong), used everywhere a date key was computed |
| 6 | `getAvailabilityForMatch` and the play-up gate swallowed Airtable errors | try/catch removed; errors propagate |
| 7 | Coach access had a `Player/Coach` substring fallback alongside the real Teams-link derivation | Fallback deleted; one `AuthorizedUser` derivation, computed once in `auth.ts` |
| 8 | `GET /api/recent-changes` and `GET /api/playup-watch` had no coach gate | `requireCoach` added |
| 9 | No 429 retry, no email-lookup cache, unbounded write concurrency | 429 retry (max 2, honours `Retry-After`); 60s People-by-email cache; `AIRTABLE_WRITE_CONCURRENCY = 1` |
| 10 | `ALLOWED_ORIGIN` optional, defaulted to `*` | Required; throws 500 at request time if unset |
| 11 | Concurrent cache misses each issued their own Airtable fetch | In-flight de-dup via a token-guarded pending-promise map |
| 12 | Calendar HMAC signatures compared with `===` (timing side-channel) | Constant-time comparison (`timingSafeEqualHex` — see Deviations, no WebCrypto equivalent exists) |
| 13 | Selection sync lived at `POST /squad/sync`, off the `/api` prefix | Renamed to `POST /api/squad/sync` |
| 14 | Auto-select recomputed against stale (pre-poll-merge) player data in one of its two call sites | One `computeAutoSelectIds()`, extracted to `src/lib/autoSelect.ts`, used by both |
| 15 | Filter state round-tripped through a hand-built query string, double-encoding names with spaces/`&` | `filtersToParams`/`paramsToFilters` operate on `URLSearchParams` directly |
| 16 | Login page ran an unreachable redirect effect (`AuthGate` already unmounts it) | Effect and its `useMyProfile()` call removed |
| 17 | Ad hoc `--radius` derivation, an unused `--sidebar-*`/`--chart-*` token set, and a `rounded-[5px]` one-off workaround | Explicit monotonic scale (`--radius-sm` 6px → `--radius-2xl` 20px); workaround replaced with `rounded-md` |
| 18 | Five components carried their own locally-redeclared `Player`/`Fixture`/`MatchInfo` types | Import the real API types (`MatchPlayer`, `UpcomingFixture`, `MyFixture`, `MatchInfo`) instead |
| 19 | `hasChanges`, `activeTab`, `showPast` were state kept in sync with an effect | Derived directly from existing state/`searchParams` |
| 20 | Deactivating mid-reorder silently discarded an unsaved draft | Activate/Deactivate disable with a tooltip while a draft is pending |

---

## Deviations from the original plan (rule 9: followed the code, noted here)

- **No `crypto.subtle.timingSafeEqual` in the Workers runtime.** Bug #12 used a manual constant-time XOR-accumulator loop (`timingSafeEqualHex`) instead — the WebCrypto API this runtime implements has no built-in constant-time compare.
- **No `--chart-*` tokens existed** in `src/index.css` to remove (bug #17's brief assumed they did); nothing to delete there.
- **`worker/src/dashboard.ts` was not deleted** even after `currentSeason()` moved into `seasonContext.ts` (Phase 3c) — `getPlayUpWatch` still lives there and has its own callers.
- **Cache invalidation staleness windows widened, deliberately, per the phase's own instructions:**
  - Phase 3g's `invalidateSelectionCaches`/`invalidateReferenceData` do a coarse prefix wipe instead of computing the exact affected match IDs, removing a full-season match read that existed *only* to build that precise list.
  - Phase 3j moved `computeSuspensionStates` into the 10-minute `season-index` cache (computed once per cache lifetime instead of once per candidate side). A registered-team change's effect on suspension serving-team metadata now has up to a 10-minute lag (or until the next selection/availability write invalidates that season) instead of being instantaneous.
- **Phase 3i (special-goalkeeper view through the shared `buildCard` pipeline) is a genuine, small behavior change**, not just a refactor: the special-GK planning view previously read exception status raw; routed through the shared pipeline it now also resolves standing availability rules (`effectiveAvailability`) the same way every other fixture card does. No test in `tests/gkFixtures.test.ts` exercises a standing rule for that cohort, so the existing suite doesn't catch this, but a special-GK player with a standing rule would now see it reflected where they previously wouldn't. Flagging per rule 1 rather than treating it as covered by "no behaviour change."
- **Phase 3n added Escape-to-close, a body-scroll lock, and a close button to sheets that previously lacked one** (the ranking-page filter sheet, `PlayerAvailabilitySheet`). This is explicitly what the phase asked for ("header with close button… Escape to close, body scroll lock") but is a visible behavior addition, not a pure refactor — noted for the same reason.
- **`tests/rankingEvents.test.ts` and `tests/authorization.test.ts` were deliberately not migrated onto the shared `fakeAirtable()` helper** (Phase 6): the former injects mid-sequence 404/422 failures that don't fit the general shape, and the latter never had an Airtable stub to begin with (it mocks `reference.ts` directly).
- **The `ctx()` factories in `tests/eligibility.test.ts` and `tests/golden-eligibility.test.ts` were deliberately not unified**, even though `t()`/`p()`/`m()`/`mc()` were: golden's `ctx()` runs the real suspension engine to protect the full pipeline; eligibility's doesn't. Forcing one implementation would have changed which tests exercise which code path.
- **`docs/Implementation_Roadmap_v4.md` §10 (API Specification) was deleted rather than rewritten** — it documented a client-supplied-email auth model that Phase 2 (bug #7) already replaced with session-derived identity, and rewriting ~220 lines of per-route detail against the current 25-route surface risked producing a second copy that would drift again. Replaced with a pointer to `worker/src/index.ts` as authoritative, per the phase's own offered alternative.
- **Visual verification was partial.** The login page was live-checked in-browser (screenshot confirmed: "HKFC Squad Selection" heading, rounded card/input corners from the new radius scale, no console errors). Authenticated screens (squad selection, fixture cards, coach dashboard, the migrated bottom sheets) could not be exercised end-to-end in this sandbox — there is no live Supabase session or Airtable base reachable from here. Those changes are covered by the type-check + test + build pipeline and by code-level review of each migration, but not by a human or an automated screenshot of the real authenticated UI. Recommend a manual pass before merging, specifically on: the radius-token change (bug #17) and the sheet-primitive migration (Phase 3n).

---

## Follow-ups (not done, worth a look)

1. **`shared/schema/tableNames.ts`'s `selectionEvent` entry (`"Selection Events"`) is unused** in `worker/src/` — found during the Phase 7 docs pass. Confirm against the live Airtable base whether that table still exists; if not, remove the mapping entry, if so, it's dead code with a real table behind it and can stay as documentation.
2. **The main JS bundle is ~648 kB (gzip ~190 kB), unchanged from baseline** and still trips vite's >500 kB chunk-size warning. Code-splitting `PlayerRanking`/`SquadSelection` further, or a `manualChunks` split for `react`/`@tanstack/*`/`@dnd-kit/*`, would address this — out of scope for a "no user-visible feature changes" cleanup, but worth a dedicated pass.
3. **Manual visual QA** of bug #17 (radius tokens) and Phase 3n (bottom-sheet primitive) on the real authenticated app, per the Deviations note above.
4. **`docs/Implementation_Roadmap_v4.md` remains large (~2,300 lines) and mostly unverified against current behavior** beyond the specific fixes made in Phase 7 (retitle, banner, PUT→POST, INV-031, generator claims, §10). It's now clearly labeled historical/non-authoritative, but if it's going to keep being read, a deeper prune (or a decision to retire it entirely in favor of the README) would reduce the surface area for it to mislead a future reader.
