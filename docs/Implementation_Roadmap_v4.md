# HKFC Squad Selection - Engineering Specification v4

**Normative Engineering Specification · Architecture Reference · Business Rules · Developer Guide**

**Version:** 4.0
**Date:** 2026-08-08
**Status:** Authoritative - supersedes all previous roadmaps and specifications

**Language Convention:** This document uses IETF RFC 2119 keywords.
`MUST` = absolute requirement. `MUST NOT` = absolute prohibition.
`SHOULD` = recommended unless clear reason otherwise. `MAY` = optional.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Principles](#2-design-principles)
3. [Architectural Invariants](#3-architectural-invariants)
4. [Overall Architecture](#4-overall-architecture)
5. [Domain Model](#5-domain-model)
6. [Data Architecture](#6-data-architecture)
7. [Business Engines](#7-business-engines)
   - 7.1 Eligibility Engine
   - 7.2 Ranking Engine
   - 7.3 Recommendation Engine
   - 7.4 Availability Engine
   - 7.5 Selection Engine
8. [Coach Portal](#8-coach-portal)
9. [Player Portal](#9-player-portal)
10. [API Specification](#10-api-specification)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Worker Architecture](#12-worker-architecture)
13. [Infrastructure](#13-infrastructure)
14. [Security](#14-security)
15. [Performance](#15-performance)
16. [Testing](#16-testing)
17. [Observability](#17-observability)
18. [Operational Runbook](#18-operational-runbook)
19. [Future Roadmap](#19-future-roadmap)
20. [AI Contributor Guide](#20-ai-contributor-guide)
21. [Appendices](#21-appendices)

---

## 1. Executive Summary

### 1.1 Project Vision

HKFC Squad Selection is a mobile-first web application that enables Hong Kong Football Club hockey coaches to assemble legal and competitive squads across eight men's teams. The application enforces HKHA competition bye-laws and HKFC-specific operational interpretations at every stage, ensuring that coaches never accidentally field ineligible players.

### 1.2 Objectives

- **Eliminate eligibility violations** by enforcing all HKHA rules and HKFC overrides before a selection can be saved
- **Reduce administrative overhead** by assuming availability unless exceptions are recorded, and deriving all secondary rankings from a single persisted Section Rank
- **Provide cross-team visibility** so coaches managing multiple teams (or the Section Captain) can coordinate player movement without spreadsheets or group chats
- **Surface actionable intelligence** through recommendations, play-up tracking, and compliance dashboards - without overwhelming coaches with noise
- **Maintain a single source of truth** in Airtable, with all business logic validated server-side in the Cloudflare Worker

### 1.3 Scope

**In scope:**
- Coach portal: fixture list, squad selection with full eligibility annotations, player ranking with drag-and-drop, ability group configuration
- Player portal: fixture visibility, availability management, calendar sync
- Eligibility engine: 8-step evaluation pipeline with exact reason strings and source-citable rule IDs
- Ranking engine: section ranking, derived ranks, ability group badges, audit logging
- Recommendation engine: weighted scoring for squad shortfalls
- Selection sync: Airtable-persisted selections with automatic cache invalidation
- Automatic re-registration: the 4th qualifying play-up triggers a server-side registration event that updates People.Registered Team
- Calendar integration: ICS feed generation for coaches and players

**Out of scope:**
- WhatsApp Business integration
- Generic push notification framework
- Two-way calendar sync (Google/Outlook API)
- Multi-club support
- AI-powered selection suggestions beyond the recommendation engine

### 1.4 Guiding Philosophy

1. **Coaches are the primary users.** The application exists to help them, not to automate them.
2. **Eligibility first.** Every player presented in a selection view has been evaluated. No selection is saved without server-side revalidation.
3. **Exception management, not prescription.** Players are assumed available. Coaches manage exceptions. The system surfaces what needs attention.
4. **Worker owns business logic.** The React frontend is a presentation layer. It never determines eligibility, play-up rules, or ranking.
5. **Mobile first.** The application is designed for use on a phone at the side of a pitch. Desktop is secondary.

### 1.5 Success Criteria

- Zero eligibility violations attributable to application error
- Coach time-to-squad reduced from hours (spreadsheets + group chats) to minutes (in-app selection + recommendations)
- Section Captain has complete visibility across all teams without manual data gathering
- New coach onboarding requires no knowledge of HKHA bye-laws - the app handles eligibility
- The codebase can be understood, maintained, and extended by a developer or AI assistant reading only this document plus the source files

---

## 2. Design Principles

### 2.1 Single Source of Truth

Every business rule has exactly one authoritative owner. No rule is implemented in two places. Examples:

| Rule | Owner |
|---|---|
| Player eligibility | Worker - `evaluatePlayerEligibility()` |
| Play-up count | Worker - computed from `Match Cards` in eligibility context |
| Team hierarchy | Airtable - `Teams.Team Rank` field |
| Section ranking | Airtable - `People.Section Rank` field |
| Ability group assignment | Worker - `computeAbilityAssignment()` |
| Recommendation scoring | Worker - `buildRecommendations()` |

**Anti-pattern:** Duplicating the play-up count calculation in React for display. The Worker is authoritative; the UI displays what the Worker returns.

### 2.2 Worker Owns Business Logic

The Cloudflare Worker (`worker/src/`) is the **only** tier that:
- Evaluates eligibility
- Computes play-up counts
- Determines ability group assignments
- Scores recommendations
- Validates ranking mutations
- Invalidates caches after writes

The React frontend (`src/`) is a **presentation layer**. It:
- Renders server-provided data
- Manages UI state (filters, sort, drag-and-drop drafts)
- Submits mutations to the Worker
- Handles optimistic updates for perceived responsiveness
- Polls for real-time availability changes

### 2.3 Deterministic Behaviour

The system prefers deterministic, predictable behaviour over "smart" heuristics. Examples:
- Eligibility evaluation order is fixed and must never change without corresponding test updates
- Tiebreaking in recommendations uses alphabetical name ordering - not random scores
- Ranking initialization uses a deterministic seed (ability rank, then alphabetical)
- Ability group sub-group assignment uses a pure mathematical formula with no randomness

### 2.4 Availability is Exception-Based

Players are **assumed available.** The system only stores records when a player is **Maybe** or **Unavailable.** No record = Available.

This design minimises Airtable record usage:
- 8 teams × 22 fixtures × 20 players = 3,520 potential records per season if every combination were stored
- Actual: only exceptions are stored, typically < 500 records per season

### 2.5 Section Rank is the Only Persisted Ranking

`People.Section Rank` is the single persisted ranking. Everything else is derived:

| Derived field | Computation |
|---|---|
| Team Rank | Count of players per `Registered Team` ordered by Section Rank |
| Positional Rank | Count of players per `Playing Position` ordered by Section Rank |
| Playing Ability | `computeAbilityAssignment(sectionRank, activeCount, config)` |

These derived fields are computed in the Worker and cached. They are never persisted independently.

### 2.6 Mobile First

Design priorities:
1. Mobile (320px - 640px)
2. Tablet (640px - 1024px)
3. Desktop (1024px+)

Implementation patterns:
- Filter panels become bottom sheets on mobile (`< sm:`)
- Navigation compresses to icon-only on mobile
- Player rows use flex-wrap for badges that would overflow
- Fixed bottom bars include `safe-area-inset-bottom` padding
- Drag-and-drop uses PointerSensor with 8px activation distance (touch-friendly)

### 2.7 Operational Simplicity

Reduce administration. Prefer defaults, bulk actions, and exception management over repetitive manual tasks.

Examples:
- Bulk toggle for selecting all visible eligible players
- "Save All" for ranking reorder
- Configuration sheet for ability groups (single save rather than per-group edits)
- Calendar sync generates ICS feeds - coaches don't manually create calendar events

---

## 3. Architectural Invariants

**⚠️ CRITICAL:** These invariants define the boundaries of safe modification. Breaking any invariant risks invalid selections, misleading coach UI, or broken caches. Every invariant has a unique identifier for reference in code reviews, tests, and AI contributor guidance.

### 3.1 Eligibility Engine Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-001 | Eligibility evaluation order is fixed: admin → suspension → visiting → same-day → premier → play-up → cup → warnings | Spec §4; coaches, tests, and UI depend on consistent ordering |
| INV-002 | Exact reason strings must be preserved. Do not reword. | Coaches need consistent labels. Tests assert exact strings. |
| INV-003 | All selection writes are revalidated server-side | Client UI cannot be trusted to enforce eligibility |
| INV-004 | `evaluatePlayerEligibility` is the only function that determines eligibility | No other module may produce an eligibility decision |
| INV-005 | Reason tags include source citations (`Bye-Law X.Y` or `HKFC Spec §Z`) | Enables coaches and admins to trace decisions to governing documents |
| INV-006 | Eligibility results are never cached for writes - always recomputed | Stale eligibility = invalid selections |
| INV-007 | `ruleId` constants in `RULE_IDS` must never change values | Golden tests depend on stable identifiers |

### 3.2 Ranking Engine Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-010 | Section Rank is the only persisted ranking | Everything else (Team Rank, Position Rank, Playing Ability) is derived |
| INV-011 | Playing Ability is computed from Section Rank + config; never set independently | `computeAbilityAssignment(rank, activeCount, config)` |
| INV-012 | Team Rank and Positional Rank are never persisted to Airtable | They are annotative only - added in the Worker response |
| INV-013 | Section Rank must be a positive integer ≤ active count for every active player | Data integrity; the ranking engine assumes contiguous ranks |
| INV-014 | Ranking mutations invalidate the active ranking cache immediately | Coaches must see their changes reflected |
| INV-015 | Reorder mutations validate that the submitted list length matches the active player count | Prevents stale-client overwrites (409 Conflict response) |
| INV-016 | Only the Section Captain can modify the ability group configuration | `PUT /api/ranking/config` checks `isSectionCaptain` |

### 3.3 Recommendation Engine Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-020 | Recommendations consume eligibility output; they never determine eligibility | Architectural separation of concerns |
| INV-021 | Recommendations are advisory only; they never auto-select players | Coaches make the final decision |
| INV-022 | Blocked, unavailable, and already-selected players are excluded from the candidate pool | Basic correctness |
| INV-023 | Scoring is deterministic: same inputs always produce the same order | No randomness; alphabetical tiebreaking |
| INV-024 | "Maybe" availability incurs a -45 score penalty to demote below "Available" candidates | Availability is binary for selection purposes |
| INV-025 | Position scores are neutral (20) when no position filter is active | Avoids penalising players in one position over another when there's no preference |

### 3.4 Data Architecture Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-030 | Airtable is only accessed through the Cloudflare Worker; the frontend never holds the Airtable token | Security: prevent token exfiltration |
| INV-031 | Generated code (`src/generated/`) is never edited manually | Schema changes flow through the generation pipeline |
| INV-032 | `Teams.Team Rank` determines all team hierarchy; rank 1 = highest | Do not infer rank from team name |
| INV-033 | `Match Cards.Goalkeeper` is the authoritative source for the GK exemption | Per-appearance, not per-person |
| INV-034 | `Match Cards.Play Up?` formula field is the authoritative play-up indicator | Computed from `Team` vs `Player Team` |
| INV-035 | Selections live on `Matches.Selected Players Home` / `Selected Players Away` | Not in a separate selections table |
| INV-036 | Availability is exception-based: no record = Available | Minimises Airtable record count |
| INV-037 | Season boundary is 1 July: `Matches.Season` formula field | All season-scoped calculations depend on this |
| INV-038 | Competition type is determined by `Matches.Division` or `Matches.Competition Type` | Cup rules depend on correct classification |

### 3.5 Cache Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-040 | All caches must be invalidated after writes that affect cached data | Stale caches = stale UI |
| INV-041 | `syncSquad` invalidates: `match:{id}`, `season-index:*`, `players-for-match:{id}:*`, `all-matches:{season}`, `calendar:*` | Full invalidation fan-out for selection changes |
| INV-042 | Write paths always read fresh Airtable records - never from the 30s match record cache | Merging onto stale data would lose concurrent updates |
| INV-043 | `season-index` cache aggregates exceptions + match cards + selections per season (10-min TTL) | Performance: avoids per-request rebuild of the evaluation context |
| INV-044 | Cache keys are namespaced: `match:`, `season-index:`, `players-for-match:`, `ranking:`, `club-reference`, `calendar:` | Prevents cross-namespace invalidation collisions |
| INV-045 | Read-heavy endpoints use 30s-10min TTLs; writes invalidate immediately | Balance freshness vs Airtable API rate limits |

### 3.6 Security Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-050 | Supabase manages all authentication; no custom auth system | Leverages battle-tested auth infrastructure |
| INV-051 | Airtable Personal Access Token is stored as a Cloudflare Worker secret, never in client code | Prevents token exfiltration |
| INV-052 | All write endpoints require authentication; anonymous endpoints are read-only (player fixtures, availability) | Principle of least privilege |
| INV-053 | Section Captain role is verified server-side before config mutations | `PUT /api/ranking/config` checks `isSectionCaptain` |
| INV-054 | Coach role is verified server-side before selection writes | `selectPlayer`, `removeSelection`, `syncSquad` |
| INV-055 | API responses include CORS headers restricted to `ALLOWED_ORIGIN` environment variable | Prevents cross-origin abuse |

### 3.7 UI/UX Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-060 | UI never determines eligibility - it only displays Worker-returned status | Prevents client-side eligibility bypass |
| INV-061 | Blocked players appear in the list with a specific reason label and disabled selection control | Coaches must see why; they must not be able to select accidentally |
| INV-062 | Cross-team selection conflicts are visible as badges independent of eligibility status | Coaches need to know who has "dibs" on a player |
| INV-063 | All save bars show pending change count and require explicit Discard or Save | Prevents accidental changes |
| INV-064 | Unsaved changes are guarded by `beforeunload` and React Router `useBlocker` | Prevents accidental navigation loss |
| INV-065 | Mobile filter panels are bottom sheets (`< sm:`), not inline | Mobile screen real estate is too limited for inline filters |
| INV-066 | Drag-and-drop ranking uses PointerSensor with 8px activation distance | Prevents accidental drags on touch devices |

### 3.8 Testing Invariants

| ID | Invariant | Rationale |
|---|---|---|
| INV-070 | Golden eligibility tests must pass for every blocked reason string and rule ID | Catch regressions in the eligibility engine |
| INV-071 | Eligibility evaluation order tests must never change expected outcomes | Freezing the spec requires frozen tests |
| INV-072 | Every new business rule must have corresponding golden test assertions | Prevent untested rule changes from being deployed |

---

## 4. Overall Architecture

### 4.1 System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Browser)                          │
│                                                                  │
│  React 19 · Vite · Tailwind CSS v4 · TanStack Query             │
│  TanStack Virtual · dnd-kit · lucide-react · Supabase JS        │
│                                                                  │
│  Pages:                                                          │
│  ├─ PlayerDashboard   (/)                                        │
│  ├─ CoachDashboard    (/coach)                                   │
│  ├─ FixtureList       (/coach/fixtures)                          │
│  ├─ SquadSelection    (/coach/match/:matchId)                    │
│  └─ PlayerRanking     (/coach/ranking)                           │
└──────────────────────┬──────────────────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Worker                            │
│                                                                  │
│  worker/src/                                                     │
│  ├─ index.ts          Router + HTTP handlers                     │
│  ├─ eligibility.ts    Eligibility engine (8-step pipeline)       │
│  ├─ ranking.ts        Ranking engine (section rank + derived)    │
│  ├─ recommendations.ts Recommendation engine (scoring)           │
│  ├─ squad.ts          Selection sync + player-for-match          │
│  ├─ fixtures.ts       Fixture query for coaches & players        │
│  ├─ availability.ts   Exception management                      │
│  ├─ calendar.ts       ICS feed generation                        │
│  ├─ profile.ts        User profile resolution                    │
│  ├─ reference.ts      Club reference data (cached)               │
│  ├─ metrics.ts        Eligibility operational metrics            │
│  ├─ dashboard.ts      Play-up watch + recent changes             │
│  ├─ abilityGroup.ts   Ability group / sub-group computation      │
│  ├─ abilityRank.ts    Ability rank mapping (A+ = 24 → H- = 1)   │
│  ├─ airtable.ts       Airtable API client + env types            │
│  └─ http.ts           HTTP utilities (json, errorJson, etc.)     │
└──────┬──────────────────────┬───────────────────────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐    ┌─────────────────┐
│   Supabase   │    │    Airtable     │
│              │    │                 │
│ Auth · User  │    │ People · Teams  │
│ Management   │    │ Matches · Match │
│              │    │ Cards · Avail   │
│              │    │ Exceptions ·    │
│              │    │ Ability Groups  │
│              │    │ Selection Events│
└──────────────┘    └─────────────────┘
```

### 4.2 Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend framework | React | 19 |
| Build tool | Vite | 7 |
| CSS framework | Tailwind CSS | 4 |
| State management | TanStack Query | 5 |
| Virtualization | TanStack Virtual | 3 |
| Drag-and-drop | dnd-kit | 6 |
| Icons | lucide-react | latest |
| Type checking | TypeScript | 5.x |
| Testing | Vitest | 4 |
| Backend runtime | Cloudflare Workers | - |
| Auth provider | Supabase | - |
| Data store | Airtable | - |
| Data sync | hkha-sync (GitHub Actions) | - |

### 4.3 Authentication Flow

```
1. User visits app
2. Supabase Auth checks session (PKCE flow)
3. If unauthenticated → Login page
4. On successful login → AuthGate outlet renders
5. `useMyProfile()` fetches via Worker: GET /api/my-profile?email=...
6. Worker looks up email in People.Email → returns roles + teams
7. If coach → /coach routes; if player only → / (PlayerDashboard)
```

All authenticated Worker endpoints receive `email` as a query parameter or request body field. The Worker resolves the People record each time (or from `club-reference` cache). There is no JWT-to-People-ID mapping; the email is the user identity.

### 4.4 Data Flow (Selection)

```
Coach taps player row
  → SquadSelection.handleToggleSelection(playerId)
  → optimistic update to local state (pendingDeltas)
  → Coach taps Save
  → POST /squad/sync { matchId, selectedIds, actingEmail, side }
  → Worker.syncSquad():
      1. Read match record FRESH from Airtable (never cached)
      2. Resolve HKFC side (home/away)
      3. Derby safety: ensure player not on both sides
      4. airtableUpdate() with Selected Players Home/Away
      5. Log selection events (optional table, non-blocking)
      6. Invalidate ALL affected caches:
         - match:{matchId}
         - season-index:{season}
         - players-for-match:{matchId}:*
         - all-matches:{season}
         - calendar:player:*, calendar:team:*
  → Response: { success: true }
  → Client invalidates queries: playersForMatch, upcomingFixtures, recommendations
  → UI refreshes with server-authoritative state
```

### 4.5 Caching Strategy

```
┌──────────────────────────────────────────────────────┐
│ Cache Layer (in-memory, per-Worker isolate)          │
│                                                      │
│ club-reference       10 min  Teams + active players  │
│ season-index:{s}     10 min  Exceptions + cards +    │
│                               selections per season  │
│ all-matches:{s}      10 min  All match records       │
│ match:{id}           30 sec  Single match record     │
│ players-for-match:    5 min  Eligibility annotations │
│   {id}:{side}                                            │
│ ranking:active       30 sec  Active ranking list     │
│ ranking:inactive     30 sec  Inactive player list    │
│ ranking:config        5 min  Ability group config    │
│ calendar:player:*    10 min  Player ICS feed         │
│ calendar:team:*      10 min  Team ICS feed           │
└──────────────────────────────────────────────────────┘
```

Cache invalidation is **write-driven**: every mutation endpoint invalidates the specific caches it affects. There is no time-based cache sweeping.

---

## 5. Domain Model

### 5.1 Player

**Purpose:** Represents a hockey player - the core entity of the system.

**Lifecycle:**
1. Created in Airtable `People` table (via membership admin, not the app)
2. Becomes active when `Active = true`
3. Assigned Section Rank (automatically or by Section Captain)
4. Receives derived Playing Ability based on rank
5. May be deactivated (`Active = false`) → appears in inactive list
6. May have `Status = "Applicant"` → appears with applicant badge and stage

**Owner:** Airtable `People` table. Worker reads via `mapPlayer()`.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID (`recXXXXXX`) |
| `preferredName` | string | Display name |
| `givenNames` | string | Legal given name(s) |
| `surname` | string | Legal surname |
| `email` | string | Used for Supabase auth matching |
| `active` | boolean | Inactive players excluded from all views |
| `registeredTeam` | string | HKHA-registered team name |
| `playingPosition` | string | Goalkeeper / Defender / Midfielder / Forward / Flexible/Varies |
| `playingAbility` | string | A+ through H- (persisted derived field) |
| `isVisitingPlayer` | boolean | Hard filter: HKHA Bye-law 6.x |
| `isSuspended` | boolean | Hard filter: admin-entered |
| `matchesToServe` | number | Suspension matches remaining |
| `everRegisteredToPremier` | boolean | Hard filter for cups |
| `u21Eligible` | boolean | U21 same-day exemption |
| `sectionRank` | number | **The only persisted ranking** |
| `status` | string | "Applicant" or undefined |
| `applicantStage` | string | Trial application stage |

**Derived fields (computed in Worker, not persisted):**

| Field | Computation |
|---|---|
| `teamRank` | Count per `registeredTeam` ordered by `sectionRank` |
| `positionalRank` | Count per `playingPosition` ordered by `sectionRank` |
| `eligibilityStatus` | `evaluatePlayerEligibility(player, match, context)` |
| `playUpCount` | Count of `Match Cards` where `Play Up? = true` and `Goalkeeper = false` (current season) |

### 5.2 Team

**Purpose:** Represents an HKFC hockey team - drives all hierarchy logic.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID |
| `teamName` | string | "HKFC A", "HKFC B", etc. |
| `teamRank` | number | 1 = highest ranked; drives all eligibility |
| `isPremier` | boolean | Triggers Premier Division restrictions |
| `targetSquadSize` | number | Default squad target; default 16 |
| `active` | boolean | Inactive teams excluded |
| `coach` | string[] | Linked People IDs with coach access |
| `teamCaptain` | string[] | Linked People IDs |
| `sectionCaptain` | string[] | Linked People IDs with section-wide access |

**Relationships:**
- Team Rank must be unique and sequential across all active teams
- `isPremier` triggers Bye-law 7.4 restrictions
- `sectionCaptain` grants access to all teams' fixtures and ranking configuration

### 5.3 Match

**Purpose:** Represents a hockey fixture - the context for squad selection.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID |
| `matchDate` | string | ISO 8601 date-time |
| `season` | string (formula) | Computed: "2025-2026" (1 July boundary) |
| `division` | string | "Division 1", "Cup", "Plate", etc. |
| `competitionType` | string | "League" or "Cup" |
| `homeTeam` | string | Team name (may be HKFC or opposition) |
| `awayTeam` | string | Team name |
| `homeTeamScore` | number | Post-match |
| `awayTeamScore` | number | Post-match |
| `matchStatus` | string | "Scheduled" / "Played" / "Rescheduled" |
| `venue` | string | Match venue |
| `fixtureId` | string | HKHA fixture ID |
| `selectedPlayersHome` | string[] | Selected Player IDs for home HKFC side |
| `selectedPlayersAway` | string[] | Selected Player IDs for away HKFC side |

**HKFC side resolution:**
- If only one of home/away is an HKFC team name (found in `teamRankMap`), use that side
- If both are HKFC teams (derby), the URL `?side=home|away` parameter determines which side is being viewed/edited
- The same match record serves both sides - selections are stored in separate array fields

### 5.4 Match Card

**Purpose:** Records actual match participation - the source of truth for play-up counts and cup eligibility.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID |
| `player` | string[] | Linked Player ID |
| `match` | string[] | Linked Match ID |
| `team` | string | Team whose match this was |
| `playerTeam` | string | Player's registered team |
| `playUp` | boolean (formula) | `true` when `Team ≠ Player Team` |
| `goalkeeper` | boolean | **Per-appearance - authoritative for GK exemption** |
| `jersey` | number | Jersey number (upsert dedup key) |
| `goals` | number | Goals scored |
| `cards` | string[] | Disciplinary cards (Y1-Y7, R1-R7) |
| `u21` | boolean | U21 designation |
| `vp` | boolean | Visiting Player designation |
| `captain` | boolean | Captain |
| `season` | string | Season identifier |
| `fixtureId` | string | HKHA fixture ID |
| `rawPlayerName` | string | Name as printed on HKHA card |

**Key invariants:**
- `goalkeeper` is per-appearance, not per-person. A player registered as GK may play outfield; a field player may play GK.
- `playUp` is a formula computed from `Team` vs `Player Team` - not manually set.
- Play-up counts are derived from Match Cards in Worker code, not from Airtable rollups (rollups cannot filter formula fields).

### 5.5 Availability Exception

**Purpose:** Records when a player is NOT available. No record = Available.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID |
| `player` | string[] | Linked Player ID |
| `match` | string[] | Linked Match ID |
| `availabilityStatus` | string | "Maybe" or "Unavailable" |
| `note` | string | Optional free-text reason |
| `updatedBy` | string[] | Linked Person ID of updater |
| `updatedAt` | string | Last modified timestamp |

**Design principle:** Exception-based. Creating a record with "Unavailable" makes the player unavailable. Deleting the record returns them to Available. There are no "Available" records.

### 5.6 Ability Group Configuration

**Purpose:** Defines the capacity of each ability group (A-G). Group H is residual (auto).

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Airtable record ID |
| `group` | string | "A" through "H" |
| `capacity` | number | Player capacity for this group |
| `isResidual` | boolean | True for group H (auto) |

**Config map shape:** `{ A: 5, B: 8, C: 12, D: 15, E: 15, F: 15, G: 10 }`

Group H is always the residual - it automatically contains all players not covered by A-G capacities.

### 5.7 Selection Event

**Purpose:** Audit log of selection actions. Optional table - writes are non-blocking.

**Persisted fields:**

| Field | Type | Description |
|---|---|---|
| `player` | string[] | Linked Player ID |
| `match` | string[] | Linked Match ID |
| `team` | string | Team name |
| `action` | string | "Selected" or "Removed" |
| `actor` | string | Coach email |

---

## 6. Data Architecture

### 6.1 Airtable Schema

The system uses 7 Airtable tables:

| Table | Purpose | Records (typical) |
|---|---|---|
| **People** | Players, coaches, admins | ~200 |
| **Teams** | HKFC team hierarchy | 8 |
| **Matches** | Fixtures | ~180/season |
| **Match Cards** | Player appearances | ~2,000/season |
| **Availability Exceptions** | Non-available players | ~500/season |
| **Ability Group Configuration** | Group capacities | 8 (one per group) |
| **Selection Events** | Audit log (optional) | Variable |

### 6.2 Generated Code

The `src/generated/` directory contains code generated from the Airtable schema:

| File | Contents |
|---|---|
| `domainTypes.ts` | TypeScript interfaces: `Player`, `Team`, `Match`, `MatchCard`, `AvailabilityException`, `AbilityGroupConfigMap`, `RankingList` |
| `tableNames.ts` | `TABLES` constant mapping logical names to Airtable table names |
| `fieldMaps.ts` | `PEOPLE_FIELDS`, `TEAMS_FIELDS`, `MATCHES_FIELDS`, etc. - mapping TS property names to Airtable field names |

**⚠️ INVARIANT:** Generated code is never edited manually. When the Airtable schema changes, the generation script must be re-run, and the generated files replaced atomically.

### 6.3 Mapper Layer

`src/mappers/` translates Airtable record shapes to domain types:

| Mapper | Input | Output |
|---|---|---|
| `playerMapper.ts` | Airtable record → `mapPlayer()` | `Player` |
| `teamMapper.ts` | Airtable record → `mapTeam()` | `Team` |
| `matchMapper.ts` | Airtable record → `mapMatch()` | `Match` |
| `matchCardMapper.ts` | Airtable record → `mapMatchCard()` | `MatchCard` |
| `availabilityMapper.ts` | Airtable record | `AvailabilityException` |
| `abilityGroupConfigMapper.ts` | Airtable record → `mapAbilityGroupConfiguration()` | `AbilityGroupConfiguration` |

All mappers are pure functions - they accept an Airtable `fields` object and return a typed domain object.

### 6.4 Repository Pattern

The `worker/src/airtable.ts` module provides the data access layer:

```typescript
// Low-level Airtable operations
airtableFindAll(env, tableName, formula?) → Record[]
airtableFindById(env, tableName, recordId) → Record
airtableUpdate(env, tableName, recordId, fields) → Record
airtableBatchCreate(env, tableName, records) → void
airtableBatchUpdate(env, tableName, updates) → void

// Utilities
linkId(linkedField) → string | undefined  // Extract ID from linked record
escapeFormulaValue(value) → string        // Escape for Airtable formula
```

The `reference.ts` module provides the cached club reference data:

```typescript
getReferenceData(env) → {
  players: Player[],       // All active players
  teams: Team[],           // All teams
  teamRankMap: Record<teamName, teamRank>,  // name → rank lookup
}
// Cached as "club-reference" (10 min TTL)
```

### 6.5 Domain Type Versioning

Domain types are versioned implicitly through the generated code. When the Airtable schema changes:

1. Update the generation script's field mapping
2. Re-generate `domainTypes.ts`, `tableNames.ts`, `fieldMaps.ts`
3. Update affected mappers
4. Update affected Worker queries
5. Run the full test suite
6. The golden eligibility tests will catch any regressions in field name changes

No explicit version field is maintained on domain types. The generated code IS the version.

---

## 7. Business Engines

### 7.1 Eligibility Engine

**Location:** `worker/src/eligibility.ts`
**Entry point:** `evaluatePlayerEligibility(player, match, context)`
**Status:** Stable - do not modify rule order without updating golden tests

#### 7.1.1 Architecture

The eligibility engine is a **pure function** with no side effects. It evaluates a single player against a single match within a pre-built `EvaluationContext`.

```
evaluatePlayerEligibility(player, match, context) → {
  status: "eligible" | "warning" | "blocked",
  reason: string | null,         // Required when blocked
  reasonTag: ReasonTag | null,   // Source-citable tag
  ruleId: string | null,         // RULE_IDS constant
  warnings: string[],            // Warning messages
  warningTags: WarningTag[],     // Warning source tags
  playUpCount: number,           // Current-season qualifying count
  selectedByTeam: string | null, // Other team's selection
  sameDayHigherTeam: string | null, // Higher team available same day
}
```

#### 7.1.2 Evaluation Context

```typescript
interface EvaluationContext {
  teamMap: Map<string, Team>;           // All teams by name
  rankMap: Record<string, number>;      // Team name → rank
  targetTeam: string;                   // Team being selected for
  sameDayMatches: Match[];              // Other matches on same date
  sameDayFixtures: { matchId, teamName }[];
  allSelections: VirtualSelection[];    // All selections this season
  selectionsByPlayer: Map<string, Set<string>>; // Player → "matchId:team"
  sameDaySelectionsByTeam: Map<string, Set<string>>;
  allExceptions: { playerId, matchId, status }[];
  unavailablePlayerMatchKeys: Set<string>;
  matchCards: MatchCard[];              // All match cards this season
  matchCardsByPlayer: Map<string, MatchCard[]>;
  matchesById: Map<string, Match>;      // For competition type lookup
  currentSeason: string;
  playersById: Map<string, Player>;     // For U21 double-game counting
  completedLeagueMatchesByTeam: Map<string, number>;
}
```

The context is built once per match evaluation and includes all season-level data needed by every rule step. It is cached as `season-index:{season}` (10-min TTL).

#### 7.1.3 Evaluation Order

The evaluation order is **fixed and must never change:**

| Step | Rule | Status |
|---|---|---|
| 1 | Admin Data Validation (§2.2) | Blocked: "Admin data incomplete" |
| 2 | Suspension (§5) | Blocked: "Suspended" |
| 3 | Visiting Player Restrictions (§6) | Blocked: varies |
| 4 | Same-Day Team Movement (§7) | Blocked: "Available for [Team] on same day" / "Selected for [Team] on same day" |
| 5 | Premier Division Restrictions (§8) | Blocked: "Premier movement restriction - team has not completed 3 matches" |
| 6 | Play-Up Rules (§9-11) | Blocked: "Higher-to-lower movement requires Committee approval" or "Play-up limit reached - re-registration required" |
| 7 | Cup Eligibility (§14) | Blocked: varies (Premier ban, min appearances, cross-cup) |
| 8 | U21 Double-Game Limit (§12.3) | Blocked: "U21 double-game limit reached" |

**Short-circuit rule:** The first step that produces a `blocked` result stops further evaluation. Warnings are collected from earlier steps.

#### 7.1.4 Rule Details

**Step 1 - Admin Data Validation:**
- Blocked if: `active !== true`, or `registeredTeam` empty, or `playingPosition` empty, or `playingAbility` empty
- Reason: `"Admin data incomplete"`
- Rule ID: `RULE_IDS.ADMIN_DATA_INCOMPLETE`

**Step 2 - Suspension:**
- Blocked if: `isSuspended === true` OR `matchesToServe > 0` OR an automatic card suspension is active (see Spec 5.2)
- Reason: `"Suspended"`
- Rule ID: `RULE_IDS.SUSPENSION`
- Note: manual fields (`Is Suspended`, `Matches To Serve`) plus an automatically calculated card suspension (derived from Match Cards + Matches per Bye-Law 16.3). Either blocks the player; neither clears the other.

**Step 3 - Visiting Player Restrictions:**
- If `isVisitingPlayer === true`:
  - Blocked if trying to play for a different team: `"Visiting player - fixed to registered team"`
  - Blocked if Cup fixture and < 5 appearances for registered team: `"Visiting player - fewer than 5 appearances for registered team"`
  - Warning if < 5 appearances in early season: `"Visiting player early-season requirement at risk"`
- Rule IDs: `RULE_IDS.VISITING_FIXED_TEAM`, `RULE_IDS.VISITING_CUP_APPEARANCES`

**Step 4 - Same-Day Movement:**
- For each same-day match involving a higher-ranked HKFC team:
  - If player is already Selected for that team: `"Selected for [Team] on same day"` (blocked)
  - If player has no Unavailable exception for that team: `"Available for [Team] on same day"` (blocked)
- Rule IDs: `RULE_IDS.SAME_DAY_AVAILABLE`, `RULE_IDS.SAME_DAY_SELECTED`
- Entire calendar day, kick-off times ignored

**Step 5 - Premier Division Restrictions:**
- Applies when either `registeredTeam` or `targetTeam` is Premier
- Blocked if either team has < 3 completed league matches this season
- Reason: `"Premier movement restriction - team has not completed 3 matches"`
- Rule ID: `RULE_IDS.PREMIER_MOVEMENT`

**Step 6 - Play-Up Rules:**
- If moving higher → lower: blocked `"Higher-to-lower movement requires Committee approval"` (Rule ID: `RULE_IDS.HIGHER_TO_LOWER`)
- If moving lower → higher: check play-up count
  - Play-up count = Match Cards where `Play Up? = true` AND `Goalkeeper = false` AND `season = currentSeason`
  - At 2: warning `"Second play-up appearance"`
  - At 3: warning `"Third play-up appearance"`
  - At 4: blocked `"Play-up limit reached - re-registration required"` (Rule ID: `RULE_IDS.PLAYUP_LIMIT`)
- Goalkeeper exemption: appearances where `Goalkeeper = true` are excluded (Bye-law 7.5)
- At 4: the Automatic Re-registration Service (section 7.6) processes the threshold event and updates `People.Registered Team`; the Step 6 block above remains as a fail-safe while the registration event is pending
- Goalkeeper status for re-registration is per Match Card (`Match Cards.Goalkeeper`): goalkeeper play-up appearances never count; a goalkeeper-positioned player's field-player play-ups count normally; the destination must be an upward move (never demotes)

**Step 7 - Cup Eligibility:**
- Only applies to Cup/Plate/Bowl fixtures (determined by `Division` or `Competition Type`)
- Premier ban: `everRegisteredToPremier = true` → blocked `"Cup ban - ever registered to Premier Division"` (Rule ID: `RULE_IDS.CUP_BAN_PREMIER`)
- Minimum appearances: < 2 league appearances → blocked `"Fewer than 2 league appearances - ineligible for Cup"` (Rule ID: `RULE_IDS.CUP_MIN_LEAGUE_APPEARANCES`)
- Cross-cup: already played cup for another team → blocked `"Already played in a Cup for [Team] this season"` (Rule ID: `RULE_IDS.CROSS_CUP`)

**Step 8 - U21 Double-Game Limit:**
- Only applies when player `u21Eligible = true` AND playing for a higher team
- Count U21 players playing a second match on the same day for the target team
- At 2: warning `"U21 double-game limit approaching"`
- At 3: blocked `"U21 double-game limit reached"` (Rule ID: `RULE_IDS.U21_DOUBLE_GAME_LIMIT`)

#### 7.1.5 HKFC Operational Overrides

| Area | Bye-Law Text | HKFC Interpretation |
|---|---|---|
| U21 movement | Immediate next higher-ranked team only | Any higher-ranked team permitted |
| U21 timing | No timing restriction in text, but some interpret as "higher team plays after" | Kick-off sequence ignored |
| Goalkeeper exemption | Bye-law 7.5 ambiguously drafted | Non-A-team GKs exempt when playing as GK; `Match Cards.Goalkeeper` is authoritative |
| Availability lock | - | No Unavailable exception = player is available; same-day lock applies |
| Play-up count | - | Single counter for league + cup; 4th triggers re-registration |
| Higher-team priority | - | If higher team selects a player already selected by lower team, lower selection is auto-removed |

#### 7.1.6 Why This Architecture

**Why is the evaluation order fixed?**
The order reflects legal priority: administrative completeness MUST be checked before eligibility rules, and suspensions (HKHA-enforced) MUST be checked before club-level rules like same-day movement. Changing the order would produce different results for overlapping conditions - a suspended visiting player, for example, MUST be blocked by Suspension (Step 2) rather than Visiting Player rules (Step 3). The fixed order also enables coaches to trust that a "Suspended" block means the suspension is the definitive issue, not one of several ambiguously ordered reasons.

**Why is eligibility NOT evaluated in React?**
Client-side evaluation could be bypassed by modifying the JavaScript. Server-side revalidation on every write is non-negotiable. The frontend displays what the Worker returns; it MUST NOT compute eligibility independently.

**Why does Step 8 (U21) run after Cup rules?**
A U21 double-game limit violation is a same-day operational constraint, not a competition eligibility rule. Cup rules (Step 7) are HKHA-mandated and MUST take precedence.

#### 7.1.7 Safe Extension Points

**Extensions that SHOULD NOT cause regressions:**
- Adding new `RULE_IDS` constants + corresponding checks in `evaluatePlayerEligibility()` at the appropriate step
- Adding new warning tags for advisory information
- Adding new fields to `EvaluationContext` via `buildEvaluationContext()`
- Adding new fields to `Player` domain type via mapper

**Extensions that MUST NOT be attempted without an ADR:**
- Reordering existing evaluation steps - golden tests depend on fixed order
- Modifying existing reason strings - coaches and tests depend on exact strings
- Removing a rule step - may create eligibility gaps
- Bypassing eligibility for performance - correctness over speed
- Duplicating eligibility logic in React or recommendation engine

#### 7.1.8 Regression Checklist

Before merging any Eligibility Engine change, verify:

- [ ] INV-001 through INV-007 preserved
- [ ] `eligibility.test.ts` passes (56 tests)
- [ ] `golden-eligibility.test.ts` passes (23 tests) - ALL reason strings + rule IDs verified
- [ ] `recommendations.test.ts` passes - consumes eligibility output
- [ ] Evaluation order unchanged (Step 1 -> Step 2 -> ... -> Step 8)
- [ ] No reason strings modified (add only)
- [ ] `RULE_IDS` constants unchanged (add only)
- [ ] Short-circuit behaviour preserved
- [ ] All 13 blocked reason strings still produced
- [ ] All 4 warning strings still produced
- [ ] HKFC overrides still applied (U21 any-team, GK exemption)
- [ ] No eligibility logic added to React

#### 7.1.9 Performance

- `season-index` cache (10-min TTL) aggregates all season-level data: exceptions, match cards, all matches, virtual selections
- Per-match `players-for-match:{id}:{side}` cache (5-min TTL) stores computed eligibility annotations
- Evaluation of a single player is O(1) for most steps, O(n) for same-day checks (n = same-day matches)
- Total per-match evaluation: ~200 players × ~8 steps = ~1,600 operations (sub-millisecond)

### 7.2 Ranking Engine

**Location:** `worker/src/ranking.ts`
**Entry points:** `getActiveRanking()`, `reorderRanking()`, `activatePlayer()`, `deactivatePlayer()`
**Status:** Stable

#### 7.2.1 Architecture

The ranking engine manages a single ordered list: the Section Ranking.

```
┌─────────────────────────────────────────────────────┐
│              Section Ranking (Persisted)             │
│                                                      │
│  Rank 1: Alice (A+, DEF, HKFC A)                     │
│  Rank 2: Ben   (A,  MID, HKFC A)                     │
│  Rank 3: Claire (A-, FWD, HKFC B)                    │
│  ...                                                 │
│  Rank N: Zoe   (H-, GK,  HKFC H)                     │
│                                                      │
│              ↓ derive in-memory                      │
│                                                      │
│  Team Rank:   1st in HKFC A, 1st in HKFC B, ...      │
│  Position Rank: 1st DEF, 1st MID, 1st FWD, ...       │
│  Playing Ability: A+, A, A-, B+, B, ...              │
│  (computed from Section Rank via config)             │
└─────────────────────────────────────────────────────┘
```

#### 7.2.2 Data Flow

**Read:**
```
GET /api/ranking
  → getActiveRanking(env)
  → Check cache "ranking:active" (30s TTL)
  → If miss: fetchActiveRankingFromAirtable()
      → airtableFindAll(People, active players formula)
      → sort by Section Rank ASC
      → annotateWithDerivedRanks (Team Rank, Positional Rank)
      → getAbilityGroupConfig (compute Playing Ability)
  → Return RankingList { players, activeCount, config, version }
```

**Write (Reorder):**
```
POST /api/ranking/reorder { playerIds: string[], actingEmail }
  → validate: array non-empty, length = active count, no duplicates/unknowns
  → invalidateCache("ranking:active")
  → fetchActiveRankingFromAirtable (fresh)
  → compute rank updates for changed positions
  → applySectionRankUpdates (batched Airtable updates, 4 concurrent workers)
  → recomputeDerivedFields (Playing Ability + update People records)
  → Return updated RankingList
```

#### 7.2.3 Drag-and-Drop Semantics

The frontend uses dnd-kit for drag-and-drop reordering:
1. User drags a player row → `DndContext.onDragStart` records `activeDragId`
2. User drops → `onDragEnd` calls `reorderDraft(sourceId, targetId, before)`
3. `reorderDraft` manipulates `draftIds` state (local, not persisted)
4. A save bar appears showing pending changes
5. User clicks Save → `POST /api/ranking/reorder` with the full ordered ID list
6. Worker validates, applies, and returns updated list
7. Frontend clears `draftIds` - the save bar disappears

#### 7.2.4 Derived Ranks

```typescript
function annotateWithDerivedRanks(players: Player[]): Player[] {
  const teamCounters = new Map<string, number>();
  const posCounters = new Map<string, number>();
  return players.map((p) => {
    const teamRank = (teamCounters.get(p.registeredTeam) ?? 0) + 1;
    teamCounters.set(p.registeredTeam, teamRank);
    const positionalRank = (posCounters.get(p.playingPosition) ?? 0) + 1;
    posCounters.set(p.playingPosition, positionalRank);
    return { ...p, teamRank, positionalRank };
  });
}
```

#### 7.2.5 Ability Group Assignment

```typescript
function computeAbilityAssignment(rank: number, totalActive: number, config: AbilityGroupConfigMap) {
  // Iterates groups A→G, accumulates capacity
  // If rank falls within a group's range → assign that group + sub-group
  // Otherwise → group H (residual)
  // Sub-group: k = floor(nG/3), r = nG % 3
  //   r=0: plus=k, neutral=k, minus=k
  //   r=1: plus=k, neutral=k+1, minus=k
  //   r=2: plus=k+1, neutral=k+1, minus=k
  // Top-ranked players in each group get "+", bottom get "-"
}
```

Display format: `"A+"`, `"A"`, `"A-"`, `"B+"`, ..., `"H-"`.

#### 7.2.6 Audit Logging

Every ranking mutation logs to the Worker console:
```
[Ranking Audit] 2026-08-07T15:30:00.000Z | User: coach@hkfc.com | Player: recXXX | Old Rank: 12 | New Rank: 8
```

This is the only audit mechanism. No separate audit table is maintained for ranking changes.

#### 7.2.7 Activate / Deactivate

**Activate:**
- Sets `Active = true`, `Section Rank = activeCount + 1` (appended to bottom)
- Triggers full derived field recomputation

**Deactivate:**
- Removes from ranking, shifts all lower ranks up by 1
- Sets `Active = false`, `Section Rank = null`, `Playing Ability = null`
- Triggers full derived field recomputation

#### 7.2.8 Initialize / Backfill

`POST /api/ranking/initialize` builds the initial Section Ranking:
1. Players with existing `Section Rank` values are placed first (in ascending order)
2. Remaining players are sorted by:
   - Playing Ability (descending via `ABILITY_RANK`)
   - Alphabetical by preferred name (tiebreak)
3. All players receive sequential ranks starting from 1
4. Derived fields are recomputed

#### 7.2.9 Why This Architecture

**Why is Section Rank the only persisted ranking?**
Persisting Team Rank, Positional Rank, and Playing Ability independently would create multiple sources of truth that must be kept in sync. By deriving everything from Section Rank, a single reorder propagates correctly across all derived dimensions. There is no risk of inconsistency.

**Why is Playing Ability auto-computed rather than manual?**
Manual ability assignment introduces coach subjectivity and inconsistency. Deriving it from Section Rank + group configuration ensures: (a) ability is always consistent with rank, (b) config changes instantly update all badges, (c) new players get a deterministic initial assignment.

**Why are derived ranks computed in-memory rather than persisted?**
Derived ranks (Team Rank, Positional Rank) are view-specific annotations. They change whenever the Section Ranking changes. Persisting them would require updating every active player on every reorder - expensive and unnecessary when they can be computed in O(n) on read.

#### 7.2.10 Extension Points

**Safe extensions (SHOULD NOT cause regressions):**
- Adding new derived rank dimensions (e.g., "Form Rank", "Attendance Score") - add as in-memory annotations
- Weighted composite ranking views - consume Section Rank as input, produce new display columns
- Position-specific ranking filters - derive from Section Rank, filtered by position
- UI enhancements: custom sort orders, coach-specific views

**Unsafe extensions (MUST NOT be attempted without ADR):**
- Persisting Playing Ability independently - violates single-source-of-truth
- Adding a second ranking dimension as a persisted field - creates sync problems
- Allowing coaches to manually override Playing Ability - undermines deterministic assignment
- Bypassing the contiguous-rank invariant - breaks all rank-based algorithms

#### 7.2.11 Regression Checklist

Before merging any Ranking Engine change, verify:

- [ ] INV-010-INV-016 preserved (Section Rank invariants)
- [ ] `abilityGroup.test.ts` + `abilityRank.test.ts` pass
- [ ] Contiguous ranking invariant maintained (no gaps in Section Rank values)
- [ ] Derived ranks re-computed correctly after mutations
- [ ] Cache keys invalidated: `ranking:active`, `ranking:config`, `club-reference`
- [ ] Audit log entries emitted for every mutation
- [ ] Stale detection (409 Conflict on length mismatch) still works
- [ ] Ability badges update synchronously after config changes
- [ ] API response shape unchanged (backwards compatible)
- [ ] Generated types not manually edited

### 7.3 Recommendation Engine

**Location:** `worker/src/recommendations.ts`
**Entry point:** `buildRecommendations(pool, targetTeamRank, teamRankMap, options)`
**Status:** Stable - CURRENT IMPLEMENTATION

#### 7.3.0 Philosophy

Recommendations are:
- **Advisory** - The engine suggests; coaches decide. MUST NOT auto-select.
- **Deterministic** - Same inputs always produce the same output. No randomness.
- **Explainable** - Every recommendation carries reason tags coaches can understand.
- **Transparent** - Scoring weights are documented and tunable.

Recommendations are NOT:
- **Mandatory** - Coaches MAY ignore all recommendations.
- **AI-generated** - No ML/LLM involved. Pure deterministic scoring.
- **Probabilistic** - No confidence scores or fuzzy matching.

#### 7.3.1 Why This Architecture

**Why does Recommendation consume Eligibility rather than re-evaluate?**
Duplicating eligibility logic in the recommendation engine would create two code paths that can diverge. By consuming the already-computed `eligibilityStatus` from `getPlayersForMatch`, the recommendation engine is always consistent with what the coach sees in the player list.

**Why are "Maybe" players penalised by -45 rather than excluded?**
Excluding Maybe players would hide them entirely. A coach might want to see who's available as a second choice. The -45 penalty ensures they rank below all Available candidates while remaining visible.

**Why is "Club Proximity" scored but not disclosed as a reason tag?**
Revealing team-distance as a reason would encourage coaches to game the scoring by manipulating registered teams. It's a legitimate scoring factor but not a decision criterion coaches should optimise for.

#### 7.3.2 Architecture

The recommendation engine is **read-only** and **advisory.** It consumes the eligibility engine's output and produces scored, explainable suggestions for coaches.

```
getPlayersForMatch(matchId, side)
  → annotated players (eligibility + availability + play-up count)
  → filter: eligible/warning only, not unavailable, not already selected
  → score by ability (50%) + position (20%) + play-up capacity (10%) + team distance (20%)
  → sort by score desc, then alphabetical tiebreak
  → return top N with reason tags
```

#### 7.3.2 Scoring Algorithm

| Factor | Max Points | Calculation |
|---|---|---|
| **Playing Ability** | 50 | `(ABILITY_RANK[ability] / 24) × 50` |
| **Position Fit** | 20 | Exact match = 20, Flexible/Varies = 10, mismatch = 0. If no position filter active: 20 (neutral) |
| **Play-Up Capacity** | 10 | For same-team players: 10 (automatic). For lower-team players: `max(0, 10 - playUpCount × 3)` |
| **Team Distance** | 20 | Same team = 20. Play-up: `max(0, 20 - distance × 5)`. Play-down = 0 |
| **"Maybe" Penalty** | -45 | Applied as a flat subtraction after total computation, ensuring Maybe players are below all Available players |

**Total score range:** 0-100. The -45 penalty for "Maybe" ensures they rank below all Available candidates.

#### 7.3.3 Reason Tags

Each recommendation carries up to 3 reason tags:
- `"Top Ability"` - `ABILITY_RANK ≥ 22` (A-level)
- `"Play-Up Capacity"` - lower-team player with < 4 play-ups (capacity remaining)
- `"Perfect Position Match"` - exact position match when filter active
- `"Versatile Choice"` - "Flexible/Varies" player when filter active

"Club Proximity" is intentionally NOT disclosed - it's a scoring factor but not a reason shown to coaches.

#### 7.3.4 Exclusion Rules

The following are **always excluded** from recommendations:
- Players with `eligibilityStatus === "blocked"`
- Players with `availabilityStatus === "Unavailable"`
- Players with `selectionStatus === "Selected"` (already in the squad)

Additionally, the `excludeIds` parameter (passed by the frontend) excludes players already selected in the current session.

#### 7.3.5 Integration Point

The frontend displays recommendations via `RecommendationsPanel`:
- Only shown when `selectedCount < targetSquadSize` (squad is short)
- Each recommendation card shows: name, position, ability badge, score, reason tags
- "Select" button triggers `updateDeltas([{ playerId, action: 'select' }])` - goes through normal selection flow
- Worker revalidates eligibility server-side when the selection is saved

#### 7.3.6 Safe Extension Points

**Extensions that SHOULD NOT cause regressions:**
- Tuning scoring weights - modify constants in `buildRecommendations()`
- Adding new reason tags - append to the reasons array
- Adding new position modifiers - extend the position scoring switch
- UI enhancements - new badge styles, sort orders, display columns
- Adding a "top N per position" breakdown

**Extensions that MUST NOT be attempted without an ADR:**
- Adding eligibility checks - MUST consume eligibility output, never re-evaluate
- Auto-selecting recommended players - violates advisory-only principle
- Adding ML/LLM-based scoring - violates deterministic behaviour
- Removing the Maybe penalty - coaches depend on Available-first ordering
- Adding probabilistic or confidence scores - violates transparency

#### 7.3.7 Regression Checklist

Before merging any Recommendation Engine change, verify:

- [ ] INV-020-INV-025 preserved (Recommendation invariants)
- [ ] `recommendations.test.ts` passes (all 12 tests)
- [ ] No eligibility logic duplicated (consume `eligibilityStatus`, don't re-evaluate)
- [ ] Blocked, unavailable, and already-selected players excluded
- [ ] Scoring is deterministic (same inputs → same order)
- [ ] "Maybe" penalty (-45) still applied
- [ ] Reason tags ≤ 3 per recommendation
- [ ] Score range 0-100 maintained
- [ ] Alphabetical tiebreaking preserved
- [ ] No auto-selection added

### 7.4 Availability Engine

**Location:** `worker/src/availability.ts`
**Entry points:** `setAvailability()`, `setMyAvailability()`
**Status:** Stable

#### 7.4.1 Model

Exception-based: no record = Available. Only Maybe and Unavailable are stored.

```
Player → Match → Availability Exception
  ├─ No record:      Available (default)
  ├─ Maybe:           Recorded with optional note
  └─ Unavailable:     Recorded with optional note
```

#### 7.4.2 Endpoints

**Coach:**
- `POST /api/set-availability` - coach sets availability for any player
- Body: `{ playerId, matchId, status ("Maybe"|"Unavailable"), note? }`
- Creates or updates the Availability Exception record

**Player:**
- `POST /api/set-my-availability` - player sets own availability
- Body: `{ fixtureId, status, note?, exceptionId? }`
- If exceptionId provided and status is "Available" - deletes the exception record
- Otherwise creates or updates

#### 7.4.3 Cache Invalidation

Availability changes invalidate:
- `season-index:{season}` (exceptions are part of the season context)
- `players-for-match:{matchId}:*` (availability feeds eligibility)
- `calendar:player:*` (calendar feeds depend on availability)

#### 7.4.4 Polling

The Squad Selection page polls availability every 30 seconds:
```typescript
useAvailabilityPoll(matchId, isEnabled)
  → GET /api/match/{matchId}/availability
  → Returns { exceptions: [{ playerId, status, notes }] }
  → Merged into player list so coaches see live availability updates
```

Polling pauses when the browser tab is not visible (`document.hidden`).

### 7.5 Selection Engine

**Location:** `worker/src/squad.ts`
**Entry points:** `selectPlayer()`, `removeSelection()`, `syncSquad()`
**Status:** Stable

#### 7.5.1 Selection Storage

Selections are stored directly on the `Matches` record as linked record arrays:
- `Matches.Selected Players Home` - for the home HKFC side
- `Matches.Selected Players Away` - for the away HKFC side

There is **no separate selections table.** The v2 roadmap's `Squad Selections` table was superseded by this direct storage model.

#### 7.5.2 Selection Sync

`POST /squad/sync` is the primary selection mutation endpoint:

```typescript
syncSquad(env, matchId, targetPlayerIds, actingEmail, side)
  1. Read match record FRESH (not from cache)
  2. Resolve HKFC side
  3. Derby safety: ensure player not selected for BOTH sides
  4. Update Matches.{Selected Players Home/Away}
  5. Log selection events (optional, non-blocking)
  6. Invalidate all affected caches:
     - match:{matchId}
     - season-index:{season}
     - all-matches:{season}
     - players-for-match:{matchId}:*
     - calendar:player:*
     - calendar:team:*
```

#### 7.5.3 Derby Safety

When both teams in a match are HKFC teams (derby), a player must never be selected for both sides:

```typescript
if (side === "home" || side === "away") {
  const oppositeField = side === "home" ? selectedPlayersAway : selectedPlayersHome;
  const oppositeCurrent = side === "home" ? match.selectedPlayersAway : match.selectedPlayersHome;
  updates[oppositeField] = (oppositeCurrent || []).filter(id => !cleanIds.includes(id));
}
```

#### 7.5.4 Frontend Optimization

The frontend uses optimistic updates for perceived responsiveness:
1. Clicking a player row immediately toggles the selection state in `pendingDeltas`
2. A save bar appears with the pending change count
3. On Save, `POST /squad/sync` sends the full selected IDs array
4. On success, the cache is queried and the save bar disappears
5. On failure, a toast error is shown

---

### 7.6 Automatic Re-registration Service

**Location:** `worker/src/registration.ts`
**Entry points:** `reconcileRegistrations()` (scan), `POST /api/registration/reconcile` (coach-only), scheduled cron (`0 18 * * *` UTC = 02:00 Asia/Hong_Kong daily)
**Status:** Implemented (dry-run default; apply mode gated by the `AUTO_REGISTRATION_ENABLED` Worker var)

#### 7.6.1 Business Rule

When a player records their **4th qualifying play-up appearance of the current season**, the system automatically re-registers the player:

- Qualifying play-up = the single shared definition in `worker/src/playUp.ts` (`Play Up? = true`, `Goalkeeper = false`, current season) - the same definition the eligibility engine and the Play-Up Watch use. There is exactly one definition in the codebase.
- Match Cards are the sole source of truth. Squad selections, availability, recommendations and intended selections never trigger re-registration.
- Goalkeeper status is per Match Card: `Match Cards.Goalkeeper` decides each appearance (never `People.Playing Position`). Goalkeeper play-up appearances never count toward the threshold; a goalkeeper-positioned player''s field-player play-ups count normally.
- Upward movement only: a qualifying play-up is an appearance for a team higher-ranked than the player''s current Registered Team. Play-downs never count, and a non-upward destination (or an unresolvable registration) is left for review (`NON_UPWARD_DESTINATION` / `UNRESOLVED_REGISTRATION`) instead of an automatic demotion.

#### 7.6.2 Destination Algorithm

> Select the team with the highest frequency among the four qualifying play-up appearances; if frequency is tied, select the lowest-ranked team using `Teams.Team Rank` (the largest rank number).

| Appearances | Destination |
|---|---|
| B, B, B, B (4+0) | B |
| B, B, B, C (3+1) | B |
| B, B, C, D (2+1+1) | B |
| B, B, C, C (2+2 tie) | C (lowest-ranked, Team Rank 3) |
| B, C, D, E (1+1+1+1 tie) | E (lowest-ranked, Team Rank 5) |

- Team names are never used to infer hierarchy; `Teams.Team Rank` is authoritative.
- Only the four chronological triggering appearances (match date asc, Match Card id asc) determine the destination; the season-cumulative play-up count continues to grow and is never reset.
- Historical Match Cards are never rewritten - including `Match Cards.Player Team`.
- Fail-safe: a triggering card with no Team, an unknown Team, a missing/invalid Team Rank, a missing match date, duplicate Match Cards for the same match, two tied teams sharing one rank, or a destination that would not be an upward move produces a diagnostic and NO registration change (automatic re-registration never demotes).

#### 7.6.3 Registration Events (the event ledger)

The threshold is an EVENT processed once per player per season, persisted in the `Registration Events` Airtable table (created by the Section Captain / admin; same convention as Ranking Events):

| Field | Type | Notes |
|---|---|---|
| Player | link (People) | |
| Previous Registered Team | text | |
| New Registered Team | text | |
| Triggering Match Card | link (Match Cards) | the 4th chronological qualifying card |
| Season | text | e.g. `2026-2027` |
| Event Type | single select | `auto_reregister` |
| Timestamp | date/time (UTC) | server-stamped |

A previously processed `auto_reregister` event for the player/season prevents reprocessing: administrator overrides of `People.Registered Team` are never overwritten afterwards. Until the table exists the Worker degrades to dry-run plans and never writes.

#### 7.6.4 Trigger, Dry-run and Activation

- **Scheduled scan:** daily cron (`[triggers]` in `worker/wrangler.toml`, 02:00 Asia/Hong_Kong). Runs apply mode only when `AUTO_REGISTRATION_ENABLED="true"`; otherwise it logs a dry-run report and performs no writes.
- **Manual scan:** `POST /api/registration/reconcile` with body `{"mode":"dry-run"|"apply"}` (coach / Section Captain auth; dry-run default; apply rejected with 403 `AUTO_REGISTRATION_DISABLED` while the var is off). No client input can influence which player or destination is written - the scan is computed entirely server-side from Match Cards.
- **Dry-run report:** player, current Registered Team, qualifying count, the four triggering appearances, frequency by team, calculated destination, destination reason, diagnostics. No Airtable writes.
- **Activation steps:** (1) create the Registration Events table in Airtable (schema above); (2) run a dry-run and review the report; (3) set `AUTO_REGISTRATION_ENABLED="true"` on the deployed Worker; (4) monitor Workers Logs for `[Registration]` lines.

#### 7.6.5 Safety

- Idempotent by the event ledger plus a fresh pre-write re-check of both the player record and the ledger (concurrent Worker isolates cannot double-process).
- The People update happens BEFORE the event create: a failed update never produces an event, and a failed event create is reported as an error and self-heals on the next scan.
- Targeted cache invalidation after each mutation: `club-reference`, `registration-events:<season>`, `season-index:<season>`, `players-for-match:*`, `player-by-email:<email>`, `ranking:active`/`ranking:inactive`, `calendar:*`.
- The Step 6 play-up block (`Play-up limit reached - re-registration required`) is retained as a fail-safe: it still blocks selections above the registered team while a threshold event is unprocessed, and it keeps enforcing the season-cumulative limit for further play-ups above the new registration.

---

## 8. Coach Portal

### 8.1 Architecture

The coach portal is accessed at `/coach` and is protected by the `CoachLayout` component, which verifies `profile.isCoach`. All coach routes are lazy-loaded to minimise the player bundle.

### 8.2 Coach Dashboard (`/coach`)

**Purpose:** Landing page showing exceptions that need attention.

**Components:**
- Welcome header with coach's preferred name
- **Play-Up Watch:** Players with 2+ play-up appearances (warning or critical)
  - 2 appearances: "Approaching play-up limit"
  - 3 appearances: "Next appearance triggers re-registration"
  - 4+ appearances: "Registration required" (entry retained for season-cumulative visibility while the Automatic Re-registration Service processes the event - see section 7.6)
- **Fixture List** (embedded - shared with `/coach/fixtures`)

**States:**
- Loading: Skeleton cards for play-up watch entries
- Empty: No play-up watch section (hides itself)
- Error: Not shown (individual query errors are handled in the fixture list)

### 8.3 Fixture List (`/coach/fixtures`)

**Purpose:** Browse fixtures, see squad status, navigate to selection view.

**Features:**
- Team tabs derived from `profile.coachTeams` (or all teams for section captains)
- "All" tab shows all fixtures across all accessible teams
- Past fixture toggle (default: hidden, persisted in URL)
- Date-grouped fixture cards showing:
  - Match details (teams, division, venue, time)
  - Squad status: `selectedCount / targetSquadSize` with shortfall indicator
  - Maybe/Unavailable name popovers (click to expand)
- Calendar export (ICS download) per team
- URL-parameter-driven tab state for deep linking

**Navigation:** Tapping a fixture card → `/coach/match/{matchId}?side=home|away`

### 8.4 Squad Selection (`/coach/match/:matchId`)

**Purpose:** The core workflow - select players for a specific match.

**Components:**
- **MatchHeader:** Match details + squad status bar (selected count, target, GK indicator, position breakdown)
- **RecommendationsPanel:** Shown when squad is short. Suggests eligible, available players with reason tags
- **PlayerFilters:** Multi-dimensional filtering (position, eligibility, selection, availability, ability, name search)
- **PlayerRow list:** Virtualized (TanStack Virtual), sorted by selection status then ability
- **Save bar:** Fixed bottom bar showing pending changes with Discard/Save buttons

**Player row information:**
- Name with U21/VP badges
- Position (short code) + Playing Ability
- Registered Team + play-up count + availability status
- Availability notes (italic, truncated)
- Cross-team conflict badges (Selected: [Team] / Available: [Team])
- Block reason badges (❌ red) and warning badges (⚠️ amber)
- Toggle selection (checkbox → selected indicator)

**Interactions:**
- Tap row → toggle selection (creates pending delta)
- "Select All" checkbox → bulk toggle all eligible visible players
- Filter changes persist in URL search params
- Availability polls every 30 seconds (paused when tab hidden)
- Save bar appears on first change
- Discard resets all pending changes
- Save sends full selected IDs array to Worker

**Unsaved changes guard:**
- Browser `beforeunload` event handler
- React Router `useBlocker` for in-app navigation
- ConfirmDialog: "Discard unsaved changes?"

**States:**
- Loading: Skeleton cards (6 rows)
- Error: Destructive message + Retry button
- Empty: "No match data available"
- No matching players: "No players match the current filters" (dashed border)

### 8.5 Player Ranking (`/coach/ranking`)

**Purpose:** Manage the Section Ranking - the single source of truth for player hierarchy.

**Components:**
- Back navigation to Coach Dashboard
- Configuration button (Section Captain only)
- **Filter bar:** Multi-select chips for Team, Position, Applicant Stage, Search, Inactive toggle
  - On mobile: filter button opens a bottom sheet
- **Virtualized player list:** Drag-and-drop reorder, up/down step buttons
- **Each player row:**
  - Drag handle (grip icon)
  - Photo (clickable for full-size overlay)
  - Section Rank number
  - Name + shirt number + applicant badge + CV/Comments buttons
  - Position · Team · Team Rank · Positional Rank
  - Ability badge (colored by group)
  - ⚙️ "More Actions" menu: "Move to rank..." + "Deactivate"
- **Inactive section:** Toggleable, shows deactivated players with "Reactivate" button
- **Save bar:** Appears on any rank change with Discard/Save
- **Configuration sheet:** Group capacity sliders with bar chart visualization, validation (total ≤ active count)

**Interactions:**
- Drag row to reorder → local draft state
- Tap ⚙️ → popover: "Move to rank..." opens rank input sheet, "Deactivate" opens confirmation
- Move to rank sheet: number input with validation
- CV button (applicants only): expands sports background text inline
- Comments button: expands coach comments inline
- Configuration sheet: Section Captain only, saves synchronously with badge recomputation

**States:**
- Loading: 8-row skeleton
- Error: Destructive message + Retry
- Empty: "No players match the current filters"

### 8.6 Mobile UX Patterns

- Filter activation: bottom sheet (`Sheet` component, `side="bottom"`)
- Navigation: icon-only buttons on mobile (< `sm:`), labels on desktop
- Save bars: `safe-area-inset-bottom` padding for notched devices
- Row text: flex-wrap for badges that would overflow
- Drag-and-drop: 8px activation distance (prevents accidental drags on touch)
- Photo overlay: full-screen modal with dark backdrop

---

## 9. Player Portal

### 9.1 Player Dashboard (`/`)

**Purpose:** View upcoming fixtures, manage availability, sync calendar.

**Components:**
- **Header:** Logo + app name + Coach View button (if coach) + Calendar Sync + Logout
- **Identity card:** Player name, team, position, shirt number
- **Upcoming Fixtures:** Registered team's matches
- **Higher Teams & Play-Ups:** Same-day higher-ranked team matches (eligible for play-up)
- **PlayerFixtureCard:** Per-fixture card with availability quick-select (Available/Maybe/Unavailable)
- **PlayerAvailabilitySheet:** Detailed availability panel with notes
- **CalendarSyncSheet:** ICS subscription link generation

**Availability workflow:**
1. Default: Available (no action needed)
2. Tap fixture → quick-select: Available / Maybe / Unavailable
3. Tap again → detailed sheet with notes field
4. Changes are saved immediately via `POST /api/set-my-availability`
5. Optimistic update: UI changes instantly, reverts on error

**Calendar:**
- Calendar icon opens `CalendarSyncSheet`
- Generates per-player ICS subscription link
- Link includes all fixtures where player is selected or eligible

**States:**
- Loading: Skeleton cards for header + fixtures
- No fixtures: "No upcoming fixtures for your team" (dashed border)
- Coach user: "Coach View" button visible

### 9.2 Authentication

Players and coaches both authenticate via Supabase:
1. Login page (email + password via Supabase Auth)
2. After login, `useAuth()` hook resolves the session
3. `useMyProfile()` fetches the Worker for role resolution
4. If coach → `/coach`; if player only → `/`

---

## 10. API Specification

### 10.1 Authentication Model

All authenticated endpoints require `email` as a query parameter (GET) or `actingEmail` in the request body (POST). The Worker resolves the People record and checks roles.

Unauthenticated endpoints (player-facing) accept a People record ID directly.

### 10.2 Endpoint Reference

#### Profile

**`GET /api/my-profile`**
- Auth: Yes (`?email=`)
- Response: `ProfileData { preferredName, roles, isCoach, isAdmin, isSectionCaptain, coachTeams[] }`
- Cache: N/A (always fresh via Supabase session)
- Error: 400 (email missing), 404 (player not found)

#### Fixtures

**`GET /api/my-fixtures`**
- Auth: Yes (`?email=`)
- Response: `GetMyFixturesOutput { playerName, registeredTeam, fixtures[], eligibleOtherFixtures[] }`
- Cache: No (always fresh - player-specific, low frequency)

**`GET /api/upcoming-fixtures`**
- Auth: Yes (`?email=` + optional `?team=`)
- Response: `GetUpcomingFixturesOutput { fixtures[] }`
- Cache: 5 min (staleTime: 300s in React Query)
- Note: Section captains receive all teams' fixtures when no `team` filter

**`GET /api/player-fixtures/:playerId`**
- Auth: No (player-facing, validates player is active)
- Response: `{ playerName, registeredTeam, fixtures[] }`

#### Squad

**`GET /api/match/:matchId/players`**
- Auth: Yes
- Query: `?side=home|away`
- Response: `{ match: MatchInfo, players: AnnotatedPlayer[] }`
- Cache: 5 min
- Performance: Uses `season-index` + `players-for-match` caches

**`GET /api/match/:matchId/squad`**
- Auth: Yes
- Response: `{ matchId, players: [{ id, name, position, ability }] }`
- Players sorted: GK → DEF → MID → FWD, then by ability descending

**`GET /api/match/:matchId/availability`**
- Auth: Yes
- Response: `{ exceptions: [{ playerId, status, notes }] }`
- Used by: `useAvailabilityPoll` (30s polling)

**`GET /api/match/:matchId/recommendations`**
- Auth: Yes
- Query: `?side=home|away&position=Defender&limit=5`
- Response: `{ matchId, side, targetPosition, recommendations[] }`
- Performance: Reuses `getPlayersForMatch` output

**`POST /squad/sync`**
- Auth: Yes
- Body: `{ matchId, selectedIds, actingEmail, side }`
- Response: `{ success: true }`
- Side effects: Updates match record, logs selection events, invalidates 6 cache namespaces
- Validation: Server-side eligibility NOT re-checked for bulk sync (individual selects use `selectPlayer`)

**`POST /api/select-player`**
- Auth: Yes
- Body: `{ matchId, playerId, side }`
- Response: `{ success: true }`
- Validation: Re-runs eligibility server-side before creating selection

**`POST /api/remove-selection`**
- Auth: Yes
- Body: `{ matchId, playerId, side }`
- Response: `{ success: true }`

#### Availability

**`POST /api/set-availability`**
- Auth: Yes (coach/admin)
- Body: `{ playerId, matchId, status ("Maybe"|"Unavailable"), note? }`
- Response: `{ success: true, exceptionId? }`

**`POST /api/set-my-availability`**
- Auth: No (player-facing)
- Body: `{ fixtureId, status, note?, exceptionId? }`
- Response: `{ success: true, exceptionId? }`
- If `exceptionId` + status "Available" → deletes exception

#### Ranking

**`GET /api/ranking`**
- Auth: Yes
- Response: `RankingList { players[], activeCount, lastUpdated, config, version }`
- Cache: 30s

**`GET /api/ranking/inactive`**
- Auth: Yes
- Response: `InactiveRankingEntry[]`
- Cache: 30s

**`GET /api/ranking/config`**
- Auth: Yes
- Response: `AbilityGroupConfigMap { A, B, C, D, E, F, G }`
- Cache: 5 min

**`POST /api/ranking/config`**
- Auth: Yes (Section Captain only)
- Body: `{ config: AbilityGroupConfigMap, actingEmail }`
- Response: `RankingList` (fully recomputed)
- Validation: 403 if not Section Captain, 400 if config invalid

**`POST /api/ranking/reorder`**
- Auth: Yes
- Body: `{ playerIds: string[], actingEmail }`
- Response: `RankingList`
- Validation: Length must match active count (409 if stale), no duplicates/unknowns (400)

**`POST /api/ranking/move`**
- Auth: Yes
- Body: `{ playerId, newRank, actingEmail }`
- Response: `RankingList`

**`POST /api/ranking/move-relative`**
- Auth: Yes
- Body: `{ sourceId, targetId, position: "above"|"below", actingEmail }`
- Response: `RankingList`

**`POST /api/ranking/activate`**
- Auth: Yes
- Body: `{ playerId, actingEmail }`
- Response: `RankingList`
- Appends player at bottom of ranking

**`POST /api/ranking/deactivate`**
- Auth: Yes
- Body: `{ playerId, actingEmail }`
- Response: `RankingList`
- Removes from ranking, shifts lower ranks up

**`POST /api/ranking/initialize`**
- Auth: Yes
- Response: `RankingList`
- Seeds ranking from ability + alphabetical

#### Dashboard

**`GET /api/playup-watch`**
- Auth: Yes
- Response: `{ season, watch: [{ id, name, registeredTeam, playUpCount }] }`
- Cache: 5 min

**`GET /api/recent-changes`**
- Auth: Yes
- Response: `{ changes[] }` (currently stub - returns `[]`)

**`GET /api/recent-availability`**
- Auth: Yes
- Response: `{ changes[] }` (currently stub - returns `[]`)

#### Calendar

**`GET /api/calendar/link`**
- Auth: Yes (`?email=`)
- Response: `{ icsUrl: string }`

**`GET /api/calendar/feed.ics`**
- Auth: No (signed URL: `?id=` + `?sig=`)
- Response: ICS file content

**`GET /api/calendar/team-link`**
- Auth: Yes (`?email=` + `?team=`)
- Response: `{ icsUrl: string }`

**`GET /api/calendar/team-feed.ics`**
- Auth: No (signed URL: `?team=` + `?sig=`)
- Response: ICS file content

**`GET /api/calendar/team.ics`**
- Auth: Yes (`?email=` + `?team=`)
- Response: ICS file content (direct download)

#### Health & Metrics

**`GET /health`**
- Auth: No
- Response: `{ status: "ok", timestamp }`

**`GET /api/eligibility-metrics`**
- Auth: Yes
- Response: Aggregated eligibility counts (no player data)

**`POST /api/eligibility-metrics/reset`**
- Auth: Yes
- Response: `{ success: true }`

### 10.3 Error Response Format

All errors follow a consistent format:
```json
{
  "error": "Human-readable error message"
}
```

HTTP status codes:
- 400: Bad request (missing/invalid parameters)
- 403: Forbidden (role check failed)
- 404: Not found
- 409: Conflict (stale data)
- 422: Unprocessable (cannot determine HKFC team)
- 500: Internal server error
- 502: Airtable error

### 10.4 CORS

All responses include CORS headers from `ALLOWED_ORIGIN` environment variable. OPTIONS preflight requests are handled automatically.

---

## 11. Frontend Architecture


### 11.1 Technology Choices

| Choice | Rationale |
|---|---|
| React 19 | Component model, ecosystem, hooks |
| Vite 7 | Fast dev server, native ESM |
| TanStack Query v5 | Declarative data fetching, caching, polling |
| TanStack Virtual v3 | Virtualized scrolling for 200+ player lists |
| dnd-kit v6 | Accessible drag-and-drop with PointerSensor |
| Tailwind CSS v4 | Utility-first, CSS variables, responsive |

### 11.2 State Management

TanStack Query for server state. React `useState` for UI state. Key hooks: `useMyProfile`, `useUpcomingFixtures`, `usePlayersForMatch`, `useAvailabilityPoll` (30s), `useRanking`, `useReorderRanking`, `useActivatePlayer`/`useDeactivatePlayer`, `useUpdateAbilityConfig`.

### 11.3 Optimistic Updates

Selection toggles: click â†' immediate delta â†' save bar â†' POST â†' success clears deltas â†' failure restores truth.

### 11.4 Routing

`/` â†' PlayerDashboard; `/coach` â†' CoachDashboard; `/coach/fixtures` â†' FixtureList; `/coach/match/:matchId` â†' SquadSelection; `/coach/ranking` â†' PlayerRanking. Coach routes lazy-loaded via `React.lazy()`.

### 11.5 Filters

URL search param persistence. AND across categories, OR within. Ability filters use parent-group toggle + sub-grade expansion.

### 11.6 Virtualization

`@tanstack/react-virtual` with `overscan: 10`. ~15 DOM rows for any list size.

### 11.7 Error Handling

Network: TanStack Query `isError` â†' Retry. Mutations: `toast.error()`. Unsaved changes: `beforeunload` + `useBlocker` + ConfirmDialog. Auth: AuthGate â†' Login.

### 11.8 Loading States

Skeleton cards for every data-dependent view. Animated ball-hop loader for auth gate.

---

## 12. Worker Architecture

### 12.1 Entry Point

`worker/src/index.ts` â€" single `fetch` handler. Pathname + method matching. No framework.

### 12.2 Module Map

| Module | Responsibility |
|---|---|
| `airtable.ts` | API client: findAll, findById, update, batchCreate, batchUpdate, linkId |
| `http.ts` | JSON responses, CORS, error formatting, param validation |
| `reference.ts` | Cached club reference (players + teams + rankMap) |
| `eligibility.ts` | `evaluatePlayerEligibility()` â€" 8-step pipeline |
| `ranking.ts` | Active/inactive lists, CRUD, config, derived fields, audit |
| `squad.ts` | Player-for-match, sync, select, remove, availability poll, season context |
| `fixtures.ts` | Fixture queries for coaches and players |
| `availability.ts` | Exception management |
| `recommendations.ts` | `buildRecommendations()` scoring |
| `calendar.ts` | ICS feed generation with HMAC-signed URLs |
| `profile.ts` | `getMyProfile()` |
| `dashboard.ts` | Play-up watch |
| `abilityGroup.ts` | `computeAbilityAssignment()`, `validateConfig()` |
| `abilityRank.ts` | `ABILITY_RANK` constant |

### 12.3 Error Architecture

`HttpError(status)` and `AirtableError(status)` classes. Router catches both â†' JSON error responses. Unhandled â†' 500.

### 12.4 Concurrency

Ranking batch updates: 4 concurrent workers Ã- 10 records per batch.

---

## 13. Infrastructure

- **Cloudflare Worker** â€" Backend API
- **Cloudflare Pages** â€" Frontend hosting
- **Supabase** â€" Auth only (no app data)
- **Airtable** â€" All app data (7 tables)
- **hkha-sync** â€" GitHub Actions fixture sync pipeline

Deployment: `npx wrangler deploy` (Worker), `npx vite build && npx wrangler pages deploy dist/` (Frontend). Rollback: `npx wrangler rollback` or Cloudflare Dashboard.

---

## 14. Security

- **Auth:** Supabase (email/password, PKCE). Worker resolves email â†' People record.
- **AuthZ:** Coach endpoints gated by CoachLayout. Section Captain endpoints: server-side `isSectionCaptain` check. Player endpoints: unauthenticated; validates active player.
- **Secrets:** Airtable PAT + calendar signing secret = Worker secrets. Supabase anon key = public.
- **Privacy:** No PII beyond name/team/position in API responses. Email never returned. Calendar feeds HMAC-signed. CORS restricted.

---

## 15. Performance

**Targets:** Worker cold start <1s (actual ~300ms), cached response <200ms, uncached <2s, bundle gzip <200KB (actual ~184KB).

**Caching:** `club-reference` (10m), `season-index:{s}` (10m), `all-matches:{s}` (10m), `match:{id}` (30s), `players-for-match` (5m), `ranking:active` (30s).

**Frontend:** Lazy loading, code splitting, virtualization, React.memo, debounced search, polling pause, optimistic updates, `requestAnimationFrame`.

---

## 16. Testing

**9 files, 159 tests:** eligibility (56), golden-eligibility (23), playerFilters (12), toggleSelection (6), readiness (9), recommendations (12), abilityGroup (18), abilityRank (7), dateUtils (16).

**Golden tests (`golden-eligibility.test.ts`):** Most critical. Asserts exact reason strings, rule IDs, evaluation order. If any golden test fails, do not deploy.

Run: `npx vitest` (watch) or `npx vitest run` (CI).

---

## 17. Observability

- `console.log` audit: `[Ranking Audit]` format. Access via `wrangler tail`.
- `GET /health` â€" `{ status: "ok", timestamp }`
- `GET /api/eligibility-metrics` â€" Aggregated counters
- Selection Events table â€" Non-blocking audit log
- Cloudflare Dashboard: CPU time, requests, errors

---

## 18. Operational Runbook

**Deploy:** Worker: `npx wrangler deploy`. Frontend: `npx vite build && npx wrangler pages deploy dist/`.

**Rollback:** Worker: `npx wrangler rollback`. Frontend: Cloudflare Pages â†' Deployments â†' Rollback.

**Schema changes:** Update generation script â†' regenerate â†' update mappers/queries â†' run tests â†' deploy Worker first â†' deploy frontend.

**Incidents:** Check Worker status/logs, Airtable API status, run golden tests, check cache invalidation.

---

## 19. Future Roadmap

**Near-term:** Push notifications, enhanced dashboard. Automated re-registration shipped (section 7.6).

**Out of scope:** AI selection automation, generic notifications, season rollover, mobile native apps.

**Extension:** New rules â†' add to eligibility engine + golden tests. New endpoints â†' add route + React Query hook. New screens â†' add route + page component.

---

## 20. AI Contributor Guide

### Core Rules

1. **Worker is authoritative** â€" eligibility, ranking, recommendations live in Worker
2. **Never change evaluation order** â€" enforced by golden tests
3. **Never reword reason strings** â€" coaches depend on exact labels
4. **Section Rank is sole persisted ranking** â€" everything else is derived
5. **Exception-based availability** â€" no "Available" records
6. **Selections on `Matches.Selected Players Home/Away`** â€" no separate table
7. **Generated code never edited manually** â€" regenerate from schema

### Common Mistakes to Avoid

| Mistake | Correct |
|---|---|
| Duplicating eligibility in React | Display Worker-returned `eligibilityStatus` + `reason` |
| Changing reason string | Add new strings only; never modify existing |
| Persisting Playing Ability | Always derive from Section Rank + config |
| Reading from cache on write | Write paths always read fresh from Airtable |
| Forgetting cache invalidation | Follow `syncSquad` pattern |
| Non-deterministic sorting | Use alphabetical tiebreaking |

### Required Regression Tests

| Changed module | Run these tests |
|---|---|
| `eligibility.ts` | `eligibility.test.ts`, `golden-eligibility.test.ts`, `recommendations.test.ts` |
| `ranking.ts` | `abilityGroup.test.ts`, `abilityRank.test.ts` |
| `recommendations.ts` | `recommendations.test.ts` |
| `abilityGroup.ts` | `abilityGroup.test.ts` |
| `dateUtils.ts` | `dateUtils.test.ts` |
| `PlayerFilters.tsx` | `playerFilters.test.ts` |

Always run `npx vitest run` before deploying.

---

## 21. Appendices

### 21.1 Glossary

| Term | Definition |
|---|---|
| Ability Group | Aâ€"H categorisation derived from Section Rank |
| Adjusted Play-Up Count | Current-season appearances where `Play Up? = true` AND `Goalkeeper = false` |
| Availability Exception | "Maybe" or "Unavailable" record; no record = Available |
| Derby | Match where both sides are HKFC teams |
| Double-Game Player | U21 player in two matches same day |
| Eligibility Status | `eligible`, `warning`, or `blocked` |
| Golden Test | Test asserting exact reason strings + rule IDs |
| HKFC Side | The HKFC team in a match |
| Match Card | Record of actual match participation |
| Play-Up | Player appearing for higher-ranked team |
| Reason Tag | Source-citable rule reference |
| Section Captain | All-team visibility + config modification |
| Section Rank | Sole persisted ranking; 1 = top |
| Sub-Group | +/neutral/âˆ' within ability group |

### 21.2 Architecture Decision Records (ADR)

ADRs document intentional architectural choices. Each ADR MUST include: Decision, Context, Alternatives Considered, Why Rejected, and Consequences. When the implementation diverges from this specification, an ADR MUST be written before the change is released.

#### ADR-001: Worker Owns All Business Logic

**Decision:** All business logic (eligibility, ranking, recommendations, selection validation) resides exclusively in the Cloudflare Worker. React is a presentation layer.

**Context:** Early prototypes placed some filtering logic in the frontend. This created inconsistencies: the coach's UI showed one eligibility status while the Worker saved something different.

**Alternatives Considered:**
- Hybrid: some logic in Worker, some in React shared libraries - rejected because it creates two code paths that can diverge
- GraphQL with server-side resolvers - rejected as over-engineering for this scale

**Consequences:** React MUST never evaluate eligibility. Every write is revalidated server-side. Golden tests assert Worker behaviour directly.

#### ADR-002: Selections Stored on Match Records

**Decision:** Player selections are stored as linked-record arrays on `Matches.Selected Players Home/Away`, not in a separate `Squad Selections` table.

**Context:** v2 roadmap specified a separate selections table. The current codebase consolidated selections onto the match record for simplicity.

**Alternatives Considered:**
- Separate `Squad Selections` table - rejected because it requires joins for every player-list query
- Junction table with timestamps - rejected as unnecessarily complex for a simple selected/not-selected model

**Consequences:** Derby matches require careful side resolution. Selection history is limited to the `Selection Events` audit log. Analysing historical selection patterns requires parsing match records.

#### ADR-003: Exception-Based Availability

**Decision:** Players are assumed available. Only "Maybe" and "Unavailable" are stored as Availability Exception records.

**Context:** Storing "Available" for every player×match combination would create ~3,500 records per season per team - ~28,000 total. Exception-based storage reduces this to ~500 records.

**Alternatives Considered:**
- Full availability matrix - rejected due to Airtable record limits and API rate constraints
- Weekly recurring availability templates - deferred as future enhancement

**Consequences:** There is no "Available" record type. Deleting an exception returns the player to Available. Historical availability is lost when exceptions are deleted.

#### ADR-004: Section Rank as Sole Persisted Ranking

**Decision:** `People.Section Rank` is the only persisted ranking field. Team Rank, Positional Rank, and Playing Ability are derived in-memory on every read.

**Context:** Persisting multiple ranking dimensions creates synchronisation problems. If Team Rank and Section Rank diverge, which is authoritative?

**Alternatives Considered:**
- Persist all three ranks - rejected due to synchronisation complexity
- Persist none, compute all on-demand - rejected because Section Rank must survive Worker restarts

**Consequences:** Every ranking mutation requires updating only `Section Rank`. Derived fields are computed in O(n) on read. Playing Ability is persisted as a cache but recomputed synchronously after config changes.

#### ADR-005: U21 Any-Higher-Team Override

**Decision:** U21 players may play for any higher-ranked team, not just the immediate next team, per HKFC operational practice.

**Context:** Bye-Law 7.6 restricts U21 players to the "immediate next higher-ranked team." HKFC has operated with a relaxed interpretation allowing any higher team.

**Alternatives Considered:**
- Implement literal bye-law text - rejected as it contradicts actual HKFC operational practice
- Make configurable per-team - rejected as over-engineering for a club-level override

**Consequences:** The eligibility engine explicitly ignores the "immediate next" restriction. This is documented as an HKFC operational override. If the HKHA enforces the literal bye-law, this ADR and the engine must be updated.

#### ADR-006: Recommendations Are Advisory Only

**Decision:** The recommendation engine scores and suggests players but MUST NOT auto-select. Coaches make the final decision.

**Context:** Auto-selection was considered as a time-saving feature but rejected because it removes coach agency and could hide eligibility edge cases.

**Alternatives Considered:**
- Auto-fill short squads with top recommendations - rejected; removes coach oversight
- Batch-accept all recommendations - accepted as a UI convenience that still requires explicit coach action

**Consequences:** Recommendations are displayed as cards with "Select" buttons. Each selection creates a pending delta that the coach must explicitly Save. The engine never creates selections automatically.

#### ADR-007: Calendar ICS Feeds (Not API Push)

**Decision:** Calendar integration uses ICS feed generation (`.ics` file download or subscription URL) rather than Google/Outlook API push.

**Context:** Direct calendar API integration requires OAuth flows, per-user token management, and API rate limits. ICS feeds are universally supported and stateless.

**Alternatives Considered:**
- Google Calendar API push - rejected due to OAuth complexity and quota management
- Third-party calendar sync service - rejected as unnecessary dependency

**Consequences:** Calendar feeds are read-only subscriptions. Two-way sync (app reflects calendar changes) is not supported. Feeds are HMAC-signed for access control.

#### ADR-008: React Query Over Redux/Zustand

**Decision:** TanStack Query manages all server state. React `useState` manages local UI state. No global state management library is used.

**Context:** The application's state is predominantly server-derived (fixtures, players, rankings). A global store would duplicate server state and require manual synchronisation.

**Alternatives Considered:**
- Redux Toolkit - rejected; adds boilerplate for server-state management that React Query handles natively
- Zustand - rejected; useful for client state but the app's client state is minimal (filters, draft IDs)

**Consequences:** Server state is cached, invalidated, and refetched declaratively. Client state (filters, UI toggles) is component-local. There is no single global state tree.

#### ADR-009: Ranking Events Table (History Metadata)

**Decision:** Introduce a dedicated `Ranking Events` Airtable table that persists ranking-change history as audit metadata.

**Context:** Coaches can re-move a player who was recently moved by someone else. The ranking page needs a bounded recent history (who moved whom, from/to which rank, with an optional justification) and a non-blocking advisory. `Section Rank` on People remains the sole persisted ranking source of truth and the ranking engine remains authoritative, so the history must not become a second ranking source. No existing table fits: Selection Events is a per-selection log without timestamp / old-new rank / justification fields, and it is not created in the live schema.

**Alternatives Considered:**
- Reuse Selection Events - rejected; wrong shape (no timestamp, old/new rank, or justification) and a different purpose
- Audit fields on People (e.g. Last Changed By/At) - rejected; keeps only the latest change per player, no history
- No persistence (derive history from Worker logs) - rejected; logs are not queryable by the application

**Why Rejected:** Each alternative either cannot represent the required event shape, loses history, or is not queryable.

**Consequences:** Events are recorded fire-and-forget after a successful ranking mutation and must never cause the mutation to fail. Actor identity comes from the authenticated session; timestamps are generated server-side. The coach UI reads a bounded, cached window (60 s) and is read-only. Until the table exists, history degrades to empty with no write failures. Ranking Events are metadata, never a ranking source - `Section Rank` and the ranking engine remain authoritative.

### 21.3 Decision Log (Summary)

| ID | Decision | Rationale |
|---|---|---|
| D-001 | Worker owns business logic | Single source of truth |
| D-002 | Selections on Matches, not separate table | Simpler data model |
| D-003 | Exception-based availability | ~90% record reduction |
| D-004 | Section Rank sole ranking | No sync issues |
| D-005 | U21 any-higher-team override | HKFC practice |
| D-006 | Playing Ability auto-computed | Deterministic |
| D-007 | React Query over Redux | Server state caching |
| D-008 | Recommendations advisory only | Coaches decide |
| D-009 | Calendar ICS feeds | Universal compatibility |
| D-010 | v4 spec single source of truth | AI-optimised |
| D-011 | Ranking Events as history metadata | Audit trail without touching Section Rank |

### 21.3 Ability Rank Reference

| A+ (24) | A (23) | A- (22) | B+ (21) | B (20) | B- (19) |
| C+ (18) | C (17) | C- (16) | D+ (15) | D (14) | D- (13) |
| E+ (12) | E (11) | E- (10) | F+ (9) | F (8) | F- (7) |
| G+ (6) | G (5) | G- (4) | H+ (3) | H (2) | H- (1) |

### 21.4 RULE_IDS

**Blocked:**
- `ADMIN_DATA_INCOMPLETE` â€" Admin data incomplete
- `SUSPENSION` â€" Suspended
- `VISITING_FIXED_TEAM` â€" Visiting player â€" fixed to registered team
- `VISITING_CUP_APPEARANCES` â€" Visiting player â€" fewer than 5 appearances
- `SAME_DAY_AVAILABLE` â€" Available for [Team] on same day
- `SAME_DAY_SELECTED` â€" Selected for [Team] on same day
- `HIGHER_TO_LOWER` â€" Higher-to-lower movement requires Committee approval
- `PREMIER_MOVEMENT` â€" Premier movement restriction
- `PLAYUP_LIMIT` â€" Play-up limit reached â€" re-registration required
- `CUP_BAN_PREMIER` â€" Cup ban â€" ever registered to Premier
- `CUP_MIN_LEAGUE_APPEARANCES` â€" Fewer than 2 league appearances
- `CROSS_CUP` â€" Already played in a Cup for [Team]
- `U21_DOUBLE_GAME_LIMIT` â€" U21 double-game limit reached

**Warnings:**
- `WARN_PLAYUP_SECOND` â€" Second play-up appearance
- `WARN_PLAYUP_THIRD` â€" Third play-up appearance
- `WARN_VISITING_EARLY` â€" Visiting player early-season requirement at risk
- `WARN_U21_APPROACHING` â€" U21 double-game limit approaching

### 21.5 Architecture Diagram

```
USER (Browser)
  â"œâ"€ PlayerDashboard (/) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"
  â"œâ"€ CoachDashboard (/coach) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
  â"œâ"€ FixtureList (/coach/fixtures) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"¤
  â"œâ"€ SquadSelection (/coach/match/:id) â"€â"€â"€â"€â"€â"€â"€â"¤
  â""â"€ PlayerRanking (/coach/ranking) â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â" ̃
                    â"' HTTPS
CLOUDFLARE WORKER
  â"œâ"€ HTTP Router (index.ts)
  â"œâ"€ Eligibility Engine (eligibility.ts)
  â"œâ"€ Ranking Engine (ranking.ts)
  â"œâ"€ Recommendation Engine (recommendations.ts)
  â"œâ"€ Selection Sync (squad.ts)
  â"œâ"€ Fixture Queries (fixtures.ts)
  â"œâ"€ Availability (availability.ts)
  â"œâ"€ Calendar (calendar.ts)
  â"œâ"€ Cache Layer
  â""â"€ Airtable Client (airtable.ts)
                    â"'
              â"Œâ"€â"€â"€â"€â"€â" ́â"€â"€â"€â"€â"€â"
              â"'  AIRTABLE  â"'
              â"'  7 tables  â"'
              â""â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â" ̃
```

### 21.6 Eligibility Engine State Machine

```
START -> Step 1 (Admin) -> blocked? -> "Admin data incomplete"
  pass -> Step 2 (Suspension) -> blocked? -> "Suspended"
  pass -> Step 3 (Visiting) -> blocked? -> visiting reasons
  pass -> Step 4 (Same-Day) -> blocked? -> same-day reasons
  pass -> Step 5 (Premier) -> blocked? -> "Premier movement restriction"
  pass -> Step 6 (Play-Up) -> blocked? -> play-up reasons
  pass -> Step 7 (Cup) -> blocked? -> cup reasons
  pass -> Step 8 (U21) -> blocked? -> "U21 double-game limit"
  pass -> Generate Warnings -> Return eligible/warning
```

### 21.7 Sequence: Coach Saves Squad Selection

```
Coach           React              Worker             Airtable
  |               |                   |                   |
  | Tap "Save"    |                   |                   |
  |-------------->|                   |                   |
  |               | POST /squad/sync  |                   |
  |               |------------------>|                   |
  |               |                   | getMatchRecord()  |
  |               |                   | (FRESH, no cache) |
  |               |                   |------------------>|
  |               |                   |<-- Match record --|
  |               |                   |                   |
  |               |                   | resolve HKFC side |
  |               |                   | derby safety check|
  |               |                   |                   |
  |               |                   | airtableUpdate()  |
  |               |                   |------------------>|
  |               |                   |<-- OK ------------|
  |               |                   |                   |
  |               |                   | log events        |
  |               |                   | invalidate caches |
  |               |                   | (6+ namespaces)   |
  |               |                   |                   |
  |               | { success: true } |                   |
  |               |<------------------|                   |
  |               |                   |                   |
  |               | invalidate queries |                   |
  | Show updated  | refetch            |                   |
  |<--------------|                   |                   |
```

### 21.8 Sequence: Section Captain Reorders Ranking

```
Coach           React              Worker             Airtable
  |               |                   |                   |
  | Drag row      |                   |                   |
  |-------------->|                   |                   |
  |               | reorderDraft()    |                   |
  | Show bar      | (local state)     |                   |
  |<--------------|                   |                   |
  |               |                   |                   |
  | Tap "Save"    |                   |                   |
  |-------------->|                   |                   |
  |               | POST /ranking/    |                   |
  |               |   reorder         |                   |
  |               |------------------>|                   |
  |               |                   | validate length   |
  |               |                   | (409 if stale)    |
  |               |                   |                   |
  |               |                   | fetchActiveRanks()|
  |               |                   |------------------>|
  |               |                   |<-- players -------|
  |               |                   |                   |
  |               |                   | compute new ranks |
  |               |                   | applySectionRank  |
  |               |                   | Updates (batched) |
  |               |                   |------------------>|
  |               |                   |<-- OK ------------|
  |               |                   |                   |
  |               |                   | audit log         |
  |               |                   | invalidate caches |
  |               |                   | recompute derived |
  |               |                   | fields (Ability)  |
  |               |                   |------------------>|
  |               |                   |<-- OK ------------|
  |               |                   |                   |
  |               | RankingList       |                   |
  |               |<------------------|                   |
  |               |                   |                   |
  | Clear drafts  | setQueryData      |                   |
  |<--------------|                   |                   |
```

### 21.9 Sequence: Player Sets Availability

```
Player          React              Worker             Airtable
  |               |                   |                   |
  | Tap fixture   |                   |                   |
  |-------------->|                   |                   |
  |               | show sheet        |                   |
  |<--------------|                   |                   |
  |               |                   |                   |
  | Select status |                   |                   |
  | (Unavailable) |                   |                   |
  |-------------->|                   |                   |
  |               | optimistic update |                   |
  |               | POST /set-my-     |                   |
  |               |   availability    |                   |
  |               |------------------>|                   |
  |               |                   | upsert exception  |
  |               |                   |------------------>|
  |               |                   |<-- OK ------------|
  |               |                   |                   |
  |               |                   | invalidate caches |
  |               |                   | (season-index,    |
  |               |                   |  players-for-match|
  |               |                   |  calendar:player) |
  |               |                   |                   |
  |               | { success: true } |                   |
  |               |<------------------|                   |
  |               |                   |                   |
  | Show updated  | toast success     |                   |
  |<--------------|                   |                   |
```

### 21.10 Sequence: Recommendation Request

```
React               Worker                    Eligibility
  |                    |                          |
  | GET /match/:id/    |                          |
  |   recommendations  |                          |
  |------------------->|                          |
  |                    | getPlayersForMatch()     |
  |                    |------------------------->|
  |                    |<-- annotated players ----|
  |                    |                          |
  |                    | filter: eligible/warning |
  |                    | exclude: blocked,        |
  |                    |   unavailable, selected  |
  |                    |                          |
  |                    | buildRecommendations()   |
  |                    | score by ability (50%)   |
  |                    | score by position (20%)  |
  |                    | score by play-up (10%)   |
  |                    | score by distance (20%)  |
  |                    | apply "Maybe" penalty    |
  |                    | sort + tiebreak          |
  |                    | generate reason tags     |
  |                    |                          |
  | { recommendations }|                          |
  |<-------------------|                          |
  |                    |                          |
  | render panel       |                          |
```

---

### 22. Ranking Events (audit trail)

Section Rank changes are persisted to a dedicated Airtable table **"Ranking Events"** (create manually; the Worker degrades gracefully until it exists):

| Field | Type | Notes |
|---|---|---|
| Player | link (People) | the player whose rank changed |
| Actor | link (People) | resolved server-side from the verified session email |
| Actor Email | text | identity per Â§4.3 (email-as-identity) |
| Kind | single select | move / reorder / activate / deactivate |
| Old Rank / New Rank | number | blank when unranked / deactivated |
| Justification | long text | optional, max 280 chars |
| Timestamp | dateTime | server-side, stamped at commit time |

Rules:

- Events are recorded **after** a successful rank commit, fire-and-forget â€” a failed audit write never fails the mutation.
- Only **materially moved** players produce events (|old - new| >= 2); adjacent +/-1 shifts are mechanical consequences. If nothing moved materially (e.g. a swap), all changed players are recorded. Capped at 10 per operation.
- `move` / `move-relative` / `reorder` accept an optional `justification` body field; validation rejects > 280 chars (400 JUSTIFICATION_TOO_LONG).
- `activate` / `deactivate` record single events (no note UI).
- `GET /api/recent-changes` reads the table (newest first, `days` window, 60s worker cache) and degrades to `[]` when the table is missing.
- The Move-to-rank sheet shows a non-blocking advisory when the player was recently moved by someone else.

### 23. Performance cache map (Worker isolate)

| Cache key | TTL | Invalidated by |
|---|---|---|
| `club-reference`, `team-coach-links` | 10 min | ranking derived-field recompute, auto-select list writes |
| `ranking:active`, `ranking:inactive` | 30 s | every ranking write |
| `ranking:config` | 5 min | config writes |
| `player-by-email:{email}` | 60 s | activate / deactivate (authorization lookups bypass with `{fresh:true}`) |
| `scheduled-matches` | 10 min | `syncSquad` (selections live in match records) |
| `availability:{matchId}` | 25 s | `setAvailability` / `setMyAvailability` |
| `exceptions:{season}` | 5 min | availability writes |
| `season-index:{season}`, `all-matches:{season}`, `match-cards:{season}` | 10 min | `syncSquad`, availability writes |
| `match:{matchId}` | 30 s | `syncSquad` (write paths always read fresh) |
| `ranking-events:{days}` | 60 s | - (short TTL only) |

Supabase token verification (`/auth/v1/user`) is deliberately **not** cached: revocation latency must stay immediate. The browser `getSession()` header path is local (no network).

### 24. Lowest-ranked-team goalkeeper schedule

`GET /api/my-fixtures` detects an ACTIVE goalkeeper whose `People.Playing Position = "Goalkeeper"` and whose registered team is the lowest-ranked ACTIVE team (highest `Teams.Team Rank` â€” never hardcoded). The response gains `specialGoalkeeperView: true` and the fixtures list becomes **all upcoming HKFC matches** (one card per match; derbies are a single card; sorted by date), with per-match exception-based availability and selection status. No per-fixture Airtable requests â€” exceptions are bulk-fetched by season. `People.Playing Position` is the source of truth; `Match Cards.Goalkeeper` remains historical and is never used for cohort detection. The player dashboard renders the list grouped by date.

### 25. Production telemetry and parallel auth (correction pass, 2026-08-14)

- **Request instrumentation.** The Worker emits one structured JSON line per request (`{"type":"perf.request", method, path, status, totalMs, airtableCalls}`) and one per authorization (`{"type":"perf.auth", supabaseMs, playerMs, coachLinksMs, coachLinksFromCache, personId, role}`), visible via Workers Logs / `wrangler tail`. `airtableCalls` is an exact per-request count (counter incremented in the Airtable client); phase timings are wall-clock and may include a few ms of interleaved concurrent requests in the same isolate. The browser logs per-request timings (method, path, status, duration) at `console.debug` in `src/lib/apiClient.ts` — React Query requests all funnel through it.
- **Parallel auth lookups.** After Supabase token verification, `getPlayerByEmail` (fresh) and `getTeamCoachLinks` (10-min cached) run in `Promise.all`. No behavioural or security impact: both are pure reads keyed off the verified session, failures reject identically, and the denial path merely warms the team-links cache. Saves one Airtable round-trip of latency on every authenticated request (~250 ms in the probe; the slower of the two lookups now bounds the phase instead of their sum).
- **No auth/JWT caching.** Supabase `/auth/v1/user` verification remains one deliberate round-trip per authenticated request. Caching it would trade immediate token-revocation latency for speed; measurement (below) shows the per-request cost is ~150 ms (probe) and it is not the dominant cost — Airtable reference reads are. Security assessment: do not cache.
- **Ranking advisory matched by stable player id.** `getReversalAdvisory` matches `RankingChange.playerId` (Airtable record id) instead of the display name; names are not unique. The Worker now includes `playerId` on every `RankingChange`. Regression test covers two players sharing the same name.
- **Timestamps.** The server-side event timestamp remains the single clock. The UI shows relative age plus the absolute UTC date; the absolute date is now visible (not hover-only) on `sm+` screens in the recent-changes list and in the advisory.

### 26. Teams schema verification for the goalkeeper cohort (correction pass, 2026-08-14)

`docs/Airtable Schema.json` was refreshed on 2026-08-14 and now contains 19 tables, including `Teams` (with `Team Rank` and `Active`), `Ability Group Configuration`, and the `Ranking Events` table. `Teams.Team Rank` (number) and `Teams.Active` (checkbox) are confirmed directly in the export — the fields the cohort derivation depends on — and the export's `Ranking Events` fields (Player, Actor, Actor Email, Kind with move/reorder/activate/deactivate options, Old Rank, New Rank, Justification, Timestamp) match the Worker's constants exactly. Live row data (which team holds which rank, where non-A goalkeepers are registered) is still not present anywhere in the repo, so the cohort cannot be confirmed from the repository; the rule therefore stays: an ACTIVE goalkeeper whose `People.Playing Position = "Goalkeeper"` and whose registered team is the lowest-ranked ACTIVE team (highest `Teams.Team Rank`; `getReferenceData` already fetches Teams with `{Active}=TRUE()`) is served the special all-fixtures view. Caveat: `mapTeam` defaults a missing/blank `Team Rank` to 99, so an active team without a rank would be treated as the lowest-ranked team — verify no active Teams record has a blank `Team Rank` before relying on the cohort.

---

**End of Engineering Specification v4.**

*This document is the **normative engineering specification** for the HKFC Squad Selection application. The implementation MUST conform to this specification. If the implementation intentionally diverges, the divergence MUST be documented through an Architecture Decision Record (ADR) and this specification MUST be updated before the change is released. This document supersedes all previous roadmaps (v1, v2, v3) and the HKFC Eligibility & Selection Rules Specification v1.0.*
