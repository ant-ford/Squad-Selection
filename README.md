# HKFC Squad Selection

**Mobile-first web application for managing player eligibility, availability, squad selection, and rankings across eight interconnected hockey teams.**

[![Tests](https://img.shields.io/badge/tests-434%20passed-brightgreen)](tests/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/ant-ford/Squad-Selection)

---

## Quick Start

**New to this project? Read in this order:**

| Step | Document | Time |
|---|---|---|
| 1 | This README | 10 min |
| 2 | [`docs/Implementation_Roadmap_v4.md`](docs/Implementation_Roadmap_v4.md) â€” Engineering Specification | 60â€“90 min |
| 3 | `worker/src/eligibility.ts` â€” eligibility engine source | 15 min |
| 4 | `tests/golden-eligibility.test.ts` â€” the critical test suite | 10 min |

Then get running:

```bash
git clone https://github.com/ant-ford/Squad-Selection.git
cd Squad-Selection
npm install
npx vitest run    # 434 tests, all should pass
npx vite dev      # opens at http://localhost:5173
```

---

## Project Overview

HKFC Squad Selection enables coaches and administrators of the Hong Kong Football Club Men's Hockey Section to:

- **Assemble legal squads** for any fixture, with automatic eligibility enforcement
- **Manage player availability** through an exception-based model (players are assumed available unless they indicate otherwise)
- **Maintain a Section Ranking** that drives all secondary rankings and ability group assignments
- **Receive recommendations** when squads are short, weighted by ability, position, play-up capacity, and team distance
- **Coordinate across eight teams** with visibility into cross-team selections, same-day conflicts, and play-up compliance
- **Sync to calendars** via ICS feed generation

The application enforces HKHA competition bye-laws and HKFC-specific operational interpretations. Coaches see exactly why a player is eligible, warned, or blocked â€” with source-citable rule references.

**Regression-first development:** The Eligibility Engine is protected by golden tests. Behavioural changes require specification updates and corresponding test updates. The test suite is part of the architecture, not an afterthought.

---

## Design Philosophy in One Page

This application intentionally optimises for **coach workflow** over technical purity:

| Decision | Rationale |
|---|---|
| **Default availability** | Players are assumed available unless they say otherwise. No one fills out forms for 30 fixtures. |
| **Single ranking** | Section Rank is the only persisted ordering. Team Rank, Positional Rank, and Playing Ability are derived â€” no sync problems, no inconsistency. |
| **Deterministic rules** | Same inputs always produce the same eligibility result. Coaches trust the output; golden tests enforce it. |
| **Advisory recommendations** | The engine suggests; coaches decide. Automation never overrides human judgment. |
| **Mobile-first** | Designed for a phone at the side of a pitch. Desktop is secondary. |
| **Minimal administration** | Exceptions, not records. Derived, not duplicated. One save, not three. |

---

## Why These Choices?

**Why Airtable?** Non-technical administrators (the Section Captain) manage data directly in a spreadsheet-like interface. No CMS training required.

**Why Cloudflare Workers?** Serverless, globally distributed, zero cold-start overhead. The Worker is close to Airtable's API, not close to a particular user's browser.

**Why Supabase (auth only)?** Provides email/password auth with PKCE. No application data is stored in Supabase â€” it's purely an identity provider.

**Why React Query over Redux?** The application's state is server-derived (fixtures, players, rankings). TanStack Query caches, invalidates, and refetches declaratively â€” no manual synchronisation.

**Why exception-based availability?** Storing "Available" for every playerÃ—match combination would create ~28,000 records per season. Exception-based storage reduces this to ~500.

**Why a Worker-first architecture?** Client-side eligibility evaluation could be bypassed by modifying JavaScript. Server-side revalidation on every write is non-negotiable.

---

## Engineering Maturity

**Production-ready (CURRENT IMPLEMENTATION):**

- âœ” Production architecture (React + Worker + Airtable)
- âœ” Regression-tested eligibility (434 tests, 24 golden)
- âœ” Generated Airtable types (never out of sync)
- âœ” Mobile-first responsive layout
- âœ” Cached Worker with targeted invalidation
- âœ” Audit logging (rankings, selections)
- âœ” Automatic re-registration service (4th qualifying play-up)

**Active development focus:**

- â€¢ Observability: cache hit ratios, endpoint latency percentiles
- â€¢ Feature flags for dark launches
- â€¢ Structured logging with correlation IDs

---

## How Features Flow

Runtime view complementing the static architecture:

```
Coach taps "Save Squad"
        â”‚
        â–¼
    React (POST /squad/sync)
        â”‚
        â–¼
    Cloudflare Worker
        â”‚
        â”œâ”€â–º Eligibility Engine â”€â”€â–º revalidates every player
        â”œâ”€â–º Recommendation Engine â”€â”€â–º scores shortfall candidates
        â”œâ”€â–º Selection Engine â”€â”€â–º derby safety, fresh Airtable read
        â”‚
        â–¼
    Airtable (single source of truth)
        â”‚
        â–¼
    Cache Invalidation (6+ namespaces)
        â”‚
        â–¼
    React (refetch, re-render)
```

Every write goes through this pipeline. React MUST NOT bypass any step.

---

## High-Level Architecture

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚                  BROWSER                      â”‚
â”‚  React 19 Â· Vite 7 Â· Tailwind CSS v4         â”‚
â”‚  TanStack Query Â· TanStack Virtual Â· dnd-kit â”‚
â”‚                                               â”‚
â”‚  Pages: /  Â· /coach  Â· /coach/fixtures       â”‚
â”‚         /coach/match/:id  Â· /coach/ranking   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                   â”‚ HTTPS (Worker URL)
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚           CLOUDFLARE WORKER                   â”‚
â”‚                                               â”‚
â”‚  Eligibility Engine Â· Ranking Engine          â”‚
â”‚  Recommendation Engine Â· Selection Sync       â”‚
â”‚  Fixture Queries Â· Availability Â· Calendar    â”‚
â”‚                                               â”‚
â”‚  Cache Layer (in-memory, TTL-based)           â”‚
â””â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
       â”‚                           â”‚
â”Œâ”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”           â”Œâ”€â”€â”€â”€â”€â”€â”€â–¼â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚  Supabase   â”‚           â”‚    Airtable     â”‚
â”‚  Auth only  â”‚           â”‚  9 tables       â”‚
â”‚  (no data)  â”‚           â”‚  All app data   â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜           â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

**React:** Presentation layer. Renders Worker-provided data, manages UI state (filters, drafts, modals), submits mutations. MUST NOT determine eligibility.

**Cloudflare Worker:** The authoritative backend. MUST own all business logic. The only component with Airtable access.

**Airtable:** Single source of truth â€” 9 tables (People, Teams, Matches, Match Cards, Availability Exceptions, Ability Group Configuration, Selection Events, Ranking Events, Registration Events).

**Ranking Events table (ranking history):** the Worker records rank changes (move / reorder / activate / deactivate) with the actor, old/new rank, an optional justification of at most 280 characters, and a server-side timestamp. The table exists in the live schema (confirmed by the 2026-08-14 schema export); if it is ever absent the ranking-history UI degrades to "no changes recorded yet" and no write ever fails. Field names must match exactly: `Player` (link to People), `Actor` (link to People), `Actor Email` (text), `Kind` (select: move / reorder / activate / deactivate), `Old Rank` (number), `New Rank` (number), `Justification` (long text), `Timestamp` (date/time). Rationale: no existing table can represent rank changes - Selection Events has no timestamp/rank fields and is a per-selection log; audit fields on People would keep only the latest change per player.

**Registration Events table (automatic re-registration ledger):** the Worker records one `auto_reregister` event when a player's 4th qualifying play-up of the season is processed: `Player` (link to People), `Previous Registered Team` (text), `New Registered Team` (text), `Triggering Match Card` (link to Match Cards), `Season` (text, e.g. "2026-2027"), `Event Type` (single select: `auto_reregister`), `Timestamp` (date/time, UTC). The table must be created by the Section Captain / admin (same convention as Ranking Events); until it exists the reconciliation runs in dry-run only and never writes. The event is the idempotency marker - it prevents reprocessing and protects later administrator overrides.
**Per-request telemetry:** the Worker logs one structured JSON line per request (`perf.request`: method, path, status, totalMs, exact Airtable call count) and one per authorization (`perf.auth`: Supabase verify, player lookup, team-links lookup timings, cache flags) - queryable in Workers Logs / `wrangler tail`. Supabase token verification is deliberately NOT cached (immediate revocation latency); the browser logs per-request timings via `console.debug` in `src/lib/apiClient.ts`.

**Supabase:** Authentication only. No application data stored in Supabase tables.

---

## Repository Structure

```
Squad-Selection/
â”œâ”€â”€ docs/                          # Engineering specification
â”‚   â””â”€â”€ Implementation_Roadmap_v4.md   # â˜… NORMATIVE SPEC
â”œâ”€â”€ src/                           # React frontend
â”‚   â”œâ”€â”€ pages/                     # Route-level components
â”‚   â”‚   â”œâ”€â”€ PlayerDashboard.tsx        # Player fixture/availability view
â”‚   â”‚   â”œâ”€â”€ CoachDashboard.tsx         # Coach landing + play-up watch
â”‚   â”‚   â”œâ”€â”€ FixtureList.tsx            # Browse fixtures by team
â”‚   â”‚   â”œâ”€â”€ SquadSelection.tsx         # Core squad building workflow
â”‚   â”‚   â””â”€â”€ PlayerRanking.tsx          # Section ranking management
â”‚   â”œâ”€â”€ components/                # Reusable UI components
â”‚   â”‚   â”œâ”€â”€ AppHeader.tsx              # Coach nav header
â”‚   â”‚   â”œâ”€â”€ FixtureCard.tsx            # Coach fixture card
â”‚   â”‚   â”œâ”€â”€ PlayerRow.tsx              # Selection player row
â”‚   â”‚   â”œâ”€â”€ PlayerFilters.tsx          # Multi-dimensional filter bar
â”‚   â”‚   â”œâ”€â”€ RecommendationsPanel.tsx   # Match recommendations
â”‚   â”‚   â””â”€â”€ shared/                    # Shared presentational components
â”‚   â”œâ”€â”€ api/                       # Typed API client functions
â”‚   â”œâ”€â”€ lib/                       # Shared utilities
â”‚   â”‚   â”œâ”€â”€ queries.ts                # TanStack Query hooks
â”‚   â”‚   â”œâ”€â”€ apiClient.ts              # Authenticated fetch wrapper
â”‚   â”‚   â”œâ”€â”€ auth.ts                   # Supabase session helpers
â”‚   â”‚   â”œâ”€â”€ dateUtils.ts              # safeFormat, isPastFixture
â”‚   â”‚   â””â”€â”€ readiness.ts              # Team readiness scoring
â”‚   â”œâ”€â”€ mappers/                   # Airtable â†’ domain type conversion
â”‚   â””â”€â”€ generated/                 # â˜… AUTO-GENERATED â€” DO NOT EDIT
â”œâ”€â”€ worker/                        # Cloudflare Worker backend
â”‚   â””â”€â”€ src/
â”‚       â”œâ”€â”€ index.ts                   # HTTP router (30+ endpoints)
â”‚       â”œâ”€â”€ eligibility.ts             # â˜… Eligibility engine (8 steps)
â”‚       â”œâ”€â”€ ranking.ts                 # â˜… Ranking engine
â”‚       â”œâ”€â”€ recommendations.ts         # Recommendation scoring
â”‚       â”œâ”€â”€ squad.ts                   # Selection sync + season context
â”‚       â”œâ”€â”€ fixtures.ts                # Fixture queries
â”‚       â”œâ”€â”€ availability.ts            # Exception management
â”‚       â”œâ”€â”€ calendar.ts                # ICS feed generation
â”‚       â”œâ”€â”€ abilityGroup.ts            # Ability group/sub-group math
â”‚       â”œâ”€â”€ abilityRank.ts             # A+ = 24 â†’ H- = 1 mapping
â”‚       â”œâ”€â”€ reference.ts               # Cached club reference data
â”‚       â”œâ”€â”€ airtable.ts                # Airtable API client

â”‚       â”œâ”€â”€ registration.ts              # Automatic re-registration service
â”‚       â”œâ”€â”€ playUp.ts              # Shared qualifying play-up definition
â”‚       â””â”€â”€ http.ts                    # HTTP utilities
â”œâ”€â”€ tests/                         # Vitest unit tests (434 tests)
â”‚   â”œâ”€â”€ eligibility.test.ts            # Full rule matrix (56 tests)
â”‚   â”œâ”€â”€ golden-eligibility.test.ts     # â˜… Frozen golden matrix (24 tests)
â”‚   â”œâ”€â”€ playerFilters.test.ts          # Filter serialization
â”‚   â”œâ”€â”€ toggleSelection.test.ts        # Binary toggle logic
â”‚   â”œâ”€â”€ readiness.test.ts              # Team readiness
â”‚   â”œâ”€â”€ recommendations.test.ts        # Recommendation engine
â”‚   â”œâ”€â”€ abilityGroup.test.ts           # Group/sub-group math
â”‚   â”œâ”€â”€ abilityRank.test.ts            # Rank constant ordering
â”‚   â”œâ”€â”€ authorization.test.ts          # Supabase auth, access rules, parallel lookups
â”‚   â”œâ”€â”€ authorization-routes.test.ts   # Route-level authorization
â”‚   â”œâ”€â”€ cachePerf.test.ts              # Cache hits and Airtable call counts
â”‚   â”œâ”€â”€ gkFixtures.test.ts             # H-registered GK all-fixtures view
â”‚   â”œâ”€â”€ rankingEvents.test.ts          # Ranking event persistence
â”‚   â”œâ”€â”€ rankingHistory.test.ts         # Advisory + age/date helpers
â”‚   â”œâ”€â”€ perf.test.ts                   # Telemetry JSON structure
â”‚   â””â”€â”€ dateUtils.test.ts              # Date formatting

â”‚   â””â”€â”€ registration.test.ts            # Automatic re-registration suite
â”‚   â””â”€â”€ registrationRoutes.test.ts            # Reconcile endpoint auth + gating
â””â”€â”€ public/                        # Static assets (favicon, logo)
```

---

## Major Subsystems

### Eligibility Engine (`worker/src/eligibility.ts`)

The **sole authority** on whether a player can be selected. Evaluates every active player against a fixed 8-step pipeline:

1. Admin Data Validation
2. Suspension Checks
3. Visiting Player Restrictions
4. Same-Day Team Movement
5. Premier Division Restrictions
6. Play-Up Rules
7. Cup Eligibility
8. U21 Double-Game Limits â†’ Generate Warnings

Each blocked result includes an exact reason string (e.g., `"Suspended"`) and a source-citable rule tag. **MUST NOT reword these strings** â€” coaches and golden tests depend on them.

Same-day availability is reported as **one** warning naming every higher team, ordered by team rank: `"Available for HKFC A, HKFC B, HKFC C on same day"`. A player registered to a low team can be available for most of the club on a busy Saturday, and one warning per team buried the rest of their row on the selection screen. With a single team the string is byte-identical to the original wording, which is what the golden matrix pins.

â†’ Full specification: [`Implementation_Roadmap_v4.md Â§7.1`](docs/Implementation_Roadmap_v4.md)

### Ranking Engine (`worker/src/ranking.ts`)

Manages the **Section Ranking** â€” the single persisted ordering. Team Rank, Positional Rank, and Playing Ability are derived in-memory. Drag-and-drop reordering, up/down step buttons, batch moves. Stale detection via 409 Conflict on version mismatch.

â†’ Full specification: [`Implementation_Roadmap_v4.md Â§7.2`](docs/Implementation_Roadmap_v4.md)

### Recommendation Engine (`worker/src/recommendations.ts`)

Read-only, advisory. Consumes eligibility output. Scores candidates by ability (50%), position fit (20%), play-up capacity (10%), and team distance (20%). Maybe players penalised by âˆ’45. Each recommendation carries up to 3 reason tags. MUST NOT auto-select.

â†’ Full specification: [`Implementation_Roadmap_v4.md Â§7.3`](docs/Implementation_Roadmap_v4.md)

### Selection Engine (`worker/src/squad.ts`)

Selections stored directly on `Matches.Selected Players Home/Away`. The `syncSquad` endpoint handles: fresh Airtable read (never cached on write path), HKFC side resolution, derby safety, Airtable update, audit logging, and cache invalidation across 6+ namespaces.

â†’ Full specification: [`Implementation_Roadmap_v4.md Â§7.5`](docs/Implementation_Roadmap_v4.md)

### Automatic Re-registration Service (`worker/src/registration.ts`)

Watches the current season's Match Cards and, when a player records their **4th qualifying play-up appearance**, automatically re-registers the player: `People.Registered Team` becomes the destination team. Match Cards are the sole trigger - selections, availability and recommendations never cause re-registration.

**Destination algorithm (single rule):** highest frequency among the four qualifying appearances wins; on a frequency tie, the lowest-ranked team (`Teams.Team Rank`, largest rank number) wins. Handles 4+0, 3+1, 2+1+1, 2+2 and 1+1+1+1 deterministically.

**Event, not formula:** the fourth-play-up threshold is processed exactly once per player per season via the `Registration Events` Airtable table, so administrator edits of `People.Registered Team` are never overwritten afterwards. Historical Match Cards (including `Player Team`) are never rewritten and the season-cumulative play-up count is never reset. Goalkeeper status is per Match Card: `Match Cards.Goalkeeper` decides each appearance (never `People.Playing Position`) - goalkeeper play-up appearances never count, while a goalkeeper-positioned player's field-player play-ups count normally. The destination must also be a genuine upward move - the service never demotes.

**Friendlies never count.** `Matches.Competition Type` is an Airtable formula over `Division` emitting `LEAGUE`, `KNOCKOUT` or `FRIENDLY` (`P FDLY` and `WARM-UP` both map to `FRIENDLY`). Friendly fixtures are excluded from qualifying play-ups, from the Visiting Player five-appearance threshold, and from the Cup two-league-appearance requirement. `isQualifyingPlayUpCard()` takes `matchesById` as a **required** argument for exactly this reason: a caller that cannot resolve the fixture must not be able to silently count a warm-up game towards automatic re-registration. A division the formula does not recognise yields a blank type and is *not* assumed to be a friendly.

A daily scheduled scan (dry-run by default) plus a coach-only `POST /api/registration/reconcile` endpoint keep the ledger up to date. See [Automatic Re-registration](#automatic-re-registration) for the data model and activation steps.
### Availability Engine (`worker/src/availability.ts`)

Exception-based: no record = Available. Only "Maybe" and "Unavailable" are stored. Self-service writes derive the player's identity from the verified Supabase session, never from a client-supplied email or player id. Polled every 30 seconds on the Squad Selection page.

**Date-level availability** (`POST /api/set-my-availability-for-date`) applies one status to every HKFC fixture on a date, so "I'm away this Saturday" is a single tap rather than one per card — including the play-up and support pools. It began as a goalkeeper-cohort shortcut and is now open to every authorized player; the player dashboard surfaces the control on any date where the player has more than one fixture in play. Individual fixtures stay independently overridable afterwards.

### Season Statistics (`worker/src/playerStats.ts`)

`GET /api/player-stats/:playerId` (self or coach) backs the panel on the player dashboard and the coach drill-in from the ranking row menu. It reads entirely off the cached season context, so it costs no extra Airtable calls.

- **Form** — last five results as coloured tiles (green win, white draw, red loss). Tapping one shows that game's score, goals and cards. A fixture without a recorded score is left out of the form rather than shown as a 0–0 draw.
- **Appearances** come from Match Cards: the card *is* the appearance record, so selections are never used to infer that someone played.
- **Card points** reuse `yellowPointsFor()` from the suspension engine, so the Bye-Law 16.3 scale (including `"Y2 (2)"` quantity suffixes) has exactly one implementation. Red cards are shown but carry no yellow points.
- **Participation** is `gamesPlayed / teamGames`, with `(gamesPlayed + gamesAvailableNotSelected) / teamGames` in brackets. `teamGames` counts only fixtures with `Match Status = Played`. "Maybe" is treated as available, not a refusal.
- **Friendlies are excluded** throughout, consistent with the eligibility counts — a warm-up game must not move a participation percentage.

Participation can exceed 100%: appearances for other teams (play-ups and support games) count towards `gamesPlayed`, while `teamGames` only counts the player's own team's fixtures. That is deliberate — it reads as "turned out more often than their own team played".

### Standing Availability Rules

Players set standing preferences from the gear icon on their dashboard, instead of answering every fixture: not available for play-ups, for support games, midweek, between two dates, or for everything from now on. They live in the `Availability Rules` Airtable table (`Player`, `Rule Type`, `Availability`, `Active`, `Start Date`, `End Date`, `Notes`).

Two rules govern how they resolve, both in [`worker/src/availabilityRules.ts`](worker/src/availabilityRules.ts):

1. **An explicit Availability Exception always wins.** A rule is only the *default* for a fixture the player never answered, so setting a rule can never silently undo a tap. `Availability Exceptions` keeps meaning exactly what it meant before.
2. **The more specific rule wins** where several apply: `Date range` → `Midweek` → `Play-ups`/`Support games` → `All future`, with ties broken by `Last Modified`. "Out from March, but around midweek" resolves the way a person would read it.

Rules feed both the player's own dashboard and the coach's selection screen, and the payload carries `availabilityFromRule` so a coach can tell a standing preference from an actual answer — "hasn't been asked" reads very differently from "said no". Midweek means Monday–Friday. A missing table is not an error: every fixture just falls back to its normal default.

### Season Statistics

`GET /api/player-stats/:id` (that player, or any coach) returns the season's form guide and totals. Always presented as a **drill-down**, never inline: stats are reference material, and on a phone an inline panel pushed the fixture list — the thing players actually action — below the fold. `SeasonStatsSheet` is the single entry point, opened from the player dashboard header, from a squad-selection player row, and from the ranking row menu, so the three views cannot drift apart.

Participation is `games played / team games`, with `(played + available-but-not-selected) / team games` in brackets — the second number separates "wasn't picked" from "wasn't around". Card points come from `Match Cards.Cards`; friendlies are excluded from every total, consistent with the eligibility engine.

### Notifying the Squad (WhatsApp click-to-chat)

Coaches open **Notify** on the squad-selection screen to tell the selected squad they are playing. No WhatsApp Business account, API or approval is involved — a `wa.me` link opens WhatsApp on the coach's own device with the message pre-filled and **the coach presses send**. The app never sends anything.

`wa.me` addresses exactly one recipient, so there is no link that messages a whole squad. The sheet therefore offers both routes: one tap per player, and a copyable announcement to paste into the team's existing group chat.

Numbers come from `People.Mobile No.` on the coach-only match payload (the player-facing squad list never includes them). `toWhatsAppNumber()` in [`src/lib/whatsapp.ts`](src/lib/whatsapp.ts) normalises them and **returns null rather than guessing** — bare 8-digit numbers are assumed Hong Kong, `+`/`00` prefixes are treated as international, and anything else is refused. That strictness is deliberate: `wa.me` opens happily with an unusable recipient, so a bad number would look to the coach exactly like a message that sent. Players whose number cannot be normalised are listed as unreachable with a pointer to fix the Airtable field.

### Kit Colour

`Matches.Home Kit` and `Matches.Away Kit` are single-selects (`Blue` / `White`, blank = undecided). **Two fields, not one**, so a derby (HKFC B v HKFC C) gives each side its own colour. Coaches set it from the squad-selection header via `POST /api/match/:id/kit` (coach-only); the screen writes whichever side it is currently selecting, resolved with the same `resolveHkfcSide` helper the selection write uses, so a derby can never read one side's kit while writing the other's.

Players see it as a coloured dot on their fixture card, and the calendar feeds carry it as a 🔵/⚪ in the event title plus a `Kit:` line in the description. The iCalendar `COLOR` property (RFC 7986) is deliberately **not** used: few clients honour it, and a white event on a white calendar grid is invisible in the ones that do.

**Endpoint access levels.** Every `/api` route requires a verified session. Reads that back the coach screens (squad selection, availability polling, recommendations, the ability ranking and eligibility metrics) additionally require coach rights; `GET /api/player-fixtures/:id` is restricted to the player themselves or a coach. Only three routes are deliberately public: `/health`, and the two HMAC-signed `.ics` calendar feeds, which calendar clients subscribe to without being able to send an `Authorization` header. `tests/authorization-routes.test.ts` locks this down.

â†’ Full specification: [`Implementation_Roadmap_v4.md Â§7.4`](docs/Implementation_Roadmap_v4.md)

---

## Business Rule Ownership

| Responsibility | Owner | MUST NOT Implement In |
|---|---|---|
| **Eligibility** | Worker (`eligibility.ts`) | React |
| **Play-up counts** | Worker (from `Match Cards`) | React |
| **Ranking** | Worker (`ranking.ts`) + Airtable | React |
| **Ability group** | Worker (`abilityGroup.ts`) | React |
| **Recommendations** | Worker (`recommendations.ts`) | React |
| **Selection sync** | Worker (`squad.ts`) | React |
| **Automatic re-registration** | Worker (`registration.ts`) | React |
| **Caching** | Worker | React |
| **Auth** | Supabase | Worker |
| **Filter state** | React (`useState`) | Worker |
| **Drag-and-drop** | React (local state) | Worker |
| **UI visibility** | React | Worker |
| **Optimistic updates** | React (TanStack Query) | Worker |

---

## Critical Invariants

These MUST NOT be broken. For the complete list of 60+ invariants with stable IDs (INV-001 through INV-072), see the [Engineering Specification Â§3](docs/Implementation_Roadmap_v4.md#3-architectural-invariants).

1. **Eligibility evaluation order is fixed.** Steps 1â€“8 MUST execute in sequence. Golden tests enforce this.

2. **Exact reason strings MUST be preserved.** `"Suspended"`, `"Visiting player â€” fixed to registered team"`, etc. Add only, never modify.

3. **All selection writes MUST be revalidated server-side.** Client UI cannot be trusted to enforce eligibility.

4. **Section Rank is the only persisted ranking.** Team Rank, Positional Rank, Playing Ability MUST be derived. Never persist independently.

5. **Availability is exception-based.** MUST NOT create "Available" records. No record = Available.

6. **Selections live on `Matches.Selected Players Home/Away`.** MUST NOT reintroduce a separate selections table.

7. **Worker MUST own all business rules.** React MUST NOT determine eligibility, play-up counts, or ranking logic.

8. **Generated code MUST NOT be edited manually.** Files in `src/generated/` are regenerated from the Airtable schema.

9. **Play-up count MUST use `Match Cards.Goalkeeper`, not `People.Playing Position`.** The Goalkeeper field is per-appearance â€” the only authoritative source for the GK exemption.

10. **Team hierarchy MUST come from `Teams.Team Rank`.** Do not infer rank from team name.
11. **Automatic re-registration is an event, not a formula.** The 4th qualifying play-up is processed exactly once per player per season via Registration Events; administrator overrides of `People.Registered Team` are never overwritten. Goalkeeper status is per Match Card, and the service never demotes (the destination must be an upward move).
12. **Displayed team is optics.** Team payloads show `Selected Team EOS` (then SOS, then Registered Team); all business rules keep using the true `People.Registered Team`.

---

## Technology Stack

| Layer | Technology |
|---|---|
| **Frontend framework** | React 19 |
| **Build tool** | Vite 7 |
| **CSS** | Tailwind CSS v4 |
| **State management** | TanStack Query v5 |
| **Virtualization** | TanStack Virtual v3 |
| **Drag-and-drop** | dnd-kit v6 |
| **Icons** | lucide-react |
| **Language** | TypeScript 5.x |
| **Backend runtime** | Cloudflare Workers |
| **Auth** | Supabase Auth (email/password, PKCE) |
| **Database** | Airtable (9 tables) |
| **Testing** | Vitest v4 |
| **Data sync** | hkha-sync (GitHub Actions) |

---

## Development Workflow

### Setup

```bash
git clone https://github.com/ant-ford/Squad-Selection.git
cd Squad-Selection
npm install
```

### Environment Variables

Create `.env` in the project root:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=***
VITE_API_URL=https://your-worker.your-subdomain.workers.dev
```

Configure Worker secrets:

```bash
cd worker
npx wrangler secret put AIRTABLE_TOKEN
npx wrangler secret put CALENDAR_SECRET
```

### Run Locally

```bash
npx vite dev                    # Frontend: http://localhost:5173
cd worker && npx wrangler dev   # Worker: http://localhost:8787 (separate terminal)
```

The `cloudflare()` Vite plugin is applied to **builds only** ([`vite.config.ts`](vite.config.ts) switches on `command`). In dev its ProxyController deadlocks on Windows and the dev server accepts connections but answers none — no error, no log, just a hang. Nothing is lost: the root `wrangler.jsonc` is assets-only and the API runs separately on 8787. Builds and deploys still get the plugin. If the API ever moves into this Worker, dev will need it back and this has to be revisited.

### Build & Test

```bash
npx vite build      # Output: dist/
npx vitest          # Watch mode
npx vitest run      # Single pass (CI) - 434 tests across 25 files
npx tsc --noEmit                             # Typecheck frontend
npx tsc --noEmit -p worker/tsconfig.json     # Typecheck worker
```

### Deploy

```bash
cd worker && npx wrangler deploy          # Worker first
npx vite build && npx wrangler pages deploy dist/   # Frontend second
```

**Deploy order:** Worker MUST be deployed before frontend when the API contract changes.
Deploying the Worker also registers the daily re-registration cron trigger (02:00 Asia/Hong_Kong). It performs no writes until `AUTO_REGISTRATION_ENABLED="true"` is set - see [Automatic Re-registration](#automatic-re-registration).

**Rollback:** `npx wrangler rollback` (Worker) or Cloudflare Pages UI â†’ Deployments â†’ Rollback (Frontend).

---

## Project Documentation

| Document | Purpose | Authority |
|---|---|---|
| **README.md** | This file â€” onboarding and orientation | Primary entry point |
| **[Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** | Complete engineering specification | **â˜… NORMATIVE SPEC** |
| `tests/golden-eligibility.test.ts` | Frozen eligibility test matrix | Authoritative for expected behaviour |
| `src/generated/` | Generated Airtable types and field maps | Authoritative for data schema |
| `worker/src/eligibility.ts` | Eligibility engine source | Authoritative for rule implementation |

**`Implementation_Roadmap_v4.md` is the normative engineering specification.** The implementation MUST conform to it. Any intentional deviation between the implementation and the specification MUST be documented through an Architecture Decision Record (ADR) and the specification MUST be updated before release. This document supersedes all previous roadmaps (v1, v2, v3) and the HKFC Eligibility & Selection Rules Specification v1.0.

---

## Code Generation

The `src/generated/` directory contains code generated from the Airtable schema. These files **MUST NOT be edited manually.**

```
Airtable Schema
      â”‚
      â–¼
  Generator Script
      â”‚
      â”œâ”€â”€â–º domainTypes.ts     (TypeScript interfaces)
      â”œâ”€â”€â–º tableNames.ts      (TABLES constant)
      â””â”€â”€â–º fieldMaps.ts       (*_FIELDS constants)
      â”‚
      â–¼
  Mappers / Worker Queries    (consume generated types)
      â”‚
      â–¼
  React Components             (consume via API)
```

When the Airtable schema changes:
1. Update the generation script
2. Re-run generation
3. Update affected mappers and Worker queries
4. Run the full test suite â€” golden eligibility tests will catch field name mismatches

---

## Testing

### Golden Tests

`tests/golden-eligibility.test.ts` is the most critical test file. It asserts that every blocked reason string and rule ID is produced by the eligibility engine, and that the evaluation order never changes. **If any golden test fails, the eligibility engine has regressed. Do not deploy.**

### Suite Overview

- **434 tests** across **25 files** â€” all unit tests, no browser required
- Test data uses **factory functions** (`p()`, `m()`, `mc()`, `t()`, `ctx()`) â€” no dependency on real Airtable data
- Run: `npx vitest run`

| Test file | Tests | What it covers |
|---|---|---|
| `golden-eligibility.test.ts` | 23 | Frozen reason strings, rule IDs, evaluation order |
| `eligibility.test.ts` | 56 | Full rule matrix (all 8 steps) |
| `authorization.test.ts` | 19 | Supabase verification, access rules, parallel lookups |
| `authorization-routes.test.ts` | 33 | Route-level authorization and error contracts |
| `cachePerf.test.ts` | 8 | Cache hits/misses and per-request Airtable call counts |
| `gkFixtures.test.ts` | 15 | H-registered goalkeeper all-fixtures view |
| `rankingEvents.test.ts` | 11 | Event selection, server timestamps, fire-and-forget writes |
| `rankingHistory.test.ts` | 12 | Advisory matching by stable player id, age/absolute dates |
| `perf.test.ts` | 2 | Telemetry JSON structure (perf.auth, perf.request) |
| `recommendations.test.ts` | 12 | Scoring, exclusion, penalty |
| `abilityGroup.test.ts` | 18 | Group/sub-group assignment |
| `dateUtils.test.ts` | 16 | safeFormat, isPastFixture |
| `playerFilters.test.ts` | 12 | Filter serialization |
| `toggleSelection.test.ts` | 6 | Binary toggle logic |
| `readiness.test.ts` | 9 | Team readiness scoring |
| `abilityRank.test.ts` | 7 | Rank constant ordering |
| `registration.test.ts` | 39 | Destination algorithm, qualification, triggering, Airtable mutation, idempotency, cache invalidation, eligibility integration |
| `registrationRoutes.test.ts` | 9 |
| `displayTeam.test.ts` | 6 | Selected Team display substitution (fallbacks, ranking payload, player portal) |
| `bulkAvailability.test.ts` | 7 | Goalkeeper date-level bulk availability (exception model preserved, no Available records) | Reconcile endpoint authorization, apply-mode gating, scheduled dry-run/apply |

---

## Automatic Re-registration

When a player records their **4th qualifying play-up appearance of the current season**, the Worker automatically re-registers the player to a destination team derived from those appearances. This replaces the previous manual re-registration process.

### Business Rule

- **Trigger:** the 4th qualifying play-up Match Card of the season (ordered chronologically by match date, Match Card id as tiebreak). Match Cards are the only source of truth - selections, availability and recommendations never trigger registration changes.
- **Qualifying play-up:** `Play Up? = true`, `Goalkeeper = false`, current season - one shared definition (`worker/src/playUp.ts`) used by the eligibility engine, the Play-Up Watch and this service.
- **Goalkeeper status is per Match Card:** the exemption is decided by `Match Cards.Goalkeeper`, never by `People.Playing Position` - goalkeeper play-up appearances never count toward the threshold, and a goalkeeper-positioned player''s field-player play-ups count normally.
- **Never demotes:** a qualifying play-up is an appearance for a team higher-ranked than the player''s current Registered Team. Appearances for the player''s own or a lower-ranked team are play-downs and never count. If the calculated destination would not be an upward move (or the data cannot be resolved), the case is left for review instead of changing the registration.
- **Destination:** highest frequency among the four triggering appearances; on a tie, the lowest-ranked team by `Teams.Team Rank` (largest rank number). Examples: B,B,B,B to B; B,B,B,C to B; B,B,C,D to B; B,B,C,C to C (tie); B,C,D,E to E (tie).
- **Event, not formula:** the threshold is processed exactly once per player per season. The event is persisted in the `Registration Events` Airtable table; a processed event prevents reprocessing, so an administrator's later manual change of `People.Registered Team` always stands.
- **History is never rewritten:** all Match Cards (including `Player Team` and `Team`) stay untouched and the season-cumulative play-up count is never reset. The `Play-up limit reached - re-registration required` block remains as a fail-safe while an event is unprocessed, and for any further play-ups above the new registration.

### Registration Events (Airtable)

Create one table (Section Captain / admin, same convention as Ranking Events). The Worker degrades to dry-run-only until it exists:

| Field | Type |
|---|---|
| Player | link to People |
| Previous Registered Team | single line text |
| New Registered Team | single line text |
| Triggering Match Card | link to Match Cards |
| Season | single line text (e.g. `2026-2027`) |
| Event Type | single select: `auto_reregister` |
| Timestamp | date/time (UTC) |

### Trigger and Operation

- **Daily scheduled scan** (deployed with `worker/wrangler.toml`): 02:00 Asia/Hong_Kong (`0 18 * * *` UTC). Dry-run unless `AUTO_REGISTRATION_ENABLED="true"`.
- **Manual scan:** `POST /api/registration/reconcile` (coach / Section Captain) with body `{"mode": "dry-run" | "apply"}`. Dry-run is the default; apply is rejected with 403 while the var is off.
- **Dry-run report:** player, current Registered Team, qualifying count, the four triggering appearances, frequency by team, calculated destination, reason, and fail-safe diagnostics (missing team / unknown team / missing Team Rank / missing match date / duplicate cards / ambiguous ranks). Dry-run performs no writes.
- **Safety:** fresh pre-write re-checks, People update before event create, targeted cache invalidation (`club-reference`, `season-index`, `players-for-match:*`, `player-by-email`, ranking lists, calendar feeds), structured `[Registration]` logs in Workers Logs.

### Activation Checklist

1. Create the Registration Events table in Airtable (schema above).
2. Deploy the Worker; confirm the cron trigger exists (`wrangler deploy` output / Cloudflare dashboard).
3. Run `POST /api/registration/reconcile` (dry-run) and review the report with the Section Captain.
4. Set `AUTO_REGISTRATION_ENABLED="true"` on the deployed Worker to enable apply mode.
5. Monitor Workers Logs (`[Registration]`) for the daily scans.
## Selected Team Display (optics)

The app **displays** a player''s team as `People."Selected Team EOS"`, falling back to `People."Selected Team SOS"`, then the true `People.Registered Team`. The Section Captain manages both fields directly in Airtable: SOS stays static for the season; EOS may be adjusted to change the optics mid-season.

- **Display only.** Every business rule - eligibility (play-up limits, higher-to-lower blocks, Premier restrictions), suspensions, recommendation scoring, play-up counting and automatic re-registration - keeps using the true `People.Registered Team`.
- The substitution happens server-side at the API response boundary (squad selection rows, ranking lists, play-up watch, player portal, recommendations, active players/reference data), so the true registration never reaches the browser.
- `T#` / team blocks in the ranking view are grouped by the displayed team so ordering stays consistent with the optics.
- Fixtures and selection legality are always computed against the true registration - a player displayed in a higher team still needs legitimate play-up eligibility to be selected there.
- Automatic re-registration never writes the Selected Team fields; the captain controls them.
- The player dashboard shows a **per-day, at most three fixture options** model: **My Team / Upcoming Fixture** (the fixture they are selected for, else their Selected Team EOS fixture), **Support Fixture** (their Registered Team fixture, when the Registered Team is below the selected/EOS team) and **Play-Up Opportunities** (teams immediately above the relevant team, closest first, filling the remaining places). Play-up and support candidates must pass the eligibility engine; the same-day availability rule is neutralised for this portal presentation (players plan availability here) while selection-time evaluation keeps every rule including same-day blocks.
- The special goalkeeper view keeps its bulk-fetched exception model; the new date-level bulk control is a UX shortcut that performs the existing match-level updates ("Available" deletes exceptions - no Available records are created).

## AI Contributor Guide

**âš ï¸ Read this section before making any changes.**

### Required Reading

Every AI assistant MUST read these documents **in order** before modifying code:

1. **This README** â€” Understand the project and its boundaries
2. **[Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** â€” Complete architecture, invariants, and business rules

### What MUST NOT Change

| Rule | Why |
|---|---|
| Eligibility evaluation order | Fixed by spec Â§7.1; golden tests enforce it |
| Exact reason strings | Coaches depend on consistent labels |
| `RULE_IDS` constants | Stable identifiers for golden tests |
| Section Rank as sole ranking | Everything else is derived |
| Exception-based availability | No "Available" records |
| Selections on `Matches.Selected Players` | Not a separate table |
| Worker owns business rules | Never duplicate in React |
| Generated code | Never edit `src/generated/` manually |

### Where Logic Belongs

| If you're addingâ€¦ | Put it inâ€¦ |
|---|---|
| Eligibility rules | `worker/src/eligibility.ts` |
| Ranking logic | `worker/src/ranking.ts` |
| Recommendation scoring | `worker/src/recommendations.ts` |
| New API endpoints | `worker/src/index.ts` |
| Automatic re-registration logic | `worker/src/registration.ts` (+ shared `worker/src/playUp.ts`) |
| React Query hooks | `src/lib/queries.ts` |
| UI components | `src/components/` or `src/pages/` |
| Filter controls | `src/components/PlayerFilters.tsx` |
| Drag-and-drop state | `src/pages/PlayerRanking.tsx` (local state) |

### Required Regression Tests

| Changed module | Must-run tests |
|---|---|
| `eligibility.ts` | `eligibility.test.ts` + `golden-eligibility.test.ts` + `recommendations.test.ts` |
| `ranking.ts` | `abilityGroup.test.ts` + `abilityRank.test.ts` |
| `recommendations.ts` | `recommendations.test.ts` |
| `abilityGroup.ts` | `abilityGroup.test.ts` |
| `dateUtils.ts` | `dateUtils.test.ts` |
| `registration.ts` | `registration.test.ts` + `registrationRoutes.test.ts` |
| `PlayerFilters.tsx` | `playerFilters.test.ts` |

```bash
npx vitest run   # Always run the full suite before deploying
```

### Common Mistakes to Avoid

âŒ **Do not** add eligibility logic to React â€” display Worker-returned `eligibilityStatus` and `reason`  
âŒ **Do not** change existing reason strings â€” add new ones only  
âŒ **Do not** persist Playing Ability independently â€” always derive from Section Rank  
âŒ **Do not** read from cache on write paths â€” always read fresh from Airtable  
âŒ **Do not** forget cache invalidation after writes â€” follow the pattern in `syncSquad()`  
âŒ **Do not** use non-deterministic sorting â€” use alphabetical tiebreaking  
âŒ **Do not** use `People.Playing Position` for the GK exemption â€” use `Match Cards.Goalkeeper`  
âŒ **Do not** infer team rank from team name â€” use `Teams.Team Rank`  
âŒ **Do not** use Airtable rollups for play-up counts â€” compute in the Worker  
âŒ **Do not** edit files in `src/generated/` â€” regenerate from the schema  
- **Do not** duplicate the qualifying play-up filter - import `isQualifyingPlayUpCard` from `worker/src/playUp.ts`
- **Do not** re-apply a processed re-registration event - check Registration Events first (goalkeeper status is per Match Card; the service never demotes)

---

## Contributing

### Before Making Changes

1. Read this README and the [Engineering Spec](docs/Implementation_Roadmap_v4.md)
2. Understand where your change belongs (Worker vs React)
3. Check the [architectural invariants](docs/Implementation_Roadmap_v4.md#3-architectural-invariants) â€” your change MUST NOT violate any of them

### Pull Request Checklist

- [ ] Architecture preserved â€” no invariants violated
- [ ] Business logic in the correct tier (Worker, not React)
- [ ] No duplicated eligibility or ranking logic
- [ ] Tests added for new behaviour
- [ ] Golden eligibility tests still pass
- [ ] Full test suite passes (`npx vitest run`)
- [ ] Generated files regenerated if schema changed
- [ ] Cache invalidation handled for write paths
- [ ] Reason strings unchanged (add only, never modify)
- [ ] Build succeeds (`npx vite build`)

---

## Support

### Getting Started

1. **Read this README** â€” You are here
2. **Read [Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** â€” The normative engineering specification
3. **Review `tests/golden-eligibility.test.ts`** â€” Understand the eligibility contract
4. **Explore `worker/src/eligibility.ts`** â€” The eligibility engine implementation
5. **Run `npx vitest run`** â€” Confirm everything passes

### Key Contacts

- **Section Captain:** Manages ranking configuration and has cross-team visibility
- **Coaches:** Primary users â€” squad selection and player management
- **Administrators:** Manage suspensions, visiting player flags, and data completeness
