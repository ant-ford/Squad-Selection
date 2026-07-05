# Agent Prompt — HKFC Squad Selection App: Phase 3 Stocktake & Fix-Up (v3)

> **Copy/paste this entire prompt into your agent.** It is self-contained.
> You built Phase 3, so you have full context. This prompt is a scoped
> fix-up — do not refactor things that aren't broken.

---

## 0 · Context

You are working on the **HKFC Squad Selection App** at:

```
C:\dev\Hockey Trials App\Squad-Selection
```

**Current branch:** `End-of-Build-Phase-3-stocktake` (cut from `main`
after Phase 3 was merged). The latest full project snapshot is in
`docs/Project_Code_20260705-2346.md` — skim it for orientation.

**Authoritative Phase 3 spec docs (read before coding):**

1. `HKFC Eligibility & Selection Rules Specification v1.0.md` — the rules
2. `Implementation_Roadmap_v2.md` — roadmap scope (also contains the
   **existing weighted priority formula** — see Issue 10)
3. `EXECUTIVE_SUMMARY.md` + `IMPLEMENTATION_ANALYSIS.md` — review findings
4. `DEVELOPER_CHECKLIST.md` — implementation steps
5. `TECHNICAL_REFERENCE.md` — code/data shape conventions
6. `HKHA Competition Bye-Laws Summary.md` — the legal source

**Prime Directive:** Treat the spec as the source of truth. If a
behaviour is missing or contradicts the spec, implement the
**spec-correct** behaviour.

---

## 1 · Your Mission

**Part A — Triage & Audit:** Read the codebase end-to-end against the
Phase 3 specs and the 11 issues below. Produce a triage report at
`docs/STOCKTAKE_REPORT.md` listing every issue you found, with file/line
refs and severity (`Blocker` / `Bug` / `Polish` / `Spec gap`).

**Part B — Fix:** Fix everything in the report. One commit per logical
change so the PR is reviewable. Do **not** refactor things that aren't
broken.

When finished, `npm run build` must succeed with zero TypeScript errors.

**Begin Part A now. Save your notes, then proceed immediately to Part B.**

---

## 2 · User-Reported Issues (Must be fixed)

### Category A: Critical Bugs

**1. Coach squad-selection screen infinite load.** `/coach` loads the
fixture list, but clicking into a fixture (`/coach/match/:matchId`)
shows an infinite loading skeleton.
*Investigate:* `SquadSelection.tsx`, `usePlayersForMatch`, the worker
route `GET /api/match/:matchId/players`, the `mergedPlayers` /
`optimisticMatch` memo, and the 30s `useAvailabilityPoll` hook. Ensure
`data?.match` is not throwing silently or returning null indefinitely.
Add a visible error boundary so future failures are not silent.

**2. Coach cannot unselect a player.** With the "Reserve" status gone
(see Issue 4), the cycle must become a strict boolean toggle:
`not selected ⇄ Selected`. Add a regression test in
`src/lib/queries.test.ts` (or a new Vitest spec) proving that tapping a
Selected player produces a `remove` delta — not a `reserve` delta.

**3. "Maybe" availability missing on player fixture tile.** When a
player sets their status to "Maybe", it does not appear on the tile
like `Available` and `Unavailable` do.
*Investigate:* `AvailabilityIndicator` in `PlayerFixtureCard.tsx`, the
tile layout, the `getMyFixtures` response, and the save path in
`PlayerAvailabilitySheet.tsx`. Check (a) contrast of
`text-secondary-foreground` against the card background, (b) whether
`Maybe` status flows from the `AvailabilityExceptions` table all the
way through `getMyFixtures`, (c) whether the save endpoint silently
rejects `Maybe`, (d) whether the indicator is being truncated by the
notes `truncate` wrapper.
*Acceptance:* selecting Maybe, closing the sheet, and reopening the
fixture shows a `Maybe` chip visually consistent with the
`Available` / `Unavailable` chips.

### Category B: Feature Removals & Simplifications

**4. Eradicate "Reserve" status.** A player is either **Selected** or
not. There is no Reserve state.
*Action:* drop `'Reserve'` from `selectionStatus` unions; strip it from
the worker's `selectPlayer` / `batchUpdateSquad`; remove Reserve UI
badges, the "Reserves" stat in `MatchHeader` (3-col → 2-col), the
"Reserve" stat on the player dashboard, and the "Mark Reserve" button
on `BulkActionBar`. No DB migration needed — new app, no production
Reserve rows. Cycle must be `not selected → Selected → not selected`.

**5. Remove dual-checkbox confusion in coach `PlayerRow`.** There is
currently both an `<input type="checkbox">` (bulk) and a `<button>`
with a check icon (single select). Remove the bulk checkbox column
from the default view. If bulk select is needed, hide it behind a
"Bulk Select Mode" toggle in the filter bar. In the report, record
what the bulk checkbox was actually doing and what gets removed.

### Category C: UI/UX Polish & Consistency

**6. Reconcile Player vs. Coach dashboard formatting.** Both
dashboards must use the same visual language. Reconcile card padding,
border radius, spacing, stat box layouts (pick either the Player's
`StatBox` or the Coach's inline stats — one pattern, both places),
header bar styles, selection badge colour + wording, availability chip
styles. Extract shared components (`StatusBadge`, `AvailabilityChip`,
`FixtureCard`, `SectionHeader`, `MetaLine`) into `src/components/ui/`
and have both dashboards consume them. Stick to Tailwind — do not
introduce a UI library.

**7. Add explicit "Division" and "Ability" labels.** Use a
`Label: Value` typography pattern, not bare strings.
* **Fixture list tile** (`PlayerFixtureCard.tsx`): change the bare
  `division` to `Division: <value>`. Apply the same pattern to other
  meta lines (e.g. `Venue: <value>`) only if it doesn't overflow on
  mobile.
* **Player info card** (`PlayerDashboard.tsx`): add
  `Division: <value>` before the team line and `Ability: <value>`
  before the position line. Extend `getMyFixtures` response as
  needed to source the values.
* **Coach `MatchHeader`** (optional polish): apply the same pattern
  if it reads better; otherwise leave it.

**8. Note textarea alignment in fixture sheet.** In
`PlayerAvailabilitySheet.tsx`, the `<label>` for the "Note (optional)"
field is misaligned. Place `<label>` and `<Textarea>` in a vertical
flex column with full width (`w-full`), label class
`text-xs font-medium text-muted-foreground mb-1`. Copy the spacing and
typography of the Availability option buttons above it.

### Category D: Feature Enhancements

**9. Multi-select coach availability filters.** `PlayerFilters`
currently takes a single `active` string. Upgrade to a `Set<string>`
with chips that toggle on tap.
* Categories (use **AND across categories, OR within a category**):
  - **Availability:** Available, Maybe, Unavailable
  - **Position:** Defender, Midfielder, Forward, GK
  - **Selection:** Selected, Not selected
  - **Eligibility:** Eligible, Warning, Blocked
* "All" is a meta-filter that clears the set; mutually exclusive with
  the others.
* Persist the active filter set in the URL query string
  (`?f=avail:available,maybe;pos:def,gk`) so the view is shareable.
* **Keep the API contract unchanged** — filter client-side in
  `SquadSelection.tsx`.
* Add unit tests for the filter reducer.

**10. Build the Recommendation Engine (best fit first).** Upgrade
`getPlayersForMatch` (worker) to sort with a composite weighted
score.
* **First, find the existing weighted priority formula in
  `Implementation_Roadmap_v2.md`** (search for "priority", "weight",
  "rank", or "score"). Use it as the basis. The detailed scoring below
  is a *default* if the roadmap has none — not a replacement for an
  existing one. If the existing formula is incomplete, extend it; if
  it disagrees with the spec, raise it in the triage report.
* **Tiers (top to bottom):**
  1. **Selected** — always on top, in selection order
  2. **Eligible** (not selected) — score-sorted
  3. **Warning** (eligible with caveats) — score-sorted
  4. **Blocked** — always at the bottom
* **Score (0–100) for Eligible and Warning tiers, default weights:**
  * **Ability (50%):** Map the 24 `PlayingAbility` letter levels
    (`A+` down to `H-`) to 24 down to 1. Score = `(value / 24) * 100`.
    Source the mapping from `TECHNICAL_REFERENCE.md` if it is defined
    there.
  * **Play-Up Count (20%):** Lower is better. 0 → 100, 1 → 75, 2 → 50,
    3 → 25, 4+ → 0.
  * **Team Distance (10%):** `distance = |matchTeamRank − playerTeamRank|`.
    Same team (0) → 100. Subtract 25 per rank level away, floor 0.
  * **Position Match (20%):** Only if the coach has an active
    position filter for this match — then 100 if the player's
    position is in the filter, 0 otherwise. **If no position filter
    is active, this component is neutral (do not penalise) and its
    weight redistributes proportionally across the other three
    components.** Do not let defenders always lose to midfielders
    when no filter is set.
* Make the sort **stable** and **deterministic**. Final tiebreak:
  alphabetical on `preferredName`.
* **UI:** add a sort selector next to the filters
  (`Best fit` / `Ability` / `Position`) so coaches can override the
  default.
* **Tests:** unit tests covering each tier, each score component,
  the neutral-position behaviour, and the stable-order guarantee.

**11. Show selected squad to players (read-only).** When a player
clicks a fixture (opens `PlayerAvailabilitySheet.tsx`), they should
see a "Selected Squad" section listing players currently selected for
that match.
* Each entry: preferred name, position, ability.
* Group/order: GK → DEF → MID → FWD, then ability descending within
  each group.
* If the list is long (>12), collapse with a "Show all" toggle.
* Empty state: "Squad not yet announced".
* **Do not block the availability save** — fetch the squad in
  parallel (e.g. a separate cached query or extending
  `getMyFixtures`) so the sheet opens instantly. Invalidate the
  squad query after a save.
* Coaches still own selection — this section is read-only for
  players.

---

## 3 · Spec-Coverage Audit

While reading the code, audit the following spec items. Add any gaps
to `STOCKTAKE_REPORT.md` and fix them:

- [ ] All eligibility rules enforced **server-side** in the worker
- [ ] `isSuspended` and `matchesToServe` correctly block selection
- [ ] Visiting player restrictions: no cross-team, 5-league-match cup
      gate, 3-consecutive-early-season warning
- [ ] `everRegisteredToPremier` constraint
- [ ] `competitionType` (League / Cup / Plate / Bowl) routes to the
      correct eligibility branch
- [ ] Same-day-higher-team conflict detection
- [ ] Polling for live availability works (30s) without re-fetching
      the full player list

---

## 4 · Constraints (guard rails)

- **No new dependencies** unless absolutely required — justify in the
  PR body.
- **No spec drift** — if a fix contradicts the spec, raise it in the
  report and ask before changing the spec.
- **Do not rewrite the worker** — surgical edits to `worker/src/`
  only. Match existing patterns.
- **Type safety** — no `any` unless the surrounding code already uses
  it and a comment explains why.
- **Keep the diff small** — if a refactor is tempting, leave a TODO
  in the report instead.
- **API contract stability** — multi-select filters (Issue 9) and
  the squad query (Issue 11) must work without breaking existing
  callers.

---

## 5 · Definition of Done

1. **`docs/STOCKTAKE_REPORT.md`** exists, listing every issue found
   (user-reported + spec gaps) with severity, file/line refs, and a
   one-line fix description.
2. All 11 issues above are fixed.
3. `npm run build` exits 0 with zero TS errors.
4. `npm test` (Vitest) passes. New tests cover:
   - Unselect logic (Issue 2)
   - Multi-select filter reducer (Issue 9)
   - Recommendation engine score math + neutral-position behaviour
     (Issue 10)
5. No new dependencies added (per §4).
6. Commit messages reference the issue number from the triage report,
   e.g. `fix(coach): unselect cycle (BUG-02)` or
   `feat(rank): weighted recommendation engine (FEAT-10)`.
7. PR body summarises: triage count, fixes shipped, follow-ups
   intentionally left.

---

## 6 · How to Start

1. `cd "C:\dev\Hockey Trials App\Squad-Selection"`
2. `git status` — confirm clean working tree on
   `End-of-Build-Phase-3-stocktake`
3. Skim `docs/Project_Code_20260705-2346.md` for orientation
4. Read the 5 spec docs (especially the weighted priority formula
   in `Implementation_Roadmap_v2.md` before touching Issue 10)
5. Open the files implied by §2 and start triaging
6. Write `STOCKTAKE_REPORT.md` as you go — don't wait
7. Fix in issue-number order; commit per fix
8. Build, test, smoke, PR

**Begin Part A now.**
