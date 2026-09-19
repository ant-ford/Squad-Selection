# Architecture & Performance Assessment — 19 September 2026

**Scope:** HKFC Squad Selection (React + Cloudflare Worker + Airtable + Supabase Auth).
**Question:** Why has the app slowed down, is Airtable the bottleneck, and what architecture suits the next stage of growth?
**Method:** Static analysis of the Worker's data-access paths, the Airtable schema export (`docs/Airtable Schema.json`, 5 Sept 2026), git history, and the 6 Sept app review. Live measurements were **not** taken: this session was not permitted to read the Airtable token or call the API, so every latency and byte figure below is a reasoned estimate and is labelled as such. Section 8 gives the measurement plan to confirm them.

---

## 1. Summary

1. **The slowdown is real and has a specific mechanism.** It is driven by two things that both grow over time, and neither is "Airtable is slow because the tables are big":
   - **Over-fetching the People table.** The People table has grown into a membership CRM with **327 fields** (33 attachment fields, 23 lookups, 31 formulas, 28 link fields, 2 AI fields). The squad app uses **27** of them. Every People read in the Worker fetches all 327 because no request passes a `fields[]` projection. Every new Fillout form, sponsor signature or HKID field added for membership purposes makes the squad app slower, even though nothing about squads changed. This is the cleanest explanation for "slower over time".
   - **Cold-cache rebuilds that page through whole seasons.** A cold request rebuilds a "season context" from six to eight table scans, including **every Match Card for this season and last** (a Match Card is an appearance record, so roughly 2,000–2,500 per season, fetched 100 at a time, sequentially, under Airtable's 5 requests/second/base cap). That gives a floor of roughly 10 seconds for a fully cold request, which matches the "ten seconds or more" comment already in `worker/src/cache.ts`. This cost grows through the season and only resets at the season boundary (it then carries the previous season for suspension checks).

2. **Is Airtable the primary bottleneck?** On the cold path, yes, but as a *platform shape* problem rather than a data-volume problem: 100 records per page, no parallel pagination, 5 req/s per base shared with Fillout, Make and Airtable automations, computed fields returned on every read, and one base serving both the membership CRM and the app's transactional data. Warm-path performance (in-isolate hit) is fine. The app's access pattern turned those platform limits into user-visible latency; the 13 Sept KV cache reduced but did not remove the cold path because TTLs are 5–10 minutes and every availability tap or squad save invalidates the season-wide caches.

3. **Expected improvement.** Tier-0 fixes inside the current architecture (field projection, narrower and longer-lived season scans, webhook- or write-driven invalidation instead of TTL) should take the cold path from an estimated 8–15 s to 1–3 s and make cold requests rare. Moving the app's reads to a Postgres read model (Supabase) removes the cold/warm distinction entirely (estimated 100–400 ms per request, consistently) and decouples the app from growth of the CRM base.

4. **Suitability at scale.** The current architecture is adequate for one club, one section, eight teams, provided Tier-0 is done. It does **not** scale well along the axes that actually threaten it: field growth in People (outside the app's control), more integrations sharing 5 req/s, more sections or clubs (the `eddy.global` branding suggests productisation), and multi-record writes with no transactions (ranking reorders).

5. **Recommendation.** Do Tier-0 now regardless of any future decision (1–2 weeks, low risk, reversible). Then adopt a **hybrid**: Airtable remains the membership CRM and business-user workspace; the squad domain (Matches, Match Cards, Availability Exceptions/Rules, Selections, Ranking, Events) moves to Supabase Postgres in phases, starting with a read model behind a feature flag, with a one-way roster sync from Airtable People. Section 6 explains why over the alternatives, and Section 9 lists the questions that could change this answer.

---

## 2. Evidence

| # | Finding | Where |
|---|---|---|
| E1 | No Airtable read passes `fields[]`; every list/get returns whole records. | `worker/src/airtable.ts` (`airtableList`, `airtableFindAll`, `airtableFindById`) |
| E2 | People = 327 fields; app maps 27 (`PEOPLE_FIELDS`). 33 attachment fields (HKID, signatures, birth certificates, application forms), 23 lookups, 31 formulas incl. 14 Fillout link formulas, 2 AI text fields. | `docs/Airtable Schema.json`, `shared/schema/fieldMaps.ts` |
| E3 | People is read on: auth (`player-by-email`, formula scan, 60 s in-isolate cache), reference data (all Active people, 10 min KV), ranking active + inactive (30 s, in-isolate), `getActivePlayers` (uncached), several `airtableFindById` calls on write paths. | `worker/src/reference.ts`, `worker/src/auth.ts`, `worker/src/ranking.ts:70-100` |
| E4 | Season context = exceptions + match cards (current **and previous** season) + all matches (current and previous) + reference (Teams + People) + availability rules, then derived indexes; cached 10 min **in-isolate only** (derived Maps/Sets cannot go to KV). | `worker/src/seasonContext.ts:113-215` |
| E5 | Pagination is 100/page and strictly sequential (offset token). Rate-limit retry sleeps ≥1 s on 429, up to twice. | `worker/src/airtable.ts:18-80` |
| E6 | Every availability write invalidates the season-scoped exceptions cache and the season index; every squad save invalidates scheduled-matches, all-matches, season-index, players-for-match, calendar, and **awaits** KV list+delete before responding. | `worker/src/squad.ts:47-58`, `worker/src/reference.ts:190-212` |
| E7 | Prior perf history: cache added 2 Jul; "performance" commits 16, 20, 21 Jul, 5 Aug, 14 Aug; KV shared cache 13 Sept. The problem has been chased repeatedly at the cache layer. | `git log` |
| E8 | The 6 Sept review already flagged: uncached People read on every request incl. the 30 s poll (B9), no in-flight de-dup (B10, since fixed), fire-and-forget Airtable writes (B1), an unbounded "all Played matches ever" scan tipping the calendar path into a 500. | `docs/APP_REVIEW_2026-09-06.md`, `worker/src/fixtures.ts:58-84` |
| E9 | Ranking writes are sequential batches of 10 (`AIRTABLE_WRITE_CONCURRENCY = 1`) because 4 parallel streams hit 429. A full reorder of ~200 players is ~20 PATCH calls ≈ 4+ s, non-atomic. | `worker/src/ranking.ts:62-125` |
| E10 | Frontend is not the cause: React Query staleTimes 15 s–5 min; the 30 s availability poll is served from a 25 s Worker cache with zero Airtable calls at steady state. Squad page fires 2 queries + 1 poll; coach dashboard 2. | `src/lib/queries.ts`, `worker/src/squad.ts:362-395` |
| E11 | The base is shared with the membership CRM: Commitments (74 fields, 7 AI fields), Fillout forms writing to People, Airtable automations (e.g. `docs/airtable-automation-commitment-periods.js`), Make.com (per user). All share the base's 5 req/s. | schema, docs, memory notes |
| E12 | Data volumes are small: ~200 active players, ~176 HKFC matches/season, est. 2,000–2,500 match cards/season, <500 exceptions/season, 356 Commitments. Nowhere near Airtable record limits (50k–125k/base). | README, roadmap ADRs, memory notes |
| E13 | Hand-maintained schema mapping; a renamed Airtable field breaks silently at runtime. Airtable cannot enforce uniqueness (duplicate People emails already seen) and a Fillout write has already wiped a link list (Commitments orphans, Sept 2026). | README invariant 8, memory notes |
| E14 | PII minimisation: HKID scans, signatures and birth certificates transit the Worker on every People fetch even though unused. `mapPlayer` drops them before caching, but they are still downloaded. | E1 + E2 |

---

## 3. Likely root causes, ranked

1. **Over-fetch of People (E1, E2, E3).** Estimated 300–800 KB per 100-record page with attachments and lookups expanded, versus tens of KB for 27 fields. Hits every request on a cold isolate via auth and reference data, and every 30 s on the ranking page. Grows with CRM activity, which explains the trend.
2. **Season-wide scans on the cold path (E4, E5).** Roughly 50–65 sequential Airtable calls for a fully cold season index (two seasons of Match Cards dominate). At 5 req/s the floor is ~10–13 s before any CPU work. Grows through the season.
3. **Invalidation churn keeps caches cold (E6).** Saturday morning is exactly when players tap availability and coaches save squads; each event drops the season index for every isolate and the shared exceptions/matches caches for everyone. A 10-minute TTL is theoretical under that load. Coach saves also pay KV list/delete latency synchronously.
4. **Derived caches are per-isolate (E4).** KV shares raw rows, but the season index, ranking lists, players-for-match, team-coach-links and session verification are rebuilt per isolate. Cloudflare spreads sparse traffic across many isolates, so cold derivations are frequent.
5. **Shared rate-limit budget (E11).** A Make scenario, a Fillout submission burst or an automation run can push the Worker into 429 → 1 s sleeps. Invisible without logging.
6. **Non-atomic multi-record writes (E9).** Not a read-latency cause, but a correctness and latency cause on ranking.
7. **Unbounded scans (E8).** `getPlayedMatches` scans every Played match ever; grows every season.

**Not causes:** eligibility engine CPU (~1,600 ops per match), record counts, React Query configuration, Supabase Auth (60 s cached).

---

## 4. Is Airtable the primary bottleneck?

**Yes on the cold path, but because of the platform's API shape, not its data volume.** Specifically:

- 100 records/page with sequential offset pagination, and no projection of linked/lookup/attachment data unless you ask for it.
- 5 req/s per base, on every plan, shared by every consumer of the base.
- Formula, lookup and attachment fields returned by default on every read.
- One base serving as both a business-user CRM and the app's OLTP store, so CRM growth degrades the app.

The app's access pattern (no projection, season-wide scans, TTL invalidation) is what converts those limits into 10-second pages. The same pattern against Postgres would be a few hundred milliseconds. So: the ceiling is Airtable's; the reason the ceiling is being hit is the app's.

---

## 5. Suitability at scale and risks of continued growth

| Growth axis | Current handling | Risk |
|---|---|---|
| Fields on People (CRM growth) | Fetched in full | **High.** Directly slows the app; outside the app team's control. |
| Match Cards per season | Two seasons scanned on cold path | **Medium.** Linear growth in season; resets yearly. |
| Historical seasons | `played-matches` unbounded; calendar already returned a 500 once | **Medium.** |
| More integrations (Fillout, Make, automations) | Share 5 req/s | **Medium–High.** Silent 429 back-off. |
| More sections / clubs (Eddy) | Base per club or shared base | **High.** Rate limit and schema drift multiply; Airtable per-seat pricing per club. |
| Write integrity | No transactions, no uniqueness, hand-mapped schema | **Medium.** Already seen: duplicate emails, wiped link lists, non-atomic reorders. |
| PII | Sensitive documents transit the Worker unnecessarily | **Medium** (data-minimisation and audit exposure). |
| Record limits / storage | Far from limits | Low. |
| Vendor lock-in | Business logic already in Worker; mappers isolate schema | Low–Medium. Good position to move from. |

---

## 6. Architecture options

### Option A — Stay on Airtable, optimise the access layer
Field projection on every read; narrow the season scans (previous-season cards filtered to those with an actual card; current-season play-up and completed-match counts via Airtable rollups on People, or a longer TTL); event-driven invalidation via Airtable webhooks instead of 10-min TTL; move KV invalidation to `ctx.waitUntil`; cache the derived season index in KV as plain arrays (rebuild Maps on read); KV-cache player-by-email; bound `getPlayedMatches`.

- **Pros:** 1–2 weeks, no business-user change, fully reversible, needed anyway. Est. cold path 8–15 s → 1–3 s.
- **Cons:** Still 5 req/s shared, still 100/page, still coupled to CRM schema, still no transactions, still one base. The ceiling remains; this buys time, not headroom.

### Option A′ — Split into two Airtable bases
A dedicated squad base with a synced, projected view of People (Airtable Sync, Team plan and up) and the squad tables moved into it.
- **Pros:** Projection by design; own 5 req/s budget; business users stay in Airtable; modest effort (1–3 weeks plus the data move).
- **Cons:** Sync latency (Airtable Sync is minutes, not seconds); two bases to administer; all other Airtable limits remain; Fillout/Make repointing for squad tables.

### Option B — Airtable stays system of record; Postgres (Supabase) read model
Airtable webhooks (or a short-interval poller) push changes to the Worker, which upserts into Supabase tables mirroring the 27 People fields plus the squad tables. The Worker reads from Postgres; writes still go to Airtable through the Worker as today, followed by a targeted re-sync of the touched rows.
- **Pros:** Removes the cold path entirely (est. 100–400 ms every request); no business-user change; Supabase is already in the stack (auth); a per-endpoint feature flag makes it reversible; it sets up Option C.
- **Cons:** Eventual-consistency window (seconds) after writes unless the Worker writes through to both; sync correctness is the risk; two copies to reason about; Airtable's write limits still apply.

### Option C — Hybrid: squad domain on Supabase, membership CRM on Airtable (**recommended target**)
Squad tables (Matches, Match Cards, Availability Exceptions, Availability Rules, Selections, Ranking fields, Ranking/Selection Events, Ability Group Config, Teams) live in Postgres as system of record. People stays in Airtable as the CRM; a one-way roster sync (27 fields) keeps a `people` table in Postgres current. Coaches and players already use the app, not Airtable; admin entry for matches, cards and teams gets in-app screens or a low-code admin over Postgres.
- **Pros:** Transactions, constraints, uniqueness, RLS with the existing Supabase auth, auto REST/GraphQL API, sub-second reads and writes, independence from CRM growth, a clean multi-club path. Keeps Airtable where it is genuinely better (forms-driven CRM, business-user views, Fillout-heavy workflows).
- **Cons:** Business users lose Airtable's grid for squad tables unless a low-code admin is added; Fillout/Make scenarios that touch squad tables must be repointed; SQL/migration skills needed; 6–12 weeks total in phases.

### Option D — Full migration off Airtable
Everything, including the membership CRM, to Supabase with a low-code admin (Softr, Retool, Appsmith, NocoDB or Baserow on Postgres).
- **Pros:** One platform, one permission model, one API.
- **Cons:** Rebuilding 20 tables, 14 Fillout link formulas, automations and every business-user habit for a CRM that is **not** the performance problem. 3–6 months, high change-management risk, little performance benefit beyond Option C. Not recommended now.

### Other platforms considered briefly
- **Xano / Backendless / Bubble-style backends:** solve the same problem as Supabase with more lock-in and no existing footprint here.
- **Notion / Coda / SmartSuite:** same API-shape limits as Airtable, weaker relational model.
- **Cloudflare D1 + Durable Objects:** viable and already in the stack, but Supabase adds Auth (already used), RLS, Studio, PostgREST, and native Fillout/Make connectors, which D1 does not.

### Capability matrix

| Capability | A / A′ (Airtable) | B (read model) | C (hybrid, recommended) | D (full Supabase) |
|---|---|---|---|---|
| Linked records / relations | Native | Native (Airtable) + FKs (mirror) | FKs + constraints for squad; Airtable links for CRM; roster sync bridges | FKs everywhere |
| Views & filtering (business users) | Native grid | Native (Airtable) | Airtable for CRM; in-app or low-code admin for squad tables | Low-code admin required |
| Interfaces | Airtable Interfaces | Unchanged | Coaches/players: the app (already). Admin: in-app screens or Softr/Retool/NocoDB | Rebuild all |
| Automations | Airtable automations | Unchanged | CRM: Airtable. Squad: Postgres triggers, pg_cron, Database Webhooks, Edge Functions, or Make | Supabase/Make |
| Permissions | Base/workspace roles | Unchanged | RLS tied to existing Supabase auth for squad data; Airtable roles for CRM | RLS |
| API access | REST, 5 req/s/base | Airtable REST for writes; Postgres for reads | PostgREST/GraphQL + Worker; no per-base cap | PostgREST |
| Fillout | Native | Native | CRM forms unchanged; any squad-table forms repoint to Supabase (Fillout lists a Supabase integration; verify it covers the write shapes used) | Supabase integration |
| Make.com | Native | Native | Make has Supabase modules and generic Postgres; scenarios touching squad tables repointed | Supabase modules |
| Reporting / dashboards | Airtable Interfaces | Metabase/Looker Studio over Postgres possible | Same; season stats already computed in Worker | Same |
| Ease of admin for business users | Best | Best | Good for CRM; needs deliberate investment for squad admin | Weakest without a low-code layer |

---

## 7. Recommended target architecture

**Option C, reached via A then B.**

```
Fillout / Make / automations ──► Airtable (membership CRM: People, Commitments, officers…)
                                     │  webhook / poller, one-way, 27 fields
                                     ▼
React app ──► Cloudflare Worker ──► Supabase Postgres (squad domain: matches, cards,
              (business rules,       exceptions, rules, selections, ranking, events,
               unchanged)            people mirror) + Supabase Auth + RLS
                                     ▲
              Admin screens / low-code admin for match & card entry
```

Why this over the others:
- The repo is unusually well-positioned: all business logic is in the Worker, all Airtable shape is behind `shared/mappers/`, and 470+ tests pin behaviour against a fake Airtable. The data layer is already an implementation detail.
- Supabase is already a production dependency for auth, so there is no new vendor, and RLS can reuse the same identities.
- It fixes the actual root causes (projection, scans, shared rate limit, no transactions) rather than mitigating them.
- It leaves the membership CRM, which is Fillout-heavy and business-user-owned, exactly where it works.
- It is the only option that gives a credible multi-club path if Eddy is a product.

---

## 8. Migration strategy

### Phase 0 — Measure and stop the bleeding (1–2 weeks, do regardless)
1. Add per-request instrumentation to the Worker: Airtable call count, bytes, wall time, cache hit/miss per key, emitted as a `Server-Timing` header and a structured log line. One week of real data confirms or corrects the estimates in this document.
2. Apply the Option A fixes: `fields[]` projection on every read (start with People); filter previous-season Match Cards to carded appearances only; bound `getPlayedMatches`; move KV invalidation to `ctx.waitUntil`; KV-cache `player-by-email` (5 min) and the season index as plain arrays; register Airtable webhooks for Matches, Match Cards, Availability Exceptions and People so invalidation is event-driven and TTLs can be hours.
3. Log `Retry-After` on 429 so contention from other consumers becomes visible.

### Phase 1 — Read model in Supabase, behind a flag (3–6 weeks)
- Create Postgres tables for the 27 People fields and each squad table, with an `airtable_id` column.
- Sync: Airtable webhooks → Worker → upsert; nightly full reconcile. Backfill once.
- Shadow-read: serve from Airtable, also read Postgres, log diffs. Flip endpoints one at a time when diffs are zero for a week.
- Writes unchanged (Airtable via Worker), followed by an immediate re-sync of the touched rows so read-your-own-write holds.
- **Parallel running: yes, for reads.** It is cheap, safe and reversible per endpoint.

### Phase 2 — Move squad-domain writes (4–8 weeks)
- Order by blast radius: Availability Rules → Availability Exceptions → Selections (`Matches.Selected Players`) → Ranking fields and Events → Match Cards/Matches.
- For each table: write to Postgres as system of record; mirror back to Airtable only if a business-user workflow still needs the table there (time-boxed dual-write, weeks not months); otherwise mark the Airtable table read-only and later archive it.
- Ship the admin screens (match and card entry, team setup) **before** flipping writes for those tables, so the Section Captain never loses an editing path.
- Repoint any Fillout forms or Make scenarios that write squad tables.
- **Parallel running: short dual-write windows only.** Long-lived two-way sync is where these projects fail.

### Phase 3 — Consolidate (2–4 weeks)
- Retire the Airtable squad tables; keep the one-way People roster sync.
- Move `HKHA Sync State` and the dormant registration ledger to Postgres if they are revived.
- Add a `club_id` / tenant dimension if Eddy is to serve more clubs.

### Should interfaces and workflows be rebuilt in the app before moving the database?
- **For coaches and players: already done.** The app is their interface; Airtable Interfaces play no role for them.
- **For squad-domain admin (matches, cards, teams, ability config): yes, before Phase 2 flips those tables.** Either in-app screens (consistent with the mobile-first design) or a low-code admin over Postgres.
- **For the membership CRM: no.** It is not the problem and should stay in Airtable.

### Effort, risk, cost, timeline (single developer with AI assistance, as this repo has been built)

| Path | Effort | Risk | Recurring cost | Timeline | Perf outcome (est.) |
|---|---|---|---|---|---|
| A: optimise on Airtable | 1–2 wks | Low | Unchanged | Immediate | Cold 8–15 s → 1–3 s; warm unchanged |
| A′: split bases | 1–3 wks + data move | Low–Med | Possibly extra Airtable seats | 1 month | Similar to A, plus own rate budget |
| B: Postgres read model | 3–6 wks | Med (sync correctness) | Supabase Pro ~US$25/mo + usage | 1–2 months | 100–400 ms consistently |
| C: hybrid target | B + 6–12 wks | Med–High (write cut-over, admin UI, integration repointing) | As B; Airtable seats may fall | 3–5 months total, phased | As B, plus transactional writes |
| D: full migration | 3–6 months | High (business-user change) | Supabase + low-code admin seats | 6+ months | As C; no extra gain |

---

## 9. Key questions to answer before deciding

1. **Is Eddy a product?** If more sections or clubs are planned, Option C becomes strongly preferred and the schema should be multi-tenant from Phase 1. If HKFC men's hockey is the only tenant for the foreseeable future, Option A plus B may be sufficient for years.
2. **Measured cold vs warm split.** What fraction of requests hit a cold isolate, and what are p50/p95 on Saturday mornings? Phase 0 answers this; it decides how much of the problem Option A alone removes.
3. **Who enters Matches and Match Cards, and how?** Manually in Airtable, via Fillout, via Make, or via the dormant HKHA sync? This sets the admin-UI requirement and the Phase 2 order.
4. **Which Fillout forms and Make scenarios touch squad tables** (as opposed to CRM tables)? Each is a repointing task and a rate-limit consumer today.
5. **What is the business users' tolerance for a non-Airtable admin surface** for squad data? Would a low-code admin (Softr/Retool/NocoDB) be acceptable versus in-app screens?
6. **Freshness requirements for the roster sync.** Is a People change (new player, team move, Active toggle) acceptable in the app within a minute? Within an hour?
7. **Team skills and ownership.** Who will own Postgres migrations, RLS policies and the sync job? Is that the same person who owns the Worker today?
8. **Airtable and Cloudflare plans.** Which Airtable plan (affects Sync availability and seat cost), and is the Worker on the paid plan (subrequest and CPU limits matter for the Phase 0 scans)?
9. **PII and data residency.** Should the squad app hold any People data beyond the 27 fields, and are there constraints on where a Postgres mirror of members' names, emails and phone numbers may live?
10. **Acceptable eventual consistency for Phase 1.** Can coaches tolerate a one-to-two-second lag between saving a squad and another coach seeing it, or must Phase 1 write through to Postgres synchronously?

---

## Appendix — Tier-0 change list (Option A), in priority order

1. `worker/src/airtable.ts`: accept a `fields` array and pass `fields[]` params; `airtableFindAll` callers pass the mapped field lists from `shared/schema/fieldMaps.ts`.
2. `worker/src/seasonContext.ts`: previous-season cards filtered to `{Cards}!=""`; consider Airtable rollups on People for current-season play-up and appearance counts, or a multi-hour TTL with webhook invalidation.
3. `worker/src/cache.ts`, `squad.ts`, `availability.ts`: KV invalidation via `ctx.waitUntil`; patch the season index in place on availability writes instead of dropping it.
4. `worker/src/reference.ts`: `player-by-email` into KV (5 min); `team-coach-links` into KV.
5. `worker/src/fixtures.ts`: bound `getPlayedMatches` to a season window.
6. Airtable webhooks → an internal Worker route → targeted `invalidateShared`; raise TTLs to hours.
7. Instrumentation: `Server-Timing` with Airtable calls, bytes, ms and cache hits per request.
