# HKFC Squad Selection

**Mobile-first web application for managing player eligibility, availability, squad selection, and rankings across eight interconnected hockey teams.**

[![Tests](https://img.shields.io/badge/tests-159%20passed-brightgreen)](tests/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/ant-ford/Squad-Selection)

---

## Quick Start

**New to this project? Read in this order:**

| Step | Document | Time |
|---|---|---|
| 1 | This README | 10 min |
| 2 | [`docs/Implementation_Roadmap_v4.md`](docs/Implementation_Roadmap_v4.md) — Engineering Specification | 60–90 min |
| 3 | `worker/src/eligibility.ts` — eligibility engine source | 15 min |
| 4 | `tests/golden-eligibility.test.ts` — the critical test suite | 10 min |

Then get running:

```bash
git clone https://github.com/ant-ford/Squad-Selection.git
cd Squad-Selection
npm install
npx vitest run    # 159 tests, all should pass
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

The application enforces HKHA competition bye-laws and HKFC-specific operational interpretations. Coaches see exactly why a player is eligible, warned, or blocked — with source-citable rule references.

**Regression-first development:** The Eligibility Engine is protected by golden tests. Behavioural changes require specification updates and corresponding test updates. The test suite is part of the architecture, not an afterthought.

---

## Design Philosophy in One Page

This application intentionally optimises for **coach workflow** over technical purity:

| Decision | Rationale |
|---|---|
| **Default availability** | Players are assumed available unless they say otherwise. No one fills out forms for 30 fixtures. |
| **Single ranking** | Section Rank is the only persisted ordering. Team Rank, Positional Rank, and Playing Ability are derived — no sync problems, no inconsistency. |
| **Deterministic rules** | Same inputs always produce the same eligibility result. Coaches trust the output; golden tests enforce it. |
| **Advisory recommendations** | The engine suggests; coaches decide. Automation never overrides human judgment. |
| **Mobile-first** | Designed for a phone at the side of a pitch. Desktop is secondary. |
| **Minimal administration** | Exceptions, not records. Derived, not duplicated. One save, not three. |

---

## Why These Choices?

**Why Airtable?** Non-technical administrators (the Section Captain) manage data directly in a spreadsheet-like interface. No CMS training required.

**Why Cloudflare Workers?** Serverless, globally distributed, zero cold-start overhead. The Worker is close to Airtable's API, not close to a particular user's browser.

**Why Supabase (auth only)?** Provides email/password auth with PKCE. No application data is stored in Supabase — it's purely an identity provider.

**Why React Query over Redux?** The application's state is server-derived (fixtures, players, rankings). TanStack Query caches, invalidates, and refetches declaratively — no manual synchronisation.

**Why exception-based availability?** Storing "Available" for every player×match combination would create ~28,000 records per season. Exception-based storage reduces this to ~500.

**Why a Worker-first architecture?** Client-side eligibility evaluation could be bypassed by modifying JavaScript. Server-side revalidation on every write is non-negotiable.

---

## Engineering Maturity

**Production-ready (CURRENT IMPLEMENTATION):**

- ✔ Production architecture (React + Worker + Airtable)
- ✔ Regression-tested eligibility (159 tests, 23 golden)
- ✔ Generated Airtable types (never out of sync)
- ✔ Mobile-first responsive layout
- ✔ Cached Worker with targeted invalidation
- ✔ Audit logging (rankings, selections)

**Active development focus:**

- • Observability: cache hit ratios, endpoint latency percentiles
- • Feature flags for dark launches
- • Structured logging with correlation IDs
- • Automated re-registration processing

---

## How Features Flow

Runtime view complementing the static architecture:

```
Coach taps "Save Squad"
        │
        ▼
    React (POST /squad/sync)
        │
        ▼
    Cloudflare Worker
        │
        ├─► Eligibility Engine ──► revalidates every player
        ├─► Recommendation Engine ──► scores shortfall candidates
        ├─► Selection Engine ──► derby safety, fresh Airtable read
        │
        ▼
    Airtable (single source of truth)
        │
        ▼
    Cache Invalidation (6+ namespaces)
        │
        ▼
    React (refetch, re-render)
```

Every write goes through this pipeline. React MUST NOT bypass any step.

---

## High-Level Architecture

```
┌──────────────────────────────────────────────┐
│                  BROWSER                      │
│  React 19 · Vite 7 · Tailwind CSS v4         │
│  TanStack Query · TanStack Virtual · dnd-kit │
│                                               │
│  Pages: /  · /coach  · /coach/fixtures       │
│         /coach/match/:id  · /coach/ranking   │
└──────────────────┬───────────────────────────┘
                   │ HTTPS (Worker URL)
┌──────────────────▼───────────────────────────┐
│           CLOUDFLARE WORKER                   │
│                                               │
│  Eligibility Engine · Ranking Engine          │
│  Recommendation Engine · Selection Sync       │
│  Fixture Queries · Availability · Calendar    │
│                                               │
│  Cache Layer (in-memory, TTL-based)           │
└──────┬───────────────────────────┬───────────┘
       │                           │
┌──────▼──────┐           ┌───────▼────────┐
│  Supabase   │           │    Airtable     │
│  Auth only  │           │  7 tables       │
│  (no data)  │           │  All app data   │
└─────────────┘           └────────────────┘
```

**React:** Presentation layer. Renders Worker-provided data, manages UI state (filters, drafts, modals), submits mutations. MUST NOT determine eligibility.

**Cloudflare Worker:** The authoritative backend. MUST own all business logic. The only component with Airtable access.

**Airtable:** Single source of truth — 7 tables (People, Teams, Matches, Match Cards, Availability Exceptions, Ability Group Configuration, Selection Events).

**Supabase:** Authentication only. No application data stored in Supabase tables.

---

## Repository Structure

```
Squad-Selection/
├── docs/                          # Engineering specification
│   └── Implementation_Roadmap_v4.md   # ★ NORMATIVE SPEC
├── src/                           # React frontend
│   ├── pages/                     # Route-level components
│   │   ├── PlayerDashboard.tsx        # Player fixture/availability view
│   │   ├── CoachDashboard.tsx         # Coach landing + play-up watch
│   │   ├── FixtureList.tsx            # Browse fixtures by team
│   │   ├── SquadSelection.tsx         # Core squad building workflow
│   │   └── PlayerRanking.tsx          # Section ranking management
│   ├── components/                # Reusable UI components
│   │   ├── AppHeader.tsx              # Coach nav header
│   │   ├── FixtureCard.tsx            # Coach fixture card
│   │   ├── PlayerRow.tsx              # Selection player row
│   │   ├── PlayerFilters.tsx          # Multi-dimensional filter bar
│   │   ├── RecommendationsPanel.tsx   # Match recommendations
│   │   └── shared/                    # Shared presentational components
│   ├── api/                       # Typed API client functions
│   ├── lib/                       # Shared utilities
│   │   ├── queries.ts                # TanStack Query hooks
│   │   ├── apiClient.ts              # Authenticated fetch wrapper
│   │   ├── auth.ts                   # Supabase session helpers
│   │   ├── dateUtils.ts              # safeFormat, isPastFixture
│   │   └── readiness.ts              # Team readiness scoring
│   ├── mappers/                   # Airtable → domain type conversion
│   └── generated/                 # ★ AUTO-GENERATED — DO NOT EDIT
├── worker/                        # Cloudflare Worker backend
│   └── src/
│       ├── index.ts                   # HTTP router (30+ endpoints)
│       ├── eligibility.ts             # ★ Eligibility engine (8 steps)
│       ├── ranking.ts                 # ★ Ranking engine
│       ├── recommendations.ts         # Recommendation scoring
│       ├── squad.ts                   # Selection sync + season context
│       ├── fixtures.ts                # Fixture queries
│       ├── availability.ts            # Exception management
│       ├── calendar.ts                # ICS feed generation
│       ├── abilityGroup.ts            # Ability group/sub-group math
│       ├── abilityRank.ts             # A+ = 24 → H- = 1 mapping
│       ├── reference.ts               # Cached club reference data
│       ├── airtable.ts                # Airtable API client
│       └── http.ts                    # HTTP utilities
├── tests/                         # Vitest unit tests (159 tests)
│   ├── eligibility.test.ts            # Full rule matrix (56 tests)
│   ├── golden-eligibility.test.ts     # ★ Frozen golden matrix (23 tests)
│   ├── playerFilters.test.ts          # Filter serialization
│   ├── toggleSelection.test.ts        # Binary toggle logic
│   ├── readiness.test.ts              # Team readiness
│   ├── recommendations.test.ts        # Recommendation engine
│   ├── abilityGroup.test.ts           # Group/sub-group math
│   ├── abilityRank.test.ts            # Rank constant ordering
│   └── dateUtils.test.ts              # Date formatting
└── public/                        # Static assets (favicon, logo)
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
8. U21 Double-Game Limits → Generate Warnings

Each blocked result includes an exact reason string (e.g., `"Suspended"`) and a source-citable rule tag. **MUST NOT reword these strings** — coaches and golden tests depend on them.

→ Full specification: [`Implementation_Roadmap_v4.md §7.1`](docs/Implementation_Roadmap_v4.md)

### Ranking Engine (`worker/src/ranking.ts`)

Manages the **Section Ranking** — the single persisted ordering. Team Rank, Positional Rank, and Playing Ability are derived in-memory. Drag-and-drop reordering, up/down step buttons, batch moves. Stale detection via 409 Conflict on version mismatch.

→ Full specification: [`Implementation_Roadmap_v4.md §7.2`](docs/Implementation_Roadmap_v4.md)

### Recommendation Engine (`worker/src/recommendations.ts`)

Read-only, advisory. Consumes eligibility output. Scores candidates by ability (50%), position fit (20%), play-up capacity (10%), and team distance (20%). Maybe players penalised by −45. Each recommendation carries up to 3 reason tags. MUST NOT auto-select.

→ Full specification: [`Implementation_Roadmap_v4.md §7.3`](docs/Implementation_Roadmap_v4.md)

### Selection Engine (`worker/src/squad.ts`)

Selections stored directly on `Matches.Selected Players Home/Away`. The `syncSquad` endpoint handles: fresh Airtable read (never cached on write path), HKFC side resolution, derby safety, Airtable update, audit logging, and cache invalidation across 6+ namespaces.

→ Full specification: [`Implementation_Roadmap_v4.md §7.5`](docs/Implementation_Roadmap_v4.md)

### Availability Engine (`worker/src/availability.ts`)

Exception-based: no record = Available. Only "Maybe" and "Unavailable" are stored. Self-service via unauthenticated endpoints. Polled every 30 seconds on the Squad Selection page.

→ Full specification: [`Implementation_Roadmap_v4.md §7.4`](docs/Implementation_Roadmap_v4.md)

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
| **Caching** | Worker | React |
| **Auth** | Supabase | Worker |
| **Filter state** | React (`useState`) | Worker |
| **Drag-and-drop** | React (local state) | Worker |
| **UI visibility** | React | Worker |
| **Optimistic updates** | React (TanStack Query) | Worker |

---

## Critical Invariants

These MUST NOT be broken. For the complete list of 60+ invariants with stable IDs (INV-001 through INV-072), see the [Engineering Specification §3](docs/Implementation_Roadmap_v4.md#3-architectural-invariants).

1. **Eligibility evaluation order is fixed.** Steps 1–8 MUST execute in sequence. Golden tests enforce this.

2. **Exact reason strings MUST be preserved.** `"Suspended"`, `"Visiting player — fixed to registered team"`, etc. Add only, never modify.

3. **All selection writes MUST be revalidated server-side.** Client UI cannot be trusted to enforce eligibility.

4. **Section Rank is the only persisted ranking.** Team Rank, Positional Rank, Playing Ability MUST be derived. Never persist independently.

5. **Availability is exception-based.** MUST NOT create "Available" records. No record = Available.

6. **Selections live on `Matches.Selected Players Home/Away`.** MUST NOT reintroduce a separate selections table.

7. **Worker MUST own all business rules.** React MUST NOT determine eligibility, play-up counts, or ranking logic.

8. **Generated code MUST NOT be edited manually.** Files in `src/generated/` are regenerated from the Airtable schema.

9. **Play-up count MUST use `Match Cards.Goalkeeper`, not `People.Playing Position`.** The Goalkeeper field is per-appearance — the only authoritative source for the GK exemption.

10. **Team hierarchy MUST come from `Teams.Team Rank`.** Do not infer rank from team name.

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
| **Database** | Airtable (7 tables) |
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
npx wrangler secret put AIRTABLE_PAT
npx wrangler secret put CALENDAR_SIGNING_SECRET
```

### Run Locally

```bash
npx vite dev                    # Frontend: http://localhost:5173
cd worker && npx wrangler dev   # Worker: http://localhost:8787 (separate terminal)
```

### Build & Test

```bash
npx vite build      # Output: dist/
npx vitest          # Watch mode
npx vitest run      # Single pass (CI) — 159 tests across 9 files
```

### Deploy

```bash
cd worker && npx wrangler deploy          # Worker first
npx vite build && npx wrangler pages deploy dist/   # Frontend second
```

**Deploy order:** Worker MUST be deployed before frontend when the API contract changes.

**Rollback:** `npx wrangler rollback` (Worker) or Cloudflare Pages UI → Deployments → Rollback (Frontend).

---

## Project Documentation

| Document | Purpose | Authority |
|---|---|---|
| **README.md** | This file — onboarding and orientation | Primary entry point |
| **[Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** | Complete engineering specification | **★ NORMATIVE SPEC** |
| `tests/golden-eligibility.test.ts` | Frozen eligibility test matrix | Authoritative for expected behaviour |
| `src/generated/` | Generated Airtable types and field maps | Authoritative for data schema |
| `worker/src/eligibility.ts` | Eligibility engine source | Authoritative for rule implementation |

**`Implementation_Roadmap_v4.md` is the normative engineering specification.** The implementation MUST conform to it. Any intentional deviation between the implementation and the specification MUST be documented through an Architecture Decision Record (ADR) and the specification MUST be updated before release. This document supersedes all previous roadmaps (v1, v2, v3) and the HKFC Eligibility & Selection Rules Specification v1.0.

---

## Code Generation

The `src/generated/` directory contains code generated from the Airtable schema. These files **MUST NOT be edited manually.**

```
Airtable Schema
      │
      ▼
  Generator Script
      │
      ├──► domainTypes.ts     (TypeScript interfaces)
      ├──► tableNames.ts      (TABLES constant)
      └──► fieldMaps.ts       (*_FIELDS constants)
      │
      ▼
  Mappers / Worker Queries    (consume generated types)
      │
      ▼
  React Components             (consume via API)
```

When the Airtable schema changes:
1. Update the generation script
2. Re-run generation
3. Update affected mappers and Worker queries
4. Run the full test suite — golden eligibility tests will catch field name mismatches

---

## Testing

### Golden Tests

`tests/golden-eligibility.test.ts` is the most critical test file. It asserts that every blocked reason string and rule ID is produced by the eligibility engine, and that the evaluation order never changes. **If any golden test fails, the eligibility engine has regressed. Do not deploy.**

### Suite Overview

- **159 tests** across **9 files** — all unit tests, no browser required
- Test data uses **factory functions** (`p()`, `m()`, `mc()`, `t()`, `ctx()`) — no dependency on real Airtable data
- Run: `npx vitest run`

| Test file | Tests | What it covers |
|---|---|---|
| `golden-eligibility.test.ts` | 23 | Frozen reason strings, rule IDs, evaluation order |
| `eligibility.test.ts` | 56 | Full rule matrix (all 8 steps) |
| `recommendations.test.ts` | 12 | Scoring, exclusion, penalty |
| `abilityGroup.test.ts` | 18 | Group/sub-group assignment |
| `dateUtils.test.ts` | 16 | safeFormat, isPastFixture |
| `playerFilters.test.ts` | — | Filter serialization |
| `toggleSelection.test.ts` | — | Binary toggle logic |
| `readiness.test.ts` | — | Team readiness scoring |
| `abilityRank.test.ts` | 7 | Rank constant ordering |

---

## AI Contributor Guide

**⚠️ Read this section before making any changes.**

### Required Reading

Every AI assistant MUST read these documents **in order** before modifying code:

1. **This README** — Understand the project and its boundaries
2. **[Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** — Complete architecture, invariants, and business rules

### What MUST NOT Change

| Rule | Why |
|---|---|
| Eligibility evaluation order | Fixed by spec §7.1; golden tests enforce it |
| Exact reason strings | Coaches depend on consistent labels |
| `RULE_IDS` constants | Stable identifiers for golden tests |
| Section Rank as sole ranking | Everything else is derived |
| Exception-based availability | No "Available" records |
| Selections on `Matches.Selected Players` | Not a separate table |
| Worker owns business rules | Never duplicate in React |
| Generated code | Never edit `src/generated/` manually |

### Where Logic Belongs

| If you're adding… | Put it in… |
|---|---|
| Eligibility rules | `worker/src/eligibility.ts` |
| Ranking logic | `worker/src/ranking.ts` |
| Recommendation scoring | `worker/src/recommendations.ts` |
| New API endpoints | `worker/src/index.ts` |
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
| `PlayerFilters.tsx` | `playerFilters.test.ts` |

```bash
npx vitest run   # Always run the full suite before deploying
```

### Common Mistakes to Avoid

❌ **Do not** add eligibility logic to React — display Worker-returned `eligibilityStatus` and `reason`  
❌ **Do not** change existing reason strings — add new ones only  
❌ **Do not** persist Playing Ability independently — always derive from Section Rank  
❌ **Do not** read from cache on write paths — always read fresh from Airtable  
❌ **Do not** forget cache invalidation after writes — follow the pattern in `syncSquad()`  
❌ **Do not** use non-deterministic sorting — use alphabetical tiebreaking  
❌ **Do not** use `People.Playing Position` for the GK exemption — use `Match Cards.Goalkeeper`  
❌ **Do not** infer team rank from team name — use `Teams.Team Rank`  
❌ **Do not** use Airtable rollups for play-up counts — compute in the Worker  
❌ **Do not** edit files in `src/generated/` — regenerate from the schema  

---

## Contributing

### Before Making Changes

1. Read this README and the [Engineering Spec](docs/Implementation_Roadmap_v4.md)
2. Understand where your change belongs (Worker vs React)
3. Check the [architectural invariants](docs/Implementation_Roadmap_v4.md#3-architectural-invariants) — your change MUST NOT violate any of them

### Pull Request Checklist

- [ ] Architecture preserved — no invariants violated
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

1. **Read this README** — You are here
2. **Read [Implementation_Roadmap_v4.md](docs/Implementation_Roadmap_v4.md)** — The normative engineering specification
3. **Review `tests/golden-eligibility.test.ts`** — Understand the eligibility contract
4. **Explore `worker/src/eligibility.ts`** — The eligibility engine implementation
5. **Run `npx vitest run`** — Confirm everything passes

### Key Contacts

- **Section Captain:** Manages ranking configuration and has cross-team visibility
- **Coaches:** Primary users — squad selection and player management
- **Administrators:** Manage suspensions, visiting player flags, and data completeness
