# HKFC Squad Selection App — Implementation Roadmap v3

## Purpose

This roadmap updates the build plan after the eligibility engine is already working. It is written so an AI prompt can understand:

- what is stable and must not be broken,
- why key design decisions exist,
- that the **Recommendation Engine** should be rolled out next,
- and that **Calendar Integration** should follow afterwards.

The eligibility engine is the source of truth. New features should consume its output, not modify its rules.

---

## Current Stable Baseline

| Area | Status |
|---|---|
| `hkha-sync` pipeline | Completed; populates `Matches`, `Match Cards`, `Teams`, `People` |
| Eligibility engine | Implemented in Worker: `evaluatePlayerEligibility` + `getPlayersForMatch` |
| Selection storage | Stored on `Matches.Selected Players Home` / `Selected Players Away`, not a separate selections table |
| Coach UI | Fixture list, squad selection, player selection sync |
| Player UI | Unauthenticated player fixture/availability views |
| Airtable access | Only via Cloudflare Worker; frontend never holds the Airtable token |

The most important point for future work: **the eligibility engine already enforces HKHA rules, HKFC overrides, and exact reason strings. Do not bypass or quietly rewrite it.**

---

## Non-Negotiable Invariants

These explain why the system is built the way it is. Breaking any of them risks invalid selections, misleading coach UI, or broken caches.

| # | Invariant | Why it exists | Avoid |
|---|---|---|---|
| 1 | **Eligibility evaluation order is fixed** | Spec §4 requires admin → suspension → visiting → same-day → premier → play-up → cup → U21. UI, tests, and coach trust depend on it. | Do not reorder checks or short-circuit differently. |
| 2 | **Exact reason strings must be preserved** | Coaches need consistent labels such as `Suspended`, `Visiting player — fixed to registered team`, `Play-up limit reached — re-registration required`. | Do not reword reasons casually; UI and tests expect exact strings. |
| 3 | **All selection writes are revalidated server-side** | Client UI cannot be trusted to enforce eligibility. | Do not add client-only selection logic that skips Worker revalidation. |
| 4 | **Play-up count is computed in the Worker from `Match Cards`** | It requires `Play Up? = true`, `Goalkeeper = false`, current season, and league/cup context. Airtable rollups cannot filter formula fields reliably. | Do not move play-up counting into Airtable rollups or use `People.Playing Position`. |
| 5 | **Team hierarchy comes only from `Teams.Team Rank`** | Rank 1 = highest HKFC team; lower number = higher team. All movement logic depends on this. | Do not infer rank from team name or `Registered Team` text alone. |
| 6 | **Goalkeeper exemption uses `Match Cards.Goalkeeper`** | It is per-appearance, not per-person. A GK registered as outfield may still play up as GK. | Do not use `People.Playing Position` as the GK exemption source. |
| 7 | **Visiting Player cup eligibility uses the confirmed simplification** | v2 deliberately counts all current-season HKFC appearances, not only registered-team appearances, to reduce sync complexity. | Do not “correct” this to literal bye-law team filtering without a product decision. |
| 8 | **Same-day and U21 overrides are intentional HKFC interpretations** | U21 players may play any higher team; kick-off time is ignored; max 3 U21 double-game players per team per day. | Do not revert to literal Bye-Law 7.6 “next higher team only” logic. |
| 9 | **Selections live on `Matches.Selected Players Home/Away`** | Current codebase syncs selections there via `/squad/sync`. The older v2 `Squad Selections` table is not in the current schema. | Do not reintroduce a separate selections table without migration. |
| 10 | **Availability model is exception-only** | No record = available. Only `Maybe` / `Unavailable` are stored. | Do not create `Available` availability records. |
| 11 | **Caches must be invalidated on selection/availability changes** | `players-for-match`, `upcomingFixtures`, and match caches can become stale. | Do not add writes without invalidating the relevant Worker caches. |

---

## Phase A — Recommendation Engine

**Roll out next.** This is the safest major feature because it is read-only and consumes the existing eligibility engine.

### Goal

Help coaches fill short squads by suggesting eligible players. It must **assist**, not auto-select.

### Principles

- Reuse `getPlayersForMatch` output.
- Only recommend players who are already determined eligible or, at most, eligible-with-warning.
- Never recommend:
  - blocked players,
  - unavailable players,
  - already selected players,
  - players blocked by same-day higher-team priority.
- If a coach accepts a recommendation, it should go through the existing selection sync path so the Worker revalidates eligibility.

### Suggested weighting

Keep the v1 weighting unless later tuned by coaches:

| Factor | Weight |
|---|---|
| Playing Ability | 50% |
| Position Match | 20% |
| Play-Up Count | 20% |
| Team Distance | 10% |

`Team Distance` should be derived from `Teams.Team Rank`, not from raw team names.

### Implementation approach

1. Add a read-only Worker endpoint such as `getRecommendations(matchId, side)`.
2. Inside the Worker, build the same `EvaluationContext` already used by `getPlayersForMatch`.
3. Filter to candidates with `eligibilityStatus !== "blocked"`.
4. Score candidates using ability, position, play-up count, and team-rank distance.
5. Return recommendations with reason notes, e.g. `Strong ability match`, `Covers position`, `Low play-up risk`.
6. In the UI, show recommendations as a separate panel or badge, clearly distinct from eligibility blocks/warnings.

### Why this is safe

- It does not change selection storage.
- It does not change eligibility rules.
- It does not require new Airtable tables initially.
- It uses the same Worker data context already proven by the eligibility engine.

---

## Phase B — Calendar Integration

**Roll out after the Recommendation Engine.** This is presentation/notification infrastructure, not eligibility logic.

### Goal

Allow coaches or players to add selected fixtures to calendar apps, e.g. via ICS download or calendar link.

### Principles

- Calendar output must be generated from `Matches` + current selected players.
- Do not change eligibility logic.
- Do not assume availability beyond what the app already knows.
- If any external calendar API or push integration is added later, keep secrets in the Worker only.

### Implementation approach

1. Add a Worker endpoint such as `getMatchCalendar(matchId, side)`.
2. Generate ICS using:
   - `Matches.Date`
   - `Matches.Home Team` / `Away Team`
   - `Matches.Venue`
   - `Matches.Division` / `Competition Type`
   - selected players from `Matches.Selected Players Home/Away`
3. Frontend: add an “Add to calendar” action on the fixture or squad screen.
4. For player-facing use, generate per-player calendar links from the player’s selected matches.
5. Defer two-way sync, Google/Outlook push, and recurring calendar subscriptions until after the core flow is stable.

### Why after Recommendation Engine

- The recommendation engine is internal to squad building.
- Calendar integration depends on stable match data and selection storage.
- It should not influence eligibility, same-day priority, or play-up calculations.

---

## Out of Scope / Deferred

Keep these excluded unless explicitly revisited:

- WhatsApp Business integration
- Automated player approval workflows
- Automatic re-registration processing
- Generic notification framework beyond the existing unavailable → coach trigger
- Two-way calendar sync
- Dashboard enhancements unless needed for multi-team visibility

---

## Prompt-Ready Summary

When working on this codebase:

- Preserve the eligibility engine first.
- The Recommendation Engine is the next feature and must be read-only/advisory.
- Calendar Integration comes after and must only consume existing match/selection data.
- Use `Teams.Team Rank` for hierarchy, `Match Cards` for play-up/GK logic, and Worker-side revalidation for all selections.
- Do not reintroduce a separate selections table, change reason strings, or bypass server-side eligibility checks.