# HKFC Squad Selection App — Implementation Roadmap v2

## Purpose

This v2 roadmap supersedes the original Implementation Roadmap. It incorporates:

- The completed `hkha-sync` data pipeline (Phase 0)
- Actual Airtable schemas verified via the Airtable connector
- Lessons learned from building against live HKHA data
- The Zite MVP Blueprint (reviewed and reconciled below)
- Corrections, gaps, and explicit requirements added after blueprint review

The core design principles from v1 are unchanged: coaches are the primary users, players are assumed available unless they say otherwise, records are only created when needed, and eligibility must be enforced at every stage.

---

# What Has Been Built — Phase 0 Complete

## hkha-sync Service

The `hkha-sync` GitHub Actions service is complete and confirmed working end-to-end against live HKHA data.

Three HKHA data sources are integrated:

- `MenFixture.asp` — public, no authentication. Current-season fixture list for all men's teams.
- `MCList.asp` — per-team login. Team fixture lists including historical seasons, cup fixtures, and authoritative Fixture IDs.
- `MCInfo.asp` — per-team login. Match card detail: player appearances, jersey numbers, goals, disciplinary cards.

Three Airtable tables are populated and operational:

- `Matches` — one record per fixture (scheduled and played), with a `Season` formula field already in place
- `Match Cards` — one record per player appearance per fixture, with `Play Up?` formula field already computed
- `HKHA Sync State` — scrape status tracking per fixture

The sync runs automatically on three schedules: fixture discovery every six hours, full sync daily, and an extended re-scrape every Sunday to catch late disciplinary updates.

---

# Lessons Learned from Phase 0

## Fixture Identity Is Two-Stage

MenFixture.asp provides fixture data without IDs. MCList.asp provides the authoritative Fixture ID later. The system creates records with a composite Match Key (`date|home team|away team`) and promotes them when an ID is attached. This is working reliably.

## Player Team vs Registered Team Is Already Captured

Match Cards store both `Team` (the team whose match it was) and `Player Team` (the player's registered team, as a singleSelect). The `Play Up?` formula on Match Cards is already computed from these fields. Play-up counts must be derived directly from this field in endpoint code — not from Airtable rollups.

## Jersey Number Is the Match-Level Player Key

Player name matching against HKHA data is unreliable due to spelling variations. Jersey Number is the stable deduplication key per fixture. The `Player` record link on Match Cards enables connecting appearances to People records once `Registered Name` is matched.

## The Goalkeeper Flag Is Per-Appearance

The `Goalkeeper` boolean on Match Cards reflects the player's role in that specific match, making it the correct basis for the Bye-law 7.5 GK exemption — not a static field on People.

## Season Boundary Is Already Handled

The Matches table has a `Season` formula field that computes the season from the match date, using a 1 July boundary. Play-up counts and all season-scoped calculations filter on this field.

---

# Confirmed Decisions

| Topic | Decision |
|---|---|
| Season boundary | Ends 30 June, new season starts 1 July — already reflected in Matches.Season formula |
| Player authentication | Fillout form with email verification; URL buttons on end page pass People record ID as URL parameter; player views are unauthenticated |
| Coach/admin authentication | Zite auth, email matched to People record via user sync |
| Coach notifications | In-app only; deferred past MVP; coaches refresh the squad view manually for now |
| Designated Team | Same as Registered Team on People |
| Visiting Player count | Count all HKFC appearances (not filtered by registered team) to simplify |
| Make.com usage | Not needed for MVP; all logic runs in Zite endpoints |
| Play-up counts and eligibility | Computed in `getPlayersForMatch` endpoint code; Airtable rollups cannot filter on formula fields in linked tables and cannot be used for this purpose |
| Front-end platform | Zite |
| Dashboard | Deferred past MVP |
| Notifications | One specific trigger only: selected player marks themselves Unavailable → notify coach. No generic notification framework. Deferred past MVP. |

---

# Zite MVP Blueprint — Review and Reconciliation

The Zite MVP Blueprint is architecturally sound and correctly identifies the build sequence, the 5-request-per-call pattern for `getPlayersForMatch`, and the correct split between Airtable-native computation and endpoint logic.

## What the Blueprint Gets Right

The blueprint correctly identifies that Airtable rollup fields cannot filter on formula fields in linked tables. Play-up counts (requiring `Play Up? = true AND Goalkeeper = false AND Season = current AND Division = league`) cannot be expressed as rollups and must live in endpoint code. This is an important correction to the draft v2 roadmap, which incorrectly described these as Airtable rollup fields.

The build sequence — schema and auth first, then fixture visibility, then selection and eligibility, then player availability, then admin — is the right order. Each phase depends on the previous one. The dashboard is correctly identified as non-blocking and can wait.

The unauthenticated player pattern (URL parameter from Fillout, no login) matches the confirmed decision.

The data-fetching pattern — 5 Airtable requests per `getPlayersForMatch` call — is a real constraint. Caching the Teams table in memory within the endpoint is correct since it rarely changes.

## Gaps and Explicit Requirements Added

The following are missing from the blueprint or insufficiently specified. They are first-class requirements.

### 1 — Eligibility Reasons Are Mandatory

The `getPlayersForMatch` endpoint must return a specific labelled reason for every non-eligible result. Returning `eligible: false` alone is not acceptable — coaches will not understand why a player is greyed out.

Required response shape:

```
{
  eligibilityStatus: "eligible" | "warning" | "blocked",
  reason: string | null   // required when status is not "eligible"
}
```

Required reason strings (exact wording to use in the UI):

| Status | Reason string |
|---|---|
| blocked | "Suspended" |
| blocked | "Visiting player — fixed to registered team" |
| blocked | "Visiting player — fewer than 5 cup appearances" |
| blocked | "Available for [Team Name] on same day" |
| blocked | "Selected for [Team Name] on same day" |
| blocked | "Premier movement restriction — [Team] has not played 3 matches yet" |
| blocked | "Cup ban — ever registered to Premier Division" |
| blocked | "Already played in a Cup for [Team Name] this season" |
| blocked | "Fewer than 2 league appearances — ineligible for Cup" |
| blocked | "Play-up limit reached — re-registration required" |
| blocked | "Higher-to-lower movement requires Committee approval" |
| warning | "Second play-up appearance" |
| warning | "Third play-up appearance" |
| warning | "Visiting player early-season requirement at risk" |
| warning | "U21 double-game limit approaching (3 maximum per team)" |

### 2 — Cross-Team Selection Conflict Visibility

When a player is Selected or Reserve for any other team's fixture on the same calendar day, every coach viewing that player must see this status explicitly — not just a blocked flag.

The `getPlayersForMatch` endpoint fetches Squad Selections for all matches on the same calendar day (request 4 of 5). For each player, it must surface:

- Whether the player is Selected or Reserve for another team that day
- Which team they are selected for

This information feeds two things: the `blocked` reason ("Selected for HKFC B on same day") and a visible status badge in the player row independent of eligibility. A player who is Reserve for Team B and being considered for Team A should show "Reserve: HKFC B" as a visible badge even if they are not blocked.

This is one of the most valuable features for multi-team coordination and must not be omitted.

### 3 — Goalkeeper Rules as Explicit MVP Requirements

The GK exemption (Bye-law 7.5) is sufficiently unusual that it must be listed as an explicit requirement in every endpoint and screen that touches play-up counts. Do not rely on it being inferred from the general eligibility rules.

Explicit requirements:

- A goalkeeper registered to a team in Division One or below is exempt from the 3-match play-up limit when playing up as a goalkeeper
- When computing play-up count for eligibility: exclude Match Cards where `Goalkeeper = true` AND `Play Up? = true`
- When displaying play-up count in the player row: exclude the same records so the displayed count matches the count used for the hard filter
- The `Goalkeeper` checkbox on Match Cards is the authoritative source — not `Playing Position` on People, which reflects the player's primary position not their role on a given day
- If a GK is selected as a field player for a match, standard play-up rules apply in full. There is no exemption for positional flexibility.
- HKFC's operational strategy: non-A-team goalkeepers are registered to the lowest-ranked team. This means most GKs will have a very low registered team rank. Do not let this trigger spurious "higher-to-lower movement" blocks.

### 4 — HKFC U21 Override as Explicit MVP Requirements

The HKFC U21 rules diverge from the formal Bye-law 7.6 text. The app must implement HKFC's actual operating rules, not the literal bye-law. Do not rely on an AI builder inferring this from general documentation.

Explicit requirements:

- U21 players may be selected for any higher-ranked team, not just the immediate next team. A D Team U21 can play for the B Team without having played for the C Team first.
- On same-day double games, do not enforce match timing. A U21 may be selected for a higher-ranked team whose match kicks off before their designated team's match.
- The higher-ranked team fixture does not need to be scheduled after the designated team fixture.
- Retain hard filter (Bye-law 7.6c): maximum 3 U21 players playing their second match of the day per team. Count U21 double-game players per team per calendar day against this limit.

---

# Current Airtable Schema

## People (tblsM3GD1o3ZrWyBE)

The People table is the club's membership management system. The fields below are those relevant to squad selection. The table contains many additional fields for membership administration that are out of scope for this app.

| Field | Type | Notes |
|---|---|---|
| Name | formula | Primary field — display name |
| Surname | singleLineText | |
| Given Name(s) | singleLineText | |
| Full Name | formula | Surname (caps) + Given Name(s) |
| Preferred Name | singleLineText | |
| Registered Name | singleLineText | Name as printed on HKHA cards; already populated |
| Email | email | Used for Zite auth user sync |
| Mobile No. | phoneNumber | |
| Active | checkbox | Inactive players excluded from all squad selection views |
| Player/Coach | multipleSelects | Role source: "Coach" = coach access, "Player" = player only |
| Registered Team | singleSelect | Player's HKHA-registered team name (text value, not record link) |
| Is Visiting Player | checkbox | Hard filter: Bye-laws 6.x |
| Playing Ability | singleSelect | A+, A, A−, B+, B, B−, ... H+, H, H− |
| Playing Position | singleSelect | GK / Defender / Midfielder / Forward |
| Match Cards | multipleRecordLinks | → Match Cards |
| Availability Exceptions (Player) | multipleRecordLinks | → Availability Exceptions |
| Availability Exceptions (Updated By) | multipleRecordLinks | → Availability Exceptions |
| Squad Selections (Player) | multipleRecordLinks | → Squad Selections |
| Squad Selections (Selected By) | multipleRecordLinks | → Squad Selections |
| Teams | multipleRecordLinks | → Teams |

**Fields to add (Phase 1):**

| Field | Type | Purpose |
|---|---|---|
| Is Suspended | checkbox | Hard filter; admin-entered based on official HKHA notification |
| Matches To Serve | number | Suspension matches remaining; admin-entered |
| Ever Registered To Premier | checkbox | Hard filter for cup eligibility: Bye-law 7.7 |

Important notes:
- `Registered Team` is a singleSelect with text values. It is not a record link to the Teams table. The `Teams` multipleRecordLinks field is the structural link used to associate coaches with their teams.
- `Player/Coach` multi-select is the role source. Admin is determined by a separate mechanism (either a dedicated field or a hardcoded list of record IDs in the short term).
- Missing `Registered Team`, `Playing Position`, or `Playing Ability` values on an active player will cause the eligibility engine to treat that player as ineligible. Data completeness validation should be part of Phase 1.

## Teams (tblcr6NEkaOfIdpqd)

| Field | Type | Notes |
|---|---|---|
| Team Name | singleLineText | Primary field; matches hkha-sync TEAMS list values |
| Team Rank | number | 1 = highest ranked; drives all play-up eligibility logic |
| Is Premier | checkbox | Already added |
| Team Type | singleSelect | |
| Active | checkbox | |
| Target Squad Size | number | Default squad target for this team |
| Team Captain | multipleRecordLinks | → People |
| Section Captain | multipleRecordLinks | → People |
| Coach | multipleRecordLinks | → People |

Team Rank values must have no duplicates and cover all 8 teams (HKFC A = 1 through HKFC H = 8). This must be validated as part of Phase 1. All eligibility logic depends on it.

There is no Division field on Teams. Division is captured per-fixture on the Matches table.

## Matches (tbl7lDnqEmRUPV6Ah)

| Field | Type | Notes |
|---|---|---|
| Match Key | singleLineText | Primary; upsert key: `date\|home\|away` |
| Fixture Id | singleLineText | HKHA fixture ID; attached by MCList |
| Date | dateTime | ISO-8601 |
| Season | formula | Computed from Date using 1 July boundary |
| Division | singleLineText | Used to distinguish league from cup in eligibility logic |
| Home Team | singleLineText | |
| Home Score | number | |
| Away Team | singleLineText | |
| Away Score | number | |
| Venue | singleSelect | |
| Ump 1 | singleLineText | |
| Ump 2 | singleLineText | |
| Match Status | singleSelect | Scheduled / Played / Rescheduled |
| Match Cards | multipleRecordLinks | → Match Cards |
| Availability Exceptions | multipleRecordLinks | → Availability Exceptions |
| Squad Selections | multipleRecordLinks | → Squad Selections |
| HKHA Sync State | multipleRecordLinks | → HKHA Sync State |
| Last HKHA Sync | dateTime | |

**Competition type assumption:** The `Division` field values from HKHA (e.g. "Premier League", "Division 1") distinguish league fixtures from cup fixtures (e.g. "Cup", "Plate", "Bowl"). If these values prove inconsistent in practice, a `Competition Type` singleSelect field should be added to Matches and populated manually or via the sync. This must be verified before the eligibility engine is built.

## Availability Exceptions (tbljzQy4hl3IfMJp1)

| Field | Type | Notes |
|---|---|---|
| Id | autoNumber | Primary |
| Match | multipleRecordLinks | → Matches |
| Player | multipleRecordLinks | → People |
| Availability Status | singleSelect | Maybe / Unavailable |
| Player Notes | multilineText | e.g. "Arriving late from work" |
| Updated By | multipleRecordLinks | → People (coach or admin who entered the exception) |
| Updated At | lastModifiedTime | |
| Availability Exception Key | formula | Computed composite key |
| Various lookup fields | multipleLookupValues | From Matches and People |

No record = Available. Only exceptions are stored.

## Squad Selections (tblvS39jHonUynoQK)

| Field | Type | Notes |
|---|---|---|
| Id | autoNumber | Primary |
| Match | multipleRecordLinks | → Matches |
| Player | multipleRecordLinks | → People |
| Selection Status | singleSelect | Reserve / Selected |
| Selected By | multipleRecordLinks | → People (the coach) |
| Selected At | createdTime | Set automatically on creation |
| Selection Notes | multilineText | Optional coach notes |
| Selection Key | formula | Computed composite key |
| Various lookup fields | multipleLookupValues | From Matches and People |

No record = Not Selected. Creating a record selects the player. Deleting the record removes the selection.

## Match Cards (tblAfY7xhjkcKXlGq)

| Field | Type | Notes |
|---|---|---|
| RawPlayerName | singleLineText | Primary; name exactly as printed on HKHA card |
| Match | multipleRecordLinks | → Matches |
| Player | multipleRecordLinks | → People |
| Team | singleSelect | The team whose match this was |
| Player Team | singleSelect | Player's registered team; blank if same as Team |
| Play Up? | formula | Already computed: true when Player Team is lower ranked than Team |
| Jersey Number | number | Upsert deduplication key per fixture |
| Goals Scored | number | |
| Cards | multipleSelects | Y1–Y7, R1–R7 |
| Captain | checkbox | |
| Goalkeeper | checkbox | Role in this specific match — source of truth for GK exemption |
| VP | checkbox | |
| U21 | checkbox | |
| Fixture Id | singleLineText | |

## HKHA Sync State (tblL1EfTdIXqEuUvW)

| Field | Type | Notes |
|---|---|---|
| Fixture Id | singleLineText | Primary; upsert key |
| Match | multipleRecordLinks | → Matches |
| Source Team | singleSelect | Which HKHA login found this fixture |
| Last Scraped | dateTime | |
| Match Card Imported | checkbox | |
| Sync Status | singleSelect | Complete / Error |
| Error Message | multilineText | |
| Refresh Count | number | |
| Hash | singleLineText | |

---

# Eligibility Rules — Implementation Reference

Full rules are documented in `HKHA Competition Bye-Laws Summary.md`. This section provides the implementation-focused summary including HKFC-specific overrides.

## Hard Filters — Block Selection Completely

These must be applied inside the `getPlayersForMatch` endpoint before any player is shown as selectable. Blocked players appear in the list with a specific reason label; the selection control is disabled.

1. **Suspension** — `Is Suspended = true` OR `Matches To Serve > 0`. Reason: "Suspended".
2. **Visiting Player — Fixed Team** (Bye-law 6.4) — Cannot move between teams. Reason: "Visiting player — fixed to registered team".
3. **Visiting Player — Cup Eligibility** (Bye-law 6.5) — Blocked from cups until total HKFC appearances ≥ 5 (count all appearances, no registered-team filter). Reason: "Visiting player — fewer than 5 cup appearances".
4. **Same-Day Higher Team Priority** (Bye-law 7.1) — If Available (no Unavailable exception) for a higher-ranked team on the same calendar day, blocked for all lower-ranked teams. Lockout covers the entire calendar day. Reason: "Available for [Team Name] on same day".
5. **Same-Day Already Selected** — If already Selected or Reserve for any other team on the same calendar day. Reason: "Selected for [Team Name] on same day".
6. **Premier Player Cup Ban** (Bye-law 7.7) — `Ever Registered To Premier = true` blocks all Cup, Plate, Bowl fixtures. Reason: "Cup ban — ever registered to Premier Division".
7. **Cross-Cup Movement** (Bye-law 7.9) — Once appeared in a Cup fixture for one team, blocked for all other teams in any Cup competition that season. Reason: "Already played in a Cup for [Team Name] this season".
8. **League Minimum for Cups** (Bye-law 7.10) — Must have ≥ 2 total HKFC league appearances before cup selection. Reason: "Fewer than 2 league appearances — ineligible for Cup".
9. **Field Player Play-Up Limit** (Bye-law 7.2b) — At 3 play-up appearances in current season (the 4th would trigger re-registration). Reason: "Play-up limit reached — re-registration required".
10. **Premier Division Early Season** (Bye-law 7.4) — No movement between Premier team and lower-ranked teams until both teams have played ≥ 3 matches this season. Reason: "Premier movement restriction — [Team] has not played 3 matches yet".
11. **Designated Team Direction** (Bye-law 7.2a) — Higher-to-lower movement blocked without Committee approval. Reason: "Higher-to-lower movement requires Committee approval".

## Soft Warnings — Allow Selection, Show Alert

1. **Play-Up Approaching Limit (2nd appearance)** — Reason: "Second play-up appearance".
2. **Play-Up Approaching Limit (3rd appearance)** — Reason: "Third play-up appearance".
3. **Visiting Player Early Season** (Bye-law 6.6) — Must play 3 consecutive matches in first half of season. Reason: "Visiting player early-season requirement at risk".
4. **U21 Double-Game Limit** (Bye-law 7.6c) — Maximum 3 U21 double-game players per team. Reason: "U21 double-game limit approaching (3 maximum per team)".

## Goalkeeper Exemption (Bye-law 7.5) — Explicit Requirements

- A goalkeeper registered to a team in Division One or below is exempt from the 3-match play-up limit when selected as a goalkeeper for a higher-ranked team
- When computing play-up count: exclude Match Cards where `Goalkeeper = true` AND `Play Up? = true`
- The displayed play-up count in the UI must use the same exclusion so the number shown to coaches matches the number used for the hard filter
- The `Goalkeeper` checkbox on Match Cards is the authoritative source — not `Playing Position` on People
- If a GK is selected as a field player, standard play-up rules apply in full

## U21 Handling — HKFC Club Override (Explicit Requirements)

These are HKFC-specific operating rules that diverge from the formal Bye-law 7.6 text. Implement HKFC's rules, not the bye-law text.

- U21 players may be selected for any higher-ranked team — not just the immediate next team
- Same-day double games: do not enforce match timing or kick-off sequence
- A U21 may be selected for a higher-ranked team whose fixture kicks off before their designated team's fixture
- Retain hard filter (Bye-law 7.6c): maximum 3 U21 double-game players per team per calendar day

## Play-Up Count Calculation

Source of truth: Match Cards table. Computed in endpoint code, not in Airtable rollup fields.

**League play-ups (current season):** Count Match Cards where:
- `Play Up? = true`
- `Goalkeeper = false` (apply GK exemption)
- Division value indicates a league fixture
- Season (from linked Match) = current season

**Cup play-ups (current season):** Same but Division value indicates cup.

**Total HKFC appearances (current season):** All Match Cards for current season, any team.

**Total HKFC league appearances (all-time):** All league Match Cards, any season.

---

# Endpoint Design

## Authentication Model

Coaches and admins authenticate via Zite auth, with email matched to their People record. `context.user.id` resolves to the People record ID in every authenticated endpoint.

Players access their views via an unauthenticated URL containing their People record ID, passed from the Fillout redirect. The `getPlayerFixtures` and `setAvailability` endpoints are unauthenticated but validate that the record ID belongs to an active player.

## Data-Fetching Endpoints

**`getMyProfile`** — Authenticated. Looks up the logged-in user's People record by email. Returns their role(s) from `Player/Coach`, their linked teams from the Teams table (via the `Coach`, `Team Captain`, or `Section Captain` links), and whether they have admin privileges. Used by the front-end to determine which screens to show.

**`getUpcomingFixtures`** — Authenticated. Accepts an optional team name filter. Returns scheduled matches for the current season with date, opponent, venue, division, and a squad summary (selected count, reserve count, target squad size, availability counts). Sorted by date ascending.

**`getPlayersForMatch`** — Authenticated. The heaviest endpoint. Accepts a match ID. Makes 5 Airtable requests and returns every active player annotated with their availability status, current selection status, play-up count, cross-team selection status, and a structured eligibility result with a specific reason string.

5-request budget per call:
1. The target match record (1 call)
2. All active players — `People.findAll({ filters: { active: true } })`, paginated if needed
3. Availability Exceptions for this match — `AvailabilityExceptions.findAll({ filters: { match: matchId } })`
4. Squad Selections for all matches on the same calendar day — used for same-day conflict detection and cross-team selection visibility
5. Match Cards for the current season for all potentially eligible players — filtered by season, paginated if needed

Teams data (Team Rank, Is Premier, Target Squad Size) is cached in memory within the endpoint. It rarely changes.

**`getSquadForMatch`** — Authenticated. Accepts a match ID. Returns the current squad: Selected and Reserve players with their details, ordered by position then ability.

**`getPlayerFixtures`** — Unauthenticated. Accepts a People record ID. Returns upcoming fixtures for that player's registered team with their availability and selection status per fixture. Validates the record ID belongs to an active player.

## Write Endpoints

**`selectPlayer`** — Authenticated (coach only). Accepts match ID, player ID, and selection status (Selected or Reserve). Re-runs eligibility checks server-side before creating the Squad Selection record. Rejects with a specific reason message if any hard filter blocks the selection. Returns the created record.

**`removeSelection`** — Authenticated (coach only). Accepts a Squad Selection record ID. Deletes the record.

**`setAvailability`** — Unauthenticated (player-facing). Accepts a People record ID, one or more match IDs, an availability status (Unavailable / Maybe / clear), and an optional note. Creates, updates, or deletes Availability Exception records accordingly. Bulk operations use `bulkCreate`.

**`updatePlayerAdmin`** — Authenticated (admin only). Accepts a People record ID and a subset of fields to update: `isSuspended`, `matchesToServe`, `everRegisteredToPremier`, `isVisitingPlayer`, `playingAbility`, `playingPosition`, `registeredTeam`. Updates the People record. Does not expose full membership data.

---

# MVP Screens

## Coach Screens (3 views)

**Fixture List** — The coach's home screen. Shows upcoming scheduled matches for the team(s) they coach. Each fixture card shows date, opponent, venue, division, and a squad status summary (selected count / target squad size). Tapping a fixture opens the Squad Selection view.

**Squad Selection** — The core workflow screen. For one fixture, shows a header with match details and squad summary (target size, selected count, reserve count, availability breakdown). Below, a scrollable player list showing every active player with: preferred name, position, ability, availability status, play-up count, eligibility status with reason, and cross-team selection status. Players blocked by hard filters show a specific reason label and a disabled selection control. Filter controls for position, availability, and eligibility. Tap to select (creates record), tap again to remove (deletes record). Secondary action to mark as Reserve.

**Player Management** — Admin-only, added to the coach screens. Searchable list of all active players. Tap to edit the seven eligibility-relevant fields: `Is Suspended`, `Matches To Serve`, `Ever Registered To Premier`, `Is Visiting Player`, `Playing Ability`, `Playing Position`, `Registered Team`. Does not expose the full membership record.

## Player Screens (2 views, no login)

**My Fixtures** — Shows upcoming matches for the player's registered team. Each row shows date, opponent, venue, their current availability status, and their selection status (not selected / selected / reserve). Accessed via URL with the player's People record ID from Fillout.

**Update Availability** — Tapping a fixture opens a panel where the player can mark themselves Unavailable or Maybe with an optional note, or clear their exception to return to Available. A "bulk unavailable" option lets them select a date range and mark all fixtures in that window.

---

# Build Sequence

## Phase 1 — Schema + Auth

Add the three missing fields to People (`Is Suspended`, `Matches To Serve`, `Ever Registered To Premier`). Validate that all active players have `Registered Team`, `Playing Position`, and `Playing Ability` populated. Validate that all 8 teams have unique, sequential Team Rank values.

Enable Zite user sync linking the People table's `Email` field to the logged-in user.

Build `getMyProfile`. Build the front-end auth gate that checks the user's role from `Player/Coach` and routes to the appropriate home screen.

Build first with coach access. Admin distinction can use a hardcoded record ID list until Phase 5.

**Why first:** Every authenticated endpoint and every role-conditional screen depends on this.

## Phase 2 — Fixture List + Squad View (Read-Only)

Build `getUpcomingFixtures` and `getSquadForMatch`. Build the Fixture List screen for coaches. Build a read-only squad view per fixture showing current selections and availability summary.

**Why second:** Gives coaches immediate visibility into their fixtures using data already in Airtable. No eligibility logic yet.

## Phase 3 — Squad Selection + Eligibility Engine

Build `getPlayersForMatch` with the full eligibility engine. This is the most complex piece of the build. It must implement:

- All 11 hard filters with specific reason strings
- All 4 soft warnings with specific reason strings
- Goalkeeper exemption from play-up counting
- HKFC U21 override rules
- Cross-team selection conflict detection and visibility (not just a blocked flag — coaches must see which team has the player)
- Play-up count computed from Match Cards with GK exclusion

Build `selectPlayer` and `removeSelection`. The `selectPlayer` endpoint re-runs eligibility server-side and rejects with a reason if blocked.

Build the Squad Selection screen with the annotated player list, eligibility labels, reason strings, cross-team status badges, and selection controls.

**Why third:** This is the core of the app. It depends on auth (Phase 1) and the fixture list (Phase 2).

## Phase 4 — Player Availability

Build `getPlayerFixtures` and `setAvailability`. Build the player-facing My Fixtures and Update Availability views. These are unauthenticated and accessed via URL parameter from Fillout.

**Why fourth:** Availability data feeds into the Squad Selection view (Phase 3 already reads it), but coaches can operate without player-submitted availability — everyone is assumed available by default. This phase can lag behind the coach workflow.

## Phase 5 — Admin Screen

Build `updatePlayerAdmin`. Build the Player Management screen. Admin fields (`Is Suspended`, `Ever Registered To Premier`) can be set directly in Airtable until this screen exists.

**Why fifth:** Admin fields can be managed directly in Airtable in the short term without blocking any coach workflow.

## Phase 6 — Coach Dashboard (Post-MVP)

Cross-team visibility for coaches managing multiple teams or with section oversight.

Dashboard panels:
- Upcoming fixtures per assigned team: squad count vs target, shortfall flag
- Players approaching play-up limit (2 of 3 used in current season)
- Players who have reached the limit and may require re-registration
- Players with `Is Suspended = true`
- Players with Unavailable exceptions across the next two fixture weeks

The dashboard is a visibility tool only. All actions are taken from the fixture or squad selection views.

**Why last:** Useful but not blocking. All the same data is accessible from individual fixture views.

## Phase 7 — Notifications (Post-MVP)

One specific trigger only: when a player marks themselves Unavailable for a fixture where they already hold a Squad Selection record, notify the relevant coach.

Implementation: `setAvailability` checks for an existing Squad Selection record for the same player and match. If found, it triggers a notification to the coach linked to that selection via `Selected By`.

Do not build a generic notification framework. Keep this narrow.

---

# Make.com

Make.com is not needed for the MVP. All logic runs in Zite endpoints. The free-tier credit limit makes Make.com unsuitable for any workflow that runs at volume or on a schedule. It remains available for future low-frequency event-driven scenarios if needed post-MVP.

---

# Out of Scope — Confirmed

The following remain explicitly out of scope:

- Recommendation engine (weighted scoring for squad shortfalls — deferred post-MVP)
- WhatsApp Business integration
- Automated player approval workflows
- Advanced AI selection recommendations
- Automatic re-registration processing (the app provides visibility and alerts; admin acts)
- Calendar integration
- Automatic suspension calculation from card data (admin manual entry only)
- Season rollover tooling (admin manages this directly in Airtable for now)
- Make.com automations for MVP