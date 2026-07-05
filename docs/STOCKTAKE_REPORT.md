# Stocktake Report — End of Build Phase 3

**Date:** 2026-07-06  
**Branch:** End-of-Build-Phase-3-stocktake

## Issue 1: Coach squad-selection infinite load — BLOCKER

**Root:** src/pages/SquadSelection.tsx:44 — guard isLoading || !data || !optimisticMatch never shows error.  
optimisticMatch returns null when data.match is missing, but data is truthy → infinite spinner.  
Also: usePlayersForMatch error state never destructured.

**Fix:** Destructure error, render error state with retry. Add explicit !data?.match check.

## Issue 2: 3-state toggle — BUG

**Root:** src/pages/SquadSelection.tsx:69 — else if (effectiveStatus === 'Selected') nextAction = 'reserve' creates 3-state cycle.  
Should be binary: Not Selected ⇄ Selected. No existing test.

**Fix:** Change to else nextAction = 'remove' (after Reserve eradication). Add Vitest test.

## Issue 3: Maybe availability invisible — BUG

**Root:** src/components/PlayerFixtureCard.tsx:34 — const isMaybe = ... is dead code, never used.  
Card border only accounts for isSelected, isReserve, isUnavailable. Maybe falls to default (same as Available).  
AvailabilityIndicator subcomponent does render Maybe badge, but no card-level visual distinction.

**Fix:** Add isMaybe to card border condition with amber/warning styling. Remove dead isReserve after Issue 4.

## Issue 4: Eradicate Reserve — FEATURE REMOVAL

12 files affected:
- SquadSelection.tsx (Delta type, toggle, optimisticMatch, handleBulkReserve)
- PlayerRow.tsx (Reserve badge)
- MatchHeader.tsx (reserveCount, 3-col→2-col)
- PlayerFixtureCard.tsx (isReserve, SelectionBadge)
- PlayerDashboard.tsx (reserveCount stat, 3-col→2-col)
- FixtureCard.tsx (reserveCount)
- BulkActionBar.tsx (Mark Reserve button)
- getPlayersForMatch.ts (MatchInfo reserveCount)
- getUpcomingFixtures.ts (UpcomingFixture reserveCount)
- worker/squad.ts (SelectPlayerInput, matchInfo, batchUpdateSquad)
- worker/fixtures.ts (upcoming fixtures reserveCount)

## Issue 5: Bulk checkbox — POLISH

**Root:** src/components/PlayerRow.tsx:44-49 — checkbox always rendered.

**Fix:** Hide behind "Bulk Select Mode" toggle in filter bar.

## Issue 6: Dashboard formatting reconciliation — POLISH

Shared components needed: StatusBadge, AvailabilityChip, SectionHeader, MetaLine.  
Currently duplicated inline across PlayerRow, PlayerFixtureCard, PlayerDashboard.

## Issue 7: Division/Ability labels — POLISH

PlayerFixtureCard.tsx:50 — division without label.  
PlayerDashboard.tsx:91 — position/ability without labels.

## Issue 8: Textarea label alignment — POLISH

PlayerAvailabilitySheet.tsx:82-89 and AvailabilitySheet.tsx:82-89 — label is inline, container missing flex-col.

## Issue 9: Multi-select filters — FEATURE

Upgrade PlayerFilters to Set<string> with toggle chips. AND across categories, OR within. URL persistence. Tests.

## Issue 10: Recommendation Engine — SPEC CONFLICT

Spec says: "Recommendation engine (weighted scoring for squad shortfalls — deferred post-MVP)" under Out of Scope.  
Implementing now is spec drift. Flagged for product owner decision.

## Issue 11: Selected squad for players — FEATURE

No "Selected Squad" section in PlayerAvailabilitySheet.  
No getSquadForMatch endpoint exists.

## Spec Coverage Audit

| Check | Status |
|-------|--------|
| All eligibility rules server-side | PASS (batchUpdateSquad uses minimal ctx — gap) |
| isSuspended / matchesToServe | PASS |
| Visiting player restrictions | PASS (minor: mc.match as Match cast issue) |
| everRegisteredToPremier | PASS |
| competitionType routing | PASS |
| Same-day-higher-team conflict | PASS |
| Polling without full re-fetch | PASS |

**Security gap:** batchUpdateSquad creates minimal EvaluationContext (sameDayMatches:[], allExceptions:[], matchCards:[]) — skipping same-day, visiting, play-up, and cup checks on batch create. Suspended players are still caught via eligibility.status check.

**Minor edge case:** checkVisitingPlayer casts mc.match (string[] Airtable record IDs) as unknown as Match — the competitionType check won't work at runtime.
