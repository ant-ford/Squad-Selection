# HKFC Eligibility Specification v1.0 — Implementation Analysis

**Date:** July 2026  
**Status:** Specification Review & Build Impact Assessment  
**Authority:** HKFC Eligibility & Selection Rules Specification v1.0

---

## Executive Summary

The HKFC Eligibility & Selection Rules Specification v1.0 is **comprehensive, well-structured, and implementable** within the existing MVP Blueprint and Roadmap v2 architecture. 

**Key Findings:**

- **No critical contradictions** exist between the specification and the Roadmap v2.
- **Minimal data model changes** required; the Airtable schema largely supports the rules.
- **High implementation clarity** due to explicit evaluation order and standardized reason strings.
- **Server-side eligibility engine** is feasible within Zite endpoint constraints.
- **Performance is manageable** for the stated user base (150–250 active players, 8 teams).

**Must-Do Before Build:**
1. Confirm the three missing People fields are added to Airtable schema
2. Validate all active players have complete admin data
3. Design the eligibility engine execution sequence (detailed below)
4. Implement server-side validation in `selectPlayer` endpoint

**Timeline:** Phase 3 (Squad Selection + Eligibility Engine) is the critical path. Allocate 80–120 hours for full engine implementation and testing.

---

## 1. Consistency Review

### 1.1 Internal Specification Contradictions

**Finding:** None identified.

The specification maintains **logical coherence** across all sections:

- Rule hierarchy (§1.1) clearly establishes HKFC operational overrides take precedence over bye-laws.
- Evaluation order (§4) is explicit and unambiguous.
- Play-up counting (§10) clearly excludes goalkeeper appearances, consistent with exemption rules (§11).
- Cup eligibility rules (§14) are layered without overlap.
- U21 same-day exemption (§12.1) is clearly scoped: registered team + higher teams only.
- Re-registration logic (§13) correctly identifies the threshold (4 qualifying appearances) and the effect (unavailability for lower team).

**Severity:** None

---

### 1.2 Ambiguous Wording

#### Finding 1: "Qualifying play-up appearances" (§10, §13)

**Issue:** The term "qualifying play-up appearances" is used in two contexts:

1. **Play-up counting (§10):** Excludes goalkeeper appearances where `Play Up? = true AND Goalkeeper = true`
2. **Re-registration (§13):** "four qualifying play-up appearances above their registered team"

**Question:** Do goalkeeper play-up appearances count toward the re-registration threshold of 4?

**Analysis:**  
- **Most Likely Interpretation:** "Qualifying" in §13 means the same as §10 — excludes goalkeepers playing as goalkeepers.
- **Rationale:** The goalkeeper exemption (§11) explicitly exempts from play-up counting. Re-registration depends on play-up count. Consistency demands goalkeepers are excluded.

**Recommended Resolution:**

Add clarification to §13.1:

```
When a player records four qualifying play-up appearances 
(excluding goalkeeper appearances per §10) above their registered team:
```

**Severity:** Medium — Could cause implementation error if overlooked

---

#### Finding 2: "First appearance" for re-registration (§13)

**Issue:** §13.2 uses the example:

```
HKFC C (registered) = 8 appearances
HKFC B = 1 appearance
HKFC A = 3 appearances
```

The rule states the player "becomes unavailable for HKFC C" and "The player's effective playing team becomes: The lowest-ranked team for which they have accumulated four qualifying play-up appearances."

**Question:** What if a player has:
- 4 appearances for HKFC A
- 1 appearance for HKFC B

Which team is "lowest-ranked"? (A is higher-ranked / lower number, B is lower-ranked / higher number.)

**Analysis:**  
The phrase "lowest-ranked team" in the context of "for which they have accumulated four qualifying play-up appearances" means: **the highest team number** where the player has reached the threshold. This is consistent with the principle that once a player is eligible to play regularly at a higher level, they shouldn't drop back down.

**Recommended Resolution:**

Clarify §13.2 terminology:

```
The player's effective playing team becomes the highest-ranked team 
(lowest Team Rank number) for which they have accumulated 
four qualifying play-up appearances.
```

**Severity:** Medium — Implementation could be unclear

---

#### Finding 3: Visiting Player Cup Eligibility (§6.3)

**Issue:** §6.3 states visiting players require "Five appearances for their registered team" before Cup eligibility.

**Question:** Does this mean:
- Five appearances **total** (league + cup)?
- Five **league** appearances specifically?
- Five appearances **for any HKFC team**?

**Context from Bye-Laws:**  
The bye-laws reference "league matches" specifically for visiting player minimums.

**Recommended Resolution:**

Update §6.3 to clarify:

```
Visiting Players require five league appearances for their registered team 
before becoming eligible for any Cup, Plate or Bowl fixture.
```

**Severity:** Medium — Affects eligibility calculation

---

### 1.3 Logical Gaps

#### Gap 1: Multi-Season Suspensions (§5)

**Issue:** §5 states "Suspensions may carry forward into future seasons where required by HKHA rulings."

**Gap:** The specification does not define:
- Whether a suspension carries over automatically, or
- Whether admin must manually re-flag the player in the new season, or
- Whether `Matches To Serve` persists and decrements, or
- Whether a new season triggers a reset and admin enters a fresh `Matches To Serve` count

**Impact:** High — Affects how suspensions are managed operationally.

**Recommended Resolution:**

Add guidance to §5:

```
When suspensions carry forward to a new season:

1. Admin must manually re-flag the player: Is Suspended = true 
   and set Matches To Serve = [remaining count]
2. At season boundary, Is Suspended and Matches To Serve 
   do NOT automatically reset
3. Admin is responsible for clearing these flags once the 
   suspension is served
```

**Severity:** High — Operational clarity required

---

#### Gap 2: Re-Registration and Cup Eligibility (§13 + §14)

**Issue:** When a player becomes re-registered to a higher team (§13), does their cup eligibility reset?

**Scenario:**
- Player registered to HKFC C
- Has 1 league appearance for HKFC C
- Plays 4 games for HKFC A (including one cup game)
- Auto re-registers to HKFC A

**Question:** For the re-registered team (HKFC A):
- Do they need 2 more league appearances before playing another cup?
- Or does the 1 appearance for HKFC C count?

**Recommended Resolution:**

Add clarification to §14.2:

```
The "two league appearances" requirement applies per team per season. 
When a player is auto-re-registered to a higher team (§13), 
their appearance count for cup eligibility resets to zero for that team. 
Appearances for the original registered team do not transfer.
```

**Severity:** High — Affects cup eligibility calculation

---

#### Gap 3: Visiting Player Re-Registration (§6 + §13)

**Issue:** Can a visiting player be auto-re-registered to another team under §13?

**Scenario:**  
Visiting player registered to HKFC C. Plays 4 times for HKFC A.

**Question:** Does the re-registration rule apply, making them unavailable for HKFC C, or does §6.2 (visiting players fixed to registered team) prevent re-registration?

**Recommended Resolution:**

Add to §13:

```
Re-registration rules (§13) apply only to permanent residents. 
Visiting Players (§6) remain fixed to their registered team 
and cannot be auto-re-registered.
```

**Severity:** High — Affects eligibility logic

---

### 1.4 Edge Cases

#### Edge Case 1: Goalkeeper Exemption and Play-Up Limits

**Scenario:**
- GK registered to HKFC C (Division One)
- Plays as GK for HKFC A three times (play-ups, all appearances are GK = true)
- Then plays as field player for HKFC A once

**Question:** Is the field player appearance the 1st or the 4th play-up?

**Current Logic:** The field player appearance should count as the 1st play-up, because prior GK appearances are excluded from the count.

**Specification Clarity:** §11.2 and §11.3 correctly address this: GK appearances don't count; field player appearances do (standard rules apply).

**Severity:** Low — Specification is clear; implementation must be careful to exclude only GK-as-GK appearances.

---

#### Edge Case 2: Same-Day with Multiple Higher Teams

**Scenario:**  
Player available for:
- HKFC A (Rank 1) at 1 PM
- HKFC B (Rank 2) at 3 PM

Lower team (HKFC C, Rank 3) wants to select same day at 5 PM.

**Current Logic:** §7.2 blocks selection because player is available for a higher-ranked team (HKFC A).

**Question:** Does HKFC C also see blocking reason for HKFC B, or only for HKFC A?

**Recommended Resolution:**

In the blocking reason, cite the **highest-ranked team** that conflicts:

```
"Available for [Highest Ranked Team] on same day"
```

If available for both A and B, show:
```
"Available for HKFC A on same day"
```

**Severity:** Low — UX clarity; doesn't affect logic.

---

#### Edge Case 3: U21 Double-Game Count (§12.3)

**Scenario:**  
Match day has two fixtures:
- HKFC A at 2 PM
- HKFC B at 4 PM

Three U21 players are selected for both (double-game).  
Fourth U21 player registered to HKFC B is available for HKFC A.

**Question:** Can the fourth U21 play in the A game (making them count toward the double-game limit for HKFC A), even though they might not play the B game?

**Analysis:**  
§12.3 states: "Maximum: Three U21 double-game players per team per day."

A "double-game player" is "a U21 player appearing in a second match on the same day."

The limit is **per team**. If HKFC A already has 3 double-game U21s (playing A + their registered team), a fourth U21 **cannot play for HKFC A** on that day.

**Specification Clarity:** Clear. The rule is per team and counts only those appearing in two matches.

**Severity:** Low — Specification is precise.

---

### 1.5 Conflicts with Airtable Architecture

#### Issue 1: Play-Up Count Computation (§10)

**Problem:**  
The Roadmap v2 (line 87) explicitly states:

> "Play-up counts (requiring `Play Up? = true AND Goalkeeper = false AND Season = current AND Division = league`) cannot be expressed as rollups and must live in endpoint code."

**Analysis:**  
The specification §10 requires computing "Adjusted Play-Up Count" by counting:
- Match Cards where `Play Up? = true`
- Excluding goalkeeper appearances (where `Goalkeeper = true`)

The Roadmap is correct: Airtable rollups cannot filter on formula fields in linked tables. The `Play Up?` field is on Match Cards; the `Goalkeeper` field is also on Match Cards. 

**Possible Solution:**  
If Airtable's rollup engine improves, or if a helper table is introduced, this could move to a formula. For now, **it must remain in endpoint code**.

**Verdict:** Not a conflict — Roadmap correctly identifies the constraint.

---

#### Issue 2: Cup Eligibility and Match Type (§14)

**Problem:**  
The specification requires filtering by:
- League appearances (§14.2)
- Cup/Plate/Bowl appearances (§14.1, §14.3)

**Question:** How does the Matches table distinguish these?

**Analysis:**  
Roadmap v2 doesn't explicitly define a `Match Type` or `Competition` field on Matches. The HKHA sync (Phase 0) populates Matches from two sources:
- MenFixture.asp (no type info)
- MCList.asp (contains fixture type information)

**Required Action:**  
Ensure the Matches table includes a field (e.g., `Competition Type`) with values:
- League
- Cup
- Plate
- Bowl

This field must be populated during `hkha-sync` from MCList.asp.

**Severity:** High — Required for cup eligibility checks.

---

#### Issue 3: Season Field on Matches

**Status:** Already in place per Roadmap v2, line 59.

The Matches table has a `Season` formula field. ✓

---

### 1.6 Conflicts with Existing MVP Blueprint

#### Conflict 1: Data Validation Requirement (§2.2)

**Specification (§2.2):**
```
Active players missing any of:
- Registered Team
- Playing Position
- Playing Ability

must be blocked from selection.
```

**Roadmap v2 (Phase 1):**
States "Validate that all active players have Registered Team, Playing Position, and Playing Ability populated" but does not specify **how the app enforces this at selection time**.

**Required Addition:**  
In the Squad Selection view, players with incomplete admin data must:
1. Not appear in the selectable list, or
2. Appear but be disabled with reason: `Admin data incomplete`

**Recommendation:** Display them with a visual indicator (e.g., greyed out, with warning icon) so coaches can see who needs admin correction.

**Severity:** Medium — Blueprint scope needs clarification.

---

#### Conflict 2: Availability Lock Wording (§7.2)

**Specification (§7.2):**
```
Availability means: No Unavailable exception exists for the higher team's fixture.
```

**Interpretation:**  
If a player has marked themselves Unavailable for a higher team's match, that player **is NOT available** for that higher team, so the same-day lock does **not** apply to lower teams.

**Roadmap v2 Status:**  
The Squad Selection view correctly reads availability exceptions. The `getPlayersForMatch` endpoint must check:

```
If (higher team fixture on same day) AND 
   (NO availability exception for higher team) THEN 
   block lower team selection
```

**Verdict:** Specification is precise; Roadmap must ensure availability exceptions are checked.

**Severity:** Medium — Important for correct same-day logic.

---

#### Conflict 3: Cross-Team Selection Visibility (Roadmap v2, lines 132–165)

**Roadmap Requirement:**
> "Cross-team selection visibility shows the coach which other team has selected the player, not just a blocked flag."

**Specification Alignment:**
§7.2 provides reason: `Selected for [Team] on same day`

Specification does **not** require display of the player's selection status for other teams beyond the blocking reason.

**Recommendation:**  
The Squad Selection view should show:
1. **Blocking reason** (per spec): `Selected for HKFC A on same day`
2. **Additional context** (UX enhancement): Show the player's status in other team fixtures on that day (e.g., "Selected for HKFC A", "Unavailable for HKFC B")

This aligns with both the Specification and Roadmap goals.

**Severity:** Low — Enhancement, not a conflict.

---

### 1.7 Conflicts with Implementation Roadmap v2

#### Potential Conflict 1: Higher-Team Priority Auto-Deselection (§7.3)

**Specification (§7.3):**
```
If lower team already selected player
and higher team subsequently selects player:
- Higher team selection succeeds
- Lower team selection is automatically removed
- Notification is generated for affected lower-team coach
```

**Roadmap v2 (line 511):**
```
Phase 7 — Notifications (Post-MVP)
One specific trigger only: when a player marks themselves Unavailable 
for a fixture where they already hold a Squad Selection record
```

**Gap:**  
The Roadmap defers notifications to Phase 7 (post-MVP). But §7.3 requires notification **immediately** when a higher team selects a player already selected by a lower team.

**Severity:** High — Functional requirement vs. deferred feature.

**Recommended Resolution:**

**Option A (Strict Spec Compliance):**  
Implement §7.3 notification in Phase 3, not Phase 7. Scope: narrow notification only for higher-team priority conflicts. Implement in-app notifications only (no external messaging).

**Option B (Pragmatic MVP):**  
In Phase 3:
- Implement auto-deselection of lower-team selection (§7.3 logic)
- Add an audit log entry or system note visible to coaches on refresh
- Defer full notification framework to Phase 7

**Recommended Approach:** Option B.

Rationale: The core functionality (preventing duplicate selections and enforcing hierarchy) must work. Notification delivery can lag without breaking the system. Coaches will see the change on their next view refresh.

**Implementation:** Add a flag to the Squad Selection record: `AutoRemovedDueToHigherTeam = true` and `AutoRemovedTimestamp`. The Squad Selection view shows a notification banner if recently removed selections exist.

**Severity:** High — Requires Phase 3 design decision.

---

#### Potential Conflict 2: Suspension Carryover (§5 vs. Roadmap §24 Season Rollover)

**Specification (§5):**
```
Suspensions may carry forward into future seasons 
where required by HKHA rulings.
```

**Roadmap v2 (lines 524–536, Out of Scope):**
```
Season rollover tooling (admin manages this directly in Airtable for now)
```

**Alignment:**  
No conflict. The Roadmap acknowledges that season management is manual. The specification allows for this: admin manually maintains suspension flags.

**Severity:** None — Aligned.

---

## 2. Data Model Impact Assessment

### 2.1 Required New Fields

#### Status: 3 New Fields Required

The Roadmap v2 (Phase 1) already identified these three missing fields. They must be added to the `People` table.

| Field | Table | Type | Purpose | Source |
|-------|-------|------|---------|--------|
| **Is Suspended** | People | Checkbox | Hard filter: blocks all selection | Admin manual entry |
| **Matches To Serve** | People | Number | Remaining suspension matches | Admin manual entry |
| **Ever Registered To Premier** | People | Checkbox | Cup eligibility filter | Admin manual entry (set once if player ever registered to Premier during season) |

**Implementation Notes:**

1. **Is Suspended:** Default = false. Admin sets true when official HKHA suspension notification received.
2. **Matches To Serve:** Default = 0. Admin enters remaining match count when suspension imposed. System does **not** auto-decrement (manual process).
3. **Ever Registered To Premier:** Default = false. Admin sets true if player is registered to Premier or moved to Premier at any point in the season. Never auto-resets during season; reset manually at season boundary.

**Data Validation:**

Add Airtable field validation:
- `Matches To Serve` must be ≥ 0
- If `Is Suspended = true`, treat player as blocked regardless of `Matches To Serve` value

---

### 2.2 Existing Fields That Must Change

#### Issue: Match Type on Matches Table

**Current State (per Roadmap v2):**  
The Matches table has:
- `Season` (formula field)
- Record links to Match Cards
- But **no explicit field distinguishing League vs. Cup vs. Plate vs. Bowl**

**Required Change:**

Add a new field to Matches:

| Field | Table | Type | Purpose | Required Values |
|-------|-------|------|---------|-----------------|
| **Competition Type** | Matches | Single Select | Determines cup eligibility rules | League, Cup, Plate, Bowl |

**Rationale:**  
The specification requires filtering by competition type:
- §14.2: "Two league appearances" (excludes cup)
- §14.1: Cup ban only applies to certain competitions

**Implementation:**

During `hkha-sync`, populate `Competition Type` from MCList.asp fixture type data.

If MCList.asp doesn't distinguish Plate/Bowl separately, use placeholder values and require manual correction or enhanced parsing.

**Severity:** Critical — Required for cup eligibility checks.

---

#### Enhancement: Add `Effective Team` (Computed)

**Not Strictly Required by Specification**, but **highly recommended** for performance and clarity.

| Field | Table | Type | Purpose |
|-------|-------|------|---------|
| **Effective Team** | People | Single Select (formula or linked record) | Computed team taking into account re-registration |

**Formula Logic:**

```
IF(
  [Play-Up Count] >= 4,
  [Highest Team Where Play-Up Count >= 4],
  [Registered Team]
)
```

**Benefit:**  
Coaches can immediately see which team a player is effectively registered to after reaching the 4-play-up threshold. Reduces need to compute this in every endpoint call.

**Note:** This is a denormalization for UX. The source of truth remains the computed play-up counts in endpoint code.

---

### 2.3 New Formulas or Calculations Required

#### Formula 1: Play-Up Count (Lives in Endpoint Code, Not Airtable)

**Cannot be expressed as Airtable formula.** Must be computed in `getPlayersForMatch` endpoint.

**Pseudo-Code:**

```
SELECT COUNT(*) FROM MatchCards
WHERE 
  Player = [Target Player]
  AND Team != Player.Registered Team
  AND Play Up? = true
  AND Goalkeeper = false
  AND Season = [Current Season]
```

**Implementation:**  
Load all current-season Match Cards for the player, filter in code, count qualifying appearances.

---

#### Formula 2: Cup Appearance Count (Lives in Endpoint Code)

**Cannot be expressed as Airtable formula.**

**Pseudo-Code:**

```
SELECT COUNT(DISTINCT Team) FROM MatchCards
WHERE 
  Player = [Target Player]
  AND Matches.Competition Type IN ('Cup', 'Plate', 'Bowl')
  AND Season = [Current Season]
  AND Matches.Team = [Check Team]
```

**Purpose:**  
Determine if player has already played in a cup for another team (§14.3).

---

#### Formula 3: League Appearance Count (Lives in Endpoint Code)

**Pseudo-Code:**

```
SELECT COUNT(*) FROM MatchCards
WHERE 
  Player = [Target Player]
  AND Matches.Competition Type = 'League'
  AND Season = [Current Season]
  AND Matches.Team = [Check Team]
```

**Purpose:**  
Verify minimum 2 league appearances before cup eligibility (§14.2).

---

#### Formula 4: Visiting Player Appearance Count (Lives in Endpoint Code)

**Pseudo-Code:**

```
SELECT COUNT(*) FROM MatchCards
WHERE 
  Player = [Target Player]
  AND Team = Player.Registered Team
  AND Matches.Competition Type = 'League'
  AND Season = [Current Season]
```

**Purpose:**  
Verify 5 league appearances before cup eligibility for visiting players (§6.3).

---

### 2.4 Data Consistency Checks Required

#### Check 1: Team Rank Uniqueness

**Requirement:** All teams in Teams table must have unique, sequential Team Rank values (1, 2, 3, ... N).

**Validation:** Implement in data sync or admin panel:
```
SELECT COUNT(DISTINCT Team_Rank) FROM Teams
WHERE Active = true

Must equal COUNT(*) of active teams
```

**Severity:** Critical — Affects team hierarchy logic.

---

#### Check 2: Registered Team Validity

**Requirement:** All active players must have a Registered Team that exists in the Teams table and has a valid Team Rank.

**Validation:**
```
FOR EACH Person WHERE Active = true:
  Registered Team must exist in Teams
  Teams.Active must be true
```

---

#### Check 3: Competition Type Population

**Requirement:** All Matches records must have a populated Competition Type.

**Validation:**
```
SELECT * FROM Matches
WHERE Competition Type IS NULL

Result must be empty; if not, data sync or manual correction needed.
```

---

## 3. API Impact Assessment

### 3.1 Existing Endpoints — Change Matrix

#### getMyProfile

**Purpose:** Authenticated. Returns user details and role.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | No | User data unchanged |
| **New Eligibility Fields** | No | |

---

#### getUpcomingFixtures

**Purpose:** Authenticated. Lists upcoming matches for coach's assigned team(s).

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | No | Read-only fixture list; no eligibility logic |
| **New Eligibility Fields** | No | |

---

#### getSquadForMatch

**Purpose:** Authenticated. Returns current squad selections for a match.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | No | Existing selections already include all required fields |
| **New Eligibility Fields** | No | |

---

#### getPlayersForMatch ⚠️ **MAJOR**

**Purpose:** Authenticated. Returns all active players with eligibility status for a target match.

**Current State (per Roadmap v2):** 5 Airtable requests per call.

**Modifications Required:** YES — Add complete eligibility engine.

| Input | Current | Required Change |
|-------|---------|-----------------|
| match_id | ✓ | No change |
| team_id (inferred from match) | ✓ | No change |

| Output | Current | Required Change |
|--------|---------|-----------------|
| eligibilityStatus | ✓ | Add as per §15 |
| reason | Partial | **Expand to all 13 blocked + 4 warning reasons** |
| availabilityStatus | ✓ | No change |
| selectedByTeam | Partial | **Enhance: null if unselected, show exact team if selected** |
| playUpCount | ✓ | No change |
| isU21 | ✓ | No change |

**New Eligibility Fields Required:**
- `suspensionStatus` (derived from Is Suspended or Matches To Serve)
- `visitingPlayerStatus` (derived from Is Visiting Player and appearance count)
- `sameDayHigherTeam` (computed from same-day availability/selections)
- `premierRestrictionStatus` (computed from match history)
- `playUpLimitStatus` (computed from play-up count)
- `cupEligibilityStatus` (computed from league appearance count + cup history)
- `u21DoubleGameCount` (computed per team per day)
- `effectiveTeam` (computed from re-registration logic)

**Evaluation Order:**
Implement steps 1–8 from §4 in sequence, short-circuiting on first block.

**New Airtable Requests:**
- Load Matches record (Competition Type needed)
- Load all Players (filtering by Active, complete admin data)
- Load all Availability Exceptions for target match date
- Load all Squad Selections for same calendar day
- Load Match Cards for current season (all players, all teams)
- **New:** Load Teams table (cached in memory)
- **New:** Load People table (Is Suspended, Matches To Serve, Ever Registered To Premier, Is Visiting Player, U21 Eligible)

**Estimated Call Count:** 6–7 requests (was 5 per Roadmap; added 1–2 for new fields).

**Performance Note:** Match Cards load could be large (100s–1000s of records for a full season). Implement pagination or caching.

---

#### selectPlayer ⚠️ **MAJOR**

**Purpose:** Authenticated (coach only). Creates a Squad Selection record.

**Current State (per Roadmap v2):** Basic selection; limited validation.

**Modifications Required:** YES — Server-side eligibility revalidation + higher-team priority logic.

| Input | Current | Required Change |
|-------|---------|-----------------|
| match_id | ✓ | No change |
| player_id | ✓ | No change |
| selectionStatus | ✓ | No change |

| Output | Current | Required Change |
|--------|---------|-----------------|
| success | ✓ | No change |
| reason | Partial | **Add detailed rejection reason if blocked** |
| autoRemovedConflict | New | **Return details if a lower-team selection was auto-removed** |

**Server-Side Eligibility Checks:**
Before creating the Squad Selection record, call `getPlayersForMatch` logic to determine eligibility for that specific player and match.

If blocked, reject with reason. Provide exact message from §16.

**Higher-Team Priority Logic (§7.3):**
After validating the player is eligible for the higher team, **check if the player is already selected by a lower-ranked team on the same day**.

If yes:
1. Delete the lower-team Squad Selection record
2. Log auto-removal reason
3. Create the higher-team Squad Selection record
4. Return success with flag: `autoRemovedLowerTeamSelection = { team: "HKFC C", reason: "..." }`

**Notification Requirement (§7.3):**
After auto-removal, the coach for the lower team should be notified. 

**Phase 3 Approach:** Add in-app notification (visible on next view refresh). Store removal reason in Squad Selection record.

**New Airtable Requests:**
- Re-run `getPlayersForMatch` logic internally (6–7 requests)
- Load existing Squad Selections for same-day conflicts (1 request)

**Estimated Call Count:** 7–8 requests.

---

#### removeSelection

**Purpose:** Authenticated (coach only). Deletes a Squad Selection record.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | No | Simple delete; no eligibility logic required |
| **New Eligibility Fields** | No | |

---

#### getPlayerFixtures

**Purpose:** Unauthenticated. Returns upcoming matches for a player's registered team.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | No | Read-only player view; no eligibility logic |
| **New Eligibility Fields** | No | Availability and selection status are sufficient |

---

#### setAvailability

**Purpose:** Unauthenticated (player-facing). Records availability exceptions.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | Minor | Check for existing Squad Selection when Unavailable is set |
| **New Eligibility Fields** | No | |

**Enhancement (§7.3 Notification):**
When a player marks themselves Unavailable for a match where they have a Squad Selection record, trigger a coach notification:

```
IF (setAvailability == Unavailable) AND (existing Squad Selection exists) THEN
  - Log notification event
  - Coach sees notification on next view refresh
```

---

#### updatePlayerAdmin

**Purpose:** Authenticated (admin only). Updates player admin fields.

| Aspect | Status | Notes |
|--------|--------|-------|
| **Requires Modification** | Yes | Add three new fields (Is Suspended, Matches To Serve, Ever Registered To Premier) |
| **New Eligibility Fields** | Yes | Required |

**Fields Updatable:**
- Is Suspended
- Matches To Serve
- Ever Registered To Premier
- Is Visiting Player
- Playing Ability
- Playing Position
- Registered Team
- U21 Eligible (new)

**Validation:**
- Matches To Serve must be ≥ 0
- Is Suspended and Matches To Serve should be consistent (if Is Suspended = false, consider Matches To Serve = 0)

---

### 3.2 New Endpoints Required

#### None

All eligibility logic can be integrated into existing endpoints. No new endpoints required for MVP.

---

### 3.3 Performance Concerns

#### Concern 1: Match Cards Load Size

**Issue:** Loading all current-season Match Cards for 250 players × 8 teams could be 1000+ records.

**Mitigation:**
- Implement pagination: load in batches of 100 records
- Cache Match Cards in-memory for 10–15 minutes
- Filter at source: `Season = [Current Season] AND Team IN [All Teams]`

**Implementation Note:**
Consider a caching layer (e.g., Redis or in-memory store in Zite) to avoid repeated full loads.

---

#### Concern 2: Same-Day Conflict Checks

**Issue:** For each player in a squad, checking same-day availability + selections for all higher teams could involve 20+ data points per player.

**Mitigation:**
- Pre-load all same-day fixtures when loading match fixtures
- Cache team hierarchy in memory (rarely changes)
- Short-circuit evaluation: stop checking once a higher-team conflict is found

---

#### Concern 3: Airtable API Rate Limits

**Issue:** Typical Airtable free tier: 5 requests per second, 30 per 30 seconds.

Each `getPlayersForMatch` call makes 6–7 requests. If called frequently by multiple coaches, could hit limits.

**Mitigation:**
- Use Airtable's batch request API (if available in Zite)
- Implement request queuing in endpoints
- Cache stable data (Teams, Players) aggressively
- Monitor API usage and alert on excessive load

---

## 4. Eligibility Engine Design

### 4.1 Evaluation Order (Per §4)

The eligibility engine must evaluate rules in this sequence, **short-circuiting on first block**:

```
Step 1: Administrative Data Validation
  ├─ Is player Active?
  ├─ Does player have Registered Team?
  ├─ Does player have Playing Position?
  └─ Does player have Playing Ability?
    → If any false: Block with "Admin data incomplete"

Step 2: Suspension Checks
  ├─ Is Suspended = true?
  └─ Matches To Serve > 0?
    → If either true: Block with "Suspended"

Step 3: Visiting Player Restrictions
  ├─ Is Visiting Player = true?
  ├─ Target match team = Registered Team?
  └─ For cup matches: Count league appearances for registered team >= 5?
    → If fixed team violation: Block with "Visiting player — fixed to registered team"
    → If cup and < 5 apps: Block with "Visiting player — fewer than 5 appearances for registered team"

Step 4: Same-Day Team Movement Rules
  ├─ Is there a higher-ranked team fixture on same day?
  ├─ Is player available for that higher team (no Unavailable exception)?
  └─ OR is player already selected by higher team?
    → If either: Block with "Available for [Team] on same day" OR "Selected for [Team] on same day"

Step 5: Premier Division Restrictions
  ├─ Is target match team Premier Division?
  ├─ Is player not registered to Premier, but both teams have < 3 completed matches?
  └─ OR is player registered to Premier, but lower-division team has < 3 completed matches?
    → If true: Block with "Premier movement restriction — team has not completed 3 matches"

Step 6: Play-Up Rules
  ├─ Is target team higher-ranked than Registered Team?
  ├─ Does play-up count >= 4?
  └─ Is player not a goalkeeper or match not marked as goalkeeper play?
    → If play-up >= 4: Block with "Play-up limit reached — re-registration required"
    
  ├─ Is target team lower-ranked than Registered Team?
    → If true: Block with "Higher-to-lower movement requires Committee approval"

Step 7: Cup Eligibility Rules
  ├─ Is match a Cup/Plate/Bowl?
  ├─ Has player ever been registered to Premier (Ever Registered To Premier = true)?
    → If true: Block with "Cup ban — ever registered to Premier Division"
  ├─ Does player have >= 2 league appearances this season?
    → If false: Block with "Fewer than 2 league appearances — ineligible for Cup"
  ├─ Has player played cup for another team this season (Cross-Cup rule)?
    → If true: Block with "Already played in a Cup for [Team] this season"

Step 8: U21 Double-Game Warnings & Limits
  ├─ Is player U21 Eligible = true?
  ├─ Is target team different from Registered Team (i.e., a play-up)?
  ├─ Count other U21 players selected for target team same-day double-game
  ├─ If count == 3:
    → Block with "U21 double-game limit reached"
  ├─ If count == 2:
    → Warning with "U21 double-game limit approaching"

Step 9: Generate Warnings (Only If Not Blocked)
  ├─ Is player 2 or 3 play-ups toward limit?
    → Warning: "Second play-up appearance" OR "Third play-up appearance"
  ├─ Is visiting player with early-season requirement at risk?
    → Warning: "Visiting player early-season requirement at risk"
```

### 4.2 Data Fetch Strategy

**Single Load Sequence (executed once per `getPlayersForMatch` call):**

```
1. Load Matches record → extract Season, Team, Competition Type, Date
2. Load Teams table → cache in memory (Team Rank, Is Premier)
3. Load all active People records → cache with admin fields
4. Load all Availability Exceptions for Date
5. Load all Squad Selections for Date
6. Load Match Cards filtered by Season (current season only)

Then iterate through each player and apply engine rules.
```

**Pseudo-Code in Zite Endpoint:**

```typescript
async function getPlayersForMatch(matchId: string) {
  // 1. Load match
  const match = await airtable.getRecord('Matches', matchId);
  const matchDate = match.Date;
  const matchTeam = match.Team;
  const season = match.Season; // formula field
  const competitionType = match['Competition Type'];

  // 2. Load and cache teams
  const teams = await airtable.getRecords('Teams', {
    filterByFormula: '{Active} = true()'
  });
  const teamMap = new Map(teams.map(t => [t.id, t]));

  // 3. Load active people
  const people = await airtable.getRecords('People', {
    filterByFormula: '{Active} = true()'
  });
  const personMap = new Map(people.map(p => [p.id, p]));

  // 4. Load availability exceptions for date
  const availabilityExceptions = await airtable.getRecords(
    'Availability Exceptions',
    { filterByFormula: `IS_SAME({Date}, '${matchDate}')` }
  );

  // 5. Load squad selections for date
  const daySelections = await airtable.getRecords('Squad Selections', {
    filterByFormula: `IS_SAME({Match}.{Date}, '${matchDate}')`
  });

  // 6. Load match cards for season
  const matchCards = await airtable.getRecords('Match Cards', {
    filterByFormula: `{Match}.{Season} = '${season}'`,
    pageSize: 100
  });

  // Process each player
  const results = people.map(player => {
    return evaluateEligibility(
      player, 
      match, 
      teamMap, 
      availabilityExceptions, 
      daySelections, 
      matchCards
    );
  });

  return results;
}

function evaluateEligibility(
  player: Person,
  match: Match,
  teamMap: Map,
  availExceptions: any[],
  daySelections: any[],
  matchCards: any[]
) {
  // Step 1: Admin validation
  if (!player.Active || !player['Registered Team'] || !player['Playing Position'] || !player['Playing Ability']) {
    return {
      id: player.id,
      eligibilityStatus: 'blocked',
      reason: 'Admin data incomplete'
    };
  }

  // Step 2: Suspension
  if (player['Is Suspended'] || player['Matches To Serve'] > 0) {
    return {
      id: player.id,
      eligibilityStatus: 'blocked',
      reason: 'Suspended'
    };
  }

  // Step 3: Visiting player restrictions
  if (player['Is Visiting Player']) {
    if (player['Registered Team'] !== match.Team) {
      return {
        eligibilityStatus: 'blocked',
        reason: 'Visiting player — fixed to registered team'
      };
    }
    
    if (match['Competition Type'] !== 'League') {
      const leagueApps = matchCards.filter(mc =>
        mc.Player === player.id &&
        mc.Team === player['Registered Team'] &&
        mc.Match.Season === match.Season &&
        mc.Match['Competition Type'] === 'League'
      ).length;
      
      if (leagueApps < 5) {
        return {
          eligibilityStatus: 'blocked',
          reason: 'Visiting player — fewer than 5 appearances for registered team'
        };
      }
    }
  }

  // Step 4: Same-day movement (complex — see section below)
  const sameDayBlockReason = checkSameDayMovement(
    player, 
    match, 
    teamMap, 
    availExceptions, 
    daySelections
  );
  if (sameDayBlockReason) {
    return {
      eligibilityStatus: 'blocked',
      reason: sameDayBlockReason
    };
  }

  // Step 5: Premier restrictions
  const premierBlockReason = checkPremierRestriction(
    player, 
    match, 
    teamMap, 
    matchCards
  );
  if (premierBlockReason) {
    return {
      eligibilityStatus: 'blocked',
      reason: premierBlockReason
    };
  }

  // Step 6: Play-up rules
  const playUpBlockReason = checkPlayUpRules(
    player, 
    match, 
    teamMap, 
    matchCards
  );
  if (playUpBlockReason) {
    return {
      eligibilityStatus: 'blocked',
      reason: playUpBlockReason
    };
  }

  // Step 7: Cup eligibility
  const cupBlockReason = checkCupEligibility(
    player, 
    match, 
    matchCards
  );
  if (cupBlockReason) {
    return {
      eligibilityStatus: 'blocked',
      reason: cupBlockReason
    };
  }

  // Step 8: U21 double-game
  const u21BlockReason = checkU21DoublGame(
    player, 
    match, 
    daySelections
  );
  if (u21BlockReason) {
    return {
      eligibilityStatus: 'blocked',
      reason: u21BlockReason
    };
  }

  // Step 9: Warnings (only if not blocked)
  const warnings = [];
  
  const playUpCount = calculatePlayUpCount(player, match, matchCards);
  if (playUpCount === 2) {
    warnings.push('Second play-up appearance');
  } else if (playUpCount === 3) {
    warnings.push('Third play-up appearance');
  }

  // ... other warnings

  return {
    id: player.id,
    eligibilityStatus: warnings.length > 0 ? 'warning' : 'eligible',
    reason: warnings.length > 0 ? warnings[0] : null,
    availabilityStatus: getAvailabilityStatus(player, match, availExceptions),
    selectedByTeam: getSelectedByTeam(player, match, daySelections),
    playUpCount,
    isU21: player['U21 Eligible']
  };
}
```

---

### 4.3 Same-Day Movement Logic (Step 4 — Complex)

This is the most intricate rule. Detailed pseudo-code:

```typescript
function checkSameDayMovement(
  player: Person,
  targetMatch: Match,
  teamMap: Map,
  availExceptions: any[],
  daySelections: any[]
): string | null {
  
  const targetTeamRank = teamMap.get(targetMatch.Team)?.['Team Rank'];
  
  // Find all fixtures on the same calendar day
  const sameDayFixtures = getFixturesOnSameDay(targetMatch.Date);
  
  // For each fixture on the same day
  for (const fixture of sameDayFixtures) {
    const fixtureTeamRank = teamMap.get(fixture.Team)?.['Team Rank'];
    
    // Only check against HIGHER-ranked teams (lower Team Rank number)
    if (fixtureTeamRank < targetTeamRank) {
      
      // Is player available for this higher-ranked team?
      const hasUnavailableException = availExceptions.find(ex =>
        ex.Player === player.id &&
        ex.Match === fixture.id &&
        ex.Status === 'Unavailable'
      );
      
      if (!hasUnavailableException) {
        // Player is available for higher-ranked team
        return `Available for ${fixture.Team} on same day`;
      }
      
      // Is player already selected by this higher-ranked team?
      const isSelected = daySelections.find(sel =>
        sel.Player === player.id &&
        sel.Match === fixture.id &&
        sel.Status === 'Selected'
      );
      
      if (isSelected) {
        return `Selected for ${fixture.Team} on same day`;
      }
    }
  }
  
  // U21 exception: U21 players can play for registered team + higher team same day
  if (player['U21 Eligible']) {
    // U21 logic already checked in earlier steps; allow to proceed
    return null;
  }
  
  return null;
}
```

---

### 4.4 Play-Up Count Calculation

```typescript
function calculatePlayUpCount(
  player: Person,
  targetMatch: Match,
  matchCards: any[]
): number {
  
  const registeredTeamId = player['Registered Team'];
  const currentSeason = targetMatch.Season;
  
  // Count all play-up appearances
  const playUpCards = matchCards.filter(mc =>
    mc.Player === player.id &&
    mc.Team !== registeredTeamId &&
    mc['Play Up?'] === true &&
    mc.Match.Season === currentSeason &&
    mc.Goalkeeper === false // Exclude GK appearances
  );
  
  return playUpCards.length;
}
```

---

### 4.5 U21 Double-Game Logic

```typescript
function checkU21DoubleGame(
  player: Person,
  targetMatch: Match,
  daySelections: any[]
): string | null {
  
  if (!player['U21 Eligible']) {
    return null;
  }
  
  const registeredTeamId = player['Registered Team'];
  
  // Is target match for a different team (play-up)?
  if (targetMatch.Team === registeredTeamId) {
    // Playing for registered team; no double-game limit applies
    return null;
  }
  
  // Count U21 double-game players already selected for target team same day
  const targetTeamSelections = daySelections.filter(sel =>
    sel.Match.Team === targetMatch.Team &&
    sel.Match.Date === targetMatch.Date &&
    sel.Status === 'Selected'
  );
  
  const u21DoubleGameCount = targetTeamSelections.filter(sel => {
    const playerRecord = people.find(p => p.id === sel.Player);
    if (!playerRecord['U21 Eligible']) return false;
    
    // Is this U21 player also selected for their registered team same day?
    const registeredTeamSelection = daySelections.find(s =>
      s.Player === sel.Player &&
      s.Match.Team === playerRecord['Registered Team'] &&
      s.Match.Date === targetMatch.Date
    );
    
    return !!registeredTeamSelection;
  }).length;
  
  if (u21DoubleGameCount >= 3) {
    return 'U21 double-game limit reached';
  }
  
  return null;
}
```

---

### 4.6 Cup Eligibility Logic

```typescript
function checkCupEligibility(
  player: Person,
  targetMatch: Match,
  matchCards: any[]
): string | null {
  
  // Only applies to Cup/Plate/Bowl
  if (targetMatch['Competition Type'] === 'League') {
    return null;
  }
  
  // Check 1: Ever Registered To Premier ban
  if (player['Ever Registered To Premier']) {
    return 'Cup ban — ever registered to Premier Division';
  }
  
  // Check 2: Minimum league appearances
  const leagueApps = matchCards.filter(mc =>
    mc.Player === player.id &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match['Competition Type'] === 'League'
  ).length;
  
  if (leagueApps < 2) {
    return 'Fewer than 2 league appearances — ineligible for Cup';
  }
  
  // Check 3: Cross-cup restriction
  const cupAppsForOtherTeams = matchCards.filter(mc =>
    mc.Player === player.id &&
    mc.Team !== targetMatch.Team &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match['Competition Type'] !== 'League'
  ).length;
  
  if (cupAppsForOtherTeams > 0) {
    // Find the team
    const cupCardForOtherTeam = matchCards.find(mc =>
      mc.Player === player.id &&
      mc.Team !== targetMatch.Team &&
      mc.Match.Season === targetMatch.Season &&
      mc.Match['Competition Type'] !== 'League'
    );
    
    const otherTeamName = teamMap.get(cupCardForOtherTeam.Team)?.Name;
    return `Already played in a Cup for ${otherTeamName} this season`;
  }
  
  return null;
}
```

---

### 4.7 Final Response Object

```json
{
  "id": "person_12345",
  "eligibilityStatus": "eligible",
  "reason": null,
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 1,
  "isU21": false
}
```

**For a blocked player:**

```json
{
  "id": "person_12345",
  "eligibilityStatus": "blocked",
  "reason": "Available for HKFC A on same day",
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 2,
  "isU21": false
}
```

**For a warning player:**

```json
{
  "id": "person_12345",
  "eligibilityStatus": "warning",
  "reason": "Third play-up appearance",
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 3,
  "isU21": false
}
```

---

## 5. Performance Review

### 5.1 Assumptions

- **150–250 active players**
- **8 HKFC men's teams**
- **Full season match history** (Oct–Jun, ~30 weeks, ~3–4 fixtures per week per team = 240+ total matches, 1000+ match card records)
- **Concurrent users:** 8–12 coaches during peak times
- **Airtable API limits:** 5 req/sec sustained, 30 per 30 sec

---

### 5.2 Query Load Analysis

#### getPlayersForMatch Call Load

**Per-call Airtable requests:**
1. Load 1 Matches record — **1 request**
2. Load ~8 Teams records — **1 request**
3. Load ~200 People records (paginated, ~2 pages) — **2 requests**
4. Load ~50 Availability Exceptions (same-day) — **1 request**
5. Load ~100 Squad Selections (same-day) — **1 request**
6. Load ~1000 Match Cards (full season, paginated, ~10 pages) — **10 requests**

**Total: ~16 requests per call** (higher than Roadmap v2's estimate of 5, due to new eligibility fields)

**Peak Scenario:** 8 coaches, each opening a squad view 5 times during evening prep (1 hour).
- 8 × 5 = 40 calls
- 40 × 16 = 640 requests in 60 minutes = **~10.7 req/sec**

**Verdict:** Exceeds Airtable's 5 req/sec sustained limit. **Mitigation required.**

---

### 5.3 Mitigation Strategies

#### Strategy 1: Aggressive Caching (Recommended)

**What to cache:**
- Teams table: 8 records, rarely changes → cache 1 hour
- People table: 200 records, changes ~weekly → cache 4 hours (or event-driven invalidation)
- Match Cards for current season: 1000 records, append-only → cache 30 minutes, invalidate after each sync

**Implementation:** In-memory cache in Zite endpoint with TTL.

**Impact:** Reduces per-call requests to **~3–4** (only Availability, Squad Selections, target Match).

**Peak recomputation:** 40 × 4 = 160 requests in 60 minutes = **~2.7 req/sec** ✓ (within limits).

---

#### Strategy 2: Batch Request API

**If Zite supports Airtable batch requests:**  
Combine 2–3 logical requests into one batch call.

**Impact:** ~10–15% reduction in total requests.

---

#### Strategy 3: Database Denormalization

**Pre-compute and store:**
- Current season play-up counts per player
- Cup appearance status per player

**Trade-off:** Adds complexity to sync pipeline; reduces per-call computation.

**Not recommended for MVP** (adds maintenance burden).

---

#### Strategy 4: Read Replicas (if available)

Some platforms offer read-only replicas for heavy query workloads.

**Not applicable to Airtable** (no native replicas).

---

### 5.4 Formula Complexity

**Play-up count calculation:** ~1000 match cards filtered in memory → negligible CPU.  
**Same-day conflict check:** ~50 availability + 100 selections → negligible.  
**Cup eligibility:** ~10 cup cards filtered → negligible.

**Overall:** Computation is I/O-bound, not CPU-bound. Caching solves the bottleneck.

---

### 5.5 Timeline Risks

#### Risk 1: API Rate Limit During Peak

**Mitigation:** Implement caching (Strategy 1) before Phase 3 launch. Test with 8 concurrent users.

---

#### Risk 2: Match Cards Pagination

**Issue:** Loading 1000 Match Cards requires multiple paginated requests (100 per page = 10 requests).

**Mitigation:** Cache full season Match Cards in-memory. On each sync completion, invalidate the cache.

---

#### Risk 3: Availability Exception Load

**Issue:** If a large number of players mark Unavailable for a single match (e.g., injury cluster), loading all exceptions could spike.

**Mitigation:** Implement indexed query on Availability Exceptions table by Date. Airtable filters by formula efficiently.

---

### 5.6 Scaling Scenarios

#### Scenario 1: HKFC Expands to 12 Teams

- Match Cards: ~1500 records
- Teams: 12 (1 additional request if not cached)

**Impact:** Cache still solves bottleneck. No architectural change needed.

---

#### Scenario 2: Off-Season Historical Data Queries

If coaches query historical data (past seasons), match card load increases 2–3x.

**Mitigation:** Separate caching policy for historical data. Filter by Season at source.

---

### 5.7 Recommended Performance Optimizations

| Priority | Action | Effort | Timeline |
|----------|--------|--------|----------|
| **P0** | Implement in-memory caching for Teams, People, Match Cards | Medium | Before Phase 3 |
| **P1** | Add response time monitoring to `getPlayersForMatch` | Low | During Phase 3 |
| **P2** | Implement request queuing if rate limits hit | Medium | Post-MVP if needed |
| **P3** | Evaluate Airtable API batch requests | Low | Post-MVP optimization |

---

## 6. Testing Matrix

### 6.1 Test Coverage Strategy

**Total test scenarios:** ~80 (comprehensive)

**Test Organization:**
- Unit tests (formula logic, calculation functions)
- Integration tests (API endpoint behavior)
- Scenario tests (realistic workflows)

**Tools:**
- Jest (unit tests)
- Supertest (API tests)
- Test database seeding with representative data

---

### 6.2 Test Scenarios

#### Suite 1: Same-Day Movement Rules (8 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 1.1 | Player available for higher team, lower team selects | Player available for A, attempt select for C | **Block:** "Available for HKFC A on same day" |
| 1.2 | Player unavailable for higher team, lower team selects | Player unavailable for A (exception), attempt select for C | **Allow** (no conflict) |
| 1.3 | Player selected by higher team, lower team already selected | A selects player, then C already selected, then A selects | C selection auto-removed, A selection succeeds |
| 1.4 | Same-day with multiple higher teams | Available for both A and B, attempt select for C | **Block** with highest-ranked team name (A) |
| 1.5 | Multiple fixtures same day, no conflict | Available for C only, fixture is for B | **Allow** (no higher team available) |
| 1.6 | Time-of-day ignored | A fixture at 1 PM, C fixture at 5 PM, player available for A | **Block** (time irrelevant, same calendar day) |
| 1.7 | U21 exemption applied | U21 player, registered to C, available for A, A fixture same day | **Allow** (U21 same-day exemption) |
| 1.8 | U21 exemption with two higher teams | U21 player, both A and B higher-ranked, attempt A then B same day | First allowed (registered team + higher), second blocked if not registered team |

---

#### Suite 2: Play-Up Rules (10 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 2.1 | First play-up appearance | Player to higher team, 0 prior play-ups | **Allow**, no warning |
| 2.2 | Second play-up warning | Player to higher team, 1 prior play-up | **Allow**, warning: "Second play-up appearance" |
| 2.3 | Third play-up warning | Player to higher team, 2 prior play-ups | **Allow**, warning: "Third play-up appearance" |
| 2.4 | Fourth play-up blocked (re-registration) | Player to higher team, 3 prior qualifying play-ups | **Block:** "Play-up limit reached — re-registration required" |
| 2.5 | Higher-to-lower blocked | Player to lower team (higher-ranked) | **Block:** "Higher-to-lower movement requires Committee approval" |
| 2.6 | Goalkeeper exemption | GK to higher team as GK, 3 prior GK play-ups | **Allow** (GK play-ups don't count) |
| 2.7 | Goalkeeper field player not exempt | GK to higher team as field player, 3 prior field play-ups | **Block** (standard play-up limits apply) |
| 2.8 | Cup play-ups count toward quota | Cup match, higher team, 3 league play-ups + 1 cup play-up = 4 total | **Block** (cup counts toward quota) |
| 2.9 | Play-up count excludes GK appearances | Player with 3 league + 2 GK play-ups, 0 field play-ups | Play-up count = 3 (GK excluded) |
| 2.10 | Re-registration to highest team | 4 play-ups for A, 2 for B | Effective team = A (highest reached threshold) |

---

#### Suite 3: Goalkeeper Exemption (5 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 3.1 | GK exemption applies | GK registered to Division One, selecting as GK, higher team | **Allow**, no play-up count increment |
| 3.2 | GK exemption doesn't apply to A team GKs | GK registered to Premier/A, selecting as GK | No exemption (exemption for Division One or below only) |
| 3.3 | Multiple GK appearances | GK with 5 GK appearances for higher team, then 1 field appearance | Play-up count = 1 (only field appearance counts) |
| 3.4 | GK exemption doesn't apply to field play | GK playing as field player even if registered to lower team | Standard play-up limits apply |
| 3.5 | Match Card Goalkeeper flag controls exemption | Same player, one match marked GK=true, another GK=false | Appearance 1 (GK=true) excluded, Appearance 2 counted |

---

#### Suite 4: U21 Same-Day Exemption (7 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 4.1 | U21 plays registered team + higher team same day | U21 registered to C, available for A and C same day | **Allow** both (exemption applies) |
| 4.2 | U21 cannot play two higher teams same day | U21, attempt A then B (both higher-ranked) | First A allowed, second B blocked (only one higher team) |
| 4.3 | U21 cannot play two lower teams same day | U21, attempt C then D (both lower-ranked) | **Block** second (only registered + higher allowed) |
| 4.4 | U21 double-game count per team | 3 U21s selected for team A as double-game, 4th U21 selected | **Block:** "U21 double-game limit reached" |
| 4.5 | U21 double-game warning at limit-1 | 2 U21s selected as double-game for team, 3rd U21 selected | **Allow**, warning: "U21 double-game limit approaching" |
| 4.6 | U21 double-game counted correctly | U21 player selected for own team, then higher team same day | Counted as double-game (appears in 2 matches) |
| 4.7 | Non-U21 same-day exception does not apply | Non-U21, attempt registered + higher team same day | **Block** (only U21 exemption applies) |

---

#### Suite 5: Premier Division Restrictions (6 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 5.1 | Premier-to-lower blockade | Player to lower team, Premier has 2 matches, lower has 3 matches | **Block:** "Premier movement restriction — team has not completed 3 matches" |
| 5.2 | Lower-to-Premier blockade | Player to Premier team, lower has 2 matches, Premier has 3 matches | **Block:** "Premier movement restriction — team has not completed 3 matches" |
| 5.3 | Both teams completed 3 matches | Premier 4 matches, Lower 3 matches, player to lower | **Allow** |
| 5.4 | Blockade lifts after 3 matches | Premier 2 matches, Lower 2 matches → 3 matches each | Blockade lifts |
| 5.5 | Within-division movement unaffected | Player within lower division, teams both have <3 matches | **Allow** (Premier restriction only between divisions) |
| 5.6 | Applies at start of season | Both teams scheduled matches but 0 completed | **Block** (until 3 completed) |

---

#### Suite 6: Visiting Player Restrictions (7 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 6.1 | Visiting player fixed to registered team | Visiting player, attempt select for different team | **Block:** "Visiting player — fixed to registered team" |
| 6.2 | Visiting player can select own team | Visiting player, select for registered team | **Allow** |
| 6.3 | Visiting player cup eligibility (< 5 apps) | Visiting player, 4 league apps, attempt cup | **Block:** "Visiting player — fewer than 5 appearances for registered team" |
| 6.4 | Visiting player cup eligibility (>= 5 apps) | Visiting player, 5 league apps, attempt cup | **Allow** |
| 6.5 | Visiting player early-season warning | Visiting player, 2 appearances in first 3 matches | Warning: "Visiting player early-season requirement at risk" (if not on track for 3) |
| 6.6 | Visiting player count is league-only | Visiting player, 3 league + 2 cup apps, attempt cup at 4 total | Cup count = 3 (league only) |
| 6.7 | Non-visiting player unaffected | Regular player, 1 league app, attempt cup | **Block** (min 2 league) — but not the visiting player rule |

---

#### Suite 7: Cup Eligibility Rules (8 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 7.1 | Premier player cup ban | Ever Registered To Premier = true, attempt cup | **Block:** "Cup ban — ever registered to Premier Division" |
| 7.2 | Non-Premier player allowed | Ever Registered To Premier = false, 2 league apps, attempt cup | **Allow** |
| 7.3 | Minimum league appearances (< 2) | 1 league app, attempt cup | **Block:** "Fewer than 2 league appearances — ineligible for Cup" |
| 7.4 | Minimum league appearances (= 2) | 2 league apps, attempt cup | **Allow** |
| 7.5 | Cross-cup restriction | Played cup for Team A, attempt cup for Team B same season | **Block:** "Already played in a Cup for HKFC A this season" |
| 7.6 | Cross-cup, multiple cups | Played Bowl for A, attempt Plate for B same season | **Block** (applies across all cup types) |
| 7.7 | League match allowed despite cup history | Played cup for A, attempt league for B | **Allow** (restriction is cup-to-cup only) |
| 7.8 | Plate and Bowl treated as separate competitions | Played Cup for A, attempt Plate for B | **Block** (all cup types restricted) |

---

#### Suite 8: Re-Registration Logic (6 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 8.1 | Auto re-registration triggers at 4 play-ups | 3 play-ups for A, then select for A 4th time | Re-registered to A, unavailable for C |
| 8.2 | Effective team is highest reached | 4 for A, 2 for B | Effective team = A |
| 8.3 | Lowest team threshold | 4 for B, 1 for A | Effective team = B (only one team at threshold) |
| 8.4 | Re-registered player blocked from lower team | Re-registered to A, attempt C | **Block:** "Play-up limit reached — re-registration required" (implies unavailable for C) |
| 8.5 | Cup play-ups count toward re-registration | 3 league + 1 cup play-up = 4 total | Re-registration triggers |
| 8.6 | GK exemption doesn't affect re-registration | GK with 5 GK play-ups (excluded) + 0 field, attempt 4th field | Play-up count = 4 (first field appearance), no re-registration yet |

---

#### Suite 9: Suspension Logic (4 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 9.1 | Is Suspended flag blocks selection | Is Suspended = true | **Block:** "Suspended" |
| 9.2 | Matches To Serve blocks selection | Matches To Serve = 2 | **Block:** "Suspended" |
| 9.3 | Both flags respected | Is Suspended = true AND Matches To Serve > 0 | **Block:** "Suspended" |
| 9.4 | Zero Matches To Serve allows selection | Matches To Serve = 0, Is Suspended = false | **Allow** (no suspension) |

---

#### Suite 10: Admin Data Validation (5 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|-----------------|
| 10.1 | Missing Registered Team | Active = true, Registered Team = null | **Block:** "Admin data incomplete" |
| 10.2 | Missing Playing Position | Active = true, Playing Position = null | **Block:** "Admin data incomplete" |
| 10.3 | Missing Playing Ability | Active = true, Playing Ability = null | **Block:** "Admin data incomplete" |
| 10.4 | Inactive player hidden | Active = false | Player not returned in list |
| 10.5 | All data complete | All three fields populated | Player eligible for further checks |

---

#### Suite 11: Cross-Functional Scenarios (8 tests)

| # | Scenario | Input | Expected Result |
|---|----------|-------|---|
| 11.1 | Multiple blocks prioritized | Suspended + same-day conflict | **Block:** "Suspended" (Step 2 before Step 4) |
| 11.2 | Warning doesn't hide block | Play-up warning + cup ban | **Block:** "Cup ban — ever registered to Premier" (block takes precedence) |
| 11.3 | Visiting player + U21 | Visiting U21, available for A, attempt C same day | **Block:** "Visiting player — fixed to registered team" (Step 3 before Step 4) |
| 11.4 | GK exemption + re-registration | GK with 5 GK appearances (0 field counted), 4 field play-ups | Re-registered (field play-ups count) |
| 11.5 | Premier + cup ban | Premier registered ever, attempt cup after 3 matches | **Block:** "Cup ban — ever registered to Premier" (not "fewer 2 league") |
| 11.6 | U21 double-game + same-day conflict | U21 double-game limit reached, player also has same-day conflict | **Block** with most restrictive reason (order in Steps 1–8) |
| 11.7 | Re-registration + same-day conflict | Re-registered to A, attempt lower team B, but higher team C available same day | **Block:** "Available for HKFC C on same day" (Step 4 before Step 6) |
| 11.8 | Visiting + Cup + Play-up | Visiting with 5 apps, 2 league apps, 1 play-up, attempt cup for different team | **Block:** "Visiting player — fixed to registered team" (Step 3 before Step 7) |

---

### 6.3 Test Data Requirements

**Seed test database with:**

1. **People:** 50 test players with varied combinations:
   - Active/inactive
   - Complete/incomplete admin data
   - Suspended/unsuspended
   - Visiting/non-visiting
   - U21/non-U21
   - Registered to each of 8 teams

2. **Teams:** 8 teams with proper Team Rank (1–8), Is Premier flag, target squad sizes

3. **Matches:** 30 matches (past + future) with:
   - Mixed Competition Types (League, Cup, Plate, Bowl)
   - Multiple matches same day
   - Distributed across teams and ranks

4. **Match Cards:** 300 records with:
   - Varied Play Up? values
   - Varied Goalkeeper flags
   - Historical appearances for play-up testing

5. **Squad Selections:** 50 records for cross-team conflict scenarios

6. **Availability Exceptions:** 20 records for same-day logic testing

---

### 6.4 Test Execution Plan

| Phase | Tests | Timeline | Gating |
|-------|-------|----------|--------|
| **Phase 3a** | Suites 1, 2, 3, 4, 5 (Same-day, Play-up, GK, U21, Premier) | Week 1 | Must pass before Phase 3b |
| **Phase 3b** | Suites 6, 7, 8 (Visiting, Cup, Re-registration) | Week 2 | Must pass before Phase 3c |
| **Phase 3c** | Suites 9, 10, 11 (Suspension, Validation, Cross-functional) | Week 3 | Must pass before Phase 3 sign-off |

---

## 7. Implementation Recommendations

### 7.1 Must Implement Before Phase 3 Build

| # | Task | Effort | Owner | Timeline |
|----|------|--------|-------|----------|
| **1** | Add three new fields to People table (Is Suspended, Matches To Serve, Ever Registered To Premier) | Low | Data Admin | Before Phase 1 |
| **2** | Add Competition Type field to Matches table | Low | Data Admin | Before Phase 1 |
| **3** | Validate all active players have complete admin data (Registered Team, Playing Position, Playing Ability) | Low | Data Admin | Before Phase 1 |
| **4** | Verify all Teams have unique, sequential Team Rank values (1–8) | Low | Data Admin | Before Phase 1 |
| **5** | Implement in-memory caching strategy for Teams, People, Match Cards | Medium | Backend | Before Phase 3 |
| **6** | Design and document eligibility engine execution order (§4.1) | Low | Architecture | Before Phase 3 |
| **7** | Create test data seeding script (50 players, 8 teams, 30 matches, 300 match cards) | Medium | QA | Before Phase 3 |
| **8** | Build mock Airtable API for endpoint testing | Medium | Backend | Before Phase 3 |
| **9** | Implement `selectPlayer` server-side eligibility revalidation | High | Backend | During Phase 3 |
| **10** | Implement higher-team priority auto-deselection (§7.3) in `selectPlayer` | High | Backend | During Phase 3 |

---

### 7.2 Can Be Deferred to v1.1 (Post-MVP)

| # | Task | Rationale |
|----|------|-----------|
| **1** | Coach dashboard (player approaching play-up limits, suspensions, availability summary) | Visibility tool; coaches can use individual fixture views |
| **2** | Notification framework (in-app + email/SMS) | MVP uses simple view-refresh model; phase out after stability |
| **3** | Automatic suspension calculation from disciplinary cards | Manual entry works; future enhancement |
| **4** | Season rollover automation | Low-frequency task; admin handles in Airtable |
| **5** | Recommendation engine for squad shortfalls | Enhancement; coaches can select manually |
| **6** | Calendar and scheduling integration | Out of scope; third-party tools cover this |
| **7** | Make.com automations | Not needed for MVP; all logic in Zite |
| **8** | Advanced eligibility reporting (e.g., play-up usage by team) | Analytics tool; separate from core app |

---

### 7.3 Nice-to-Have Future Enhancements

| # | Feature | Value | Priority |
|----|---------|-------|----------|
| **1** | Real-time notification when higher team selects player | UX polish | P3 |
| **2** | Bulk player admin upload (CSV import) | Admin efficiency | P2 |
| **3** | Play-up usage analytics per player, team, season | Strategic planning | P2 |
| **4** | Eligibility audit log (why player marked ineligible, when) | Operational transparency | P3 |
| **5** | Player profile view with full match history | Coaching insight | P3 |
| **6** | Export squad selection to match card format | Admin convenience | P3 |
| **7** | Integration with HKHA API for automated suspension updates | Data accuracy | P1 (if API available) |

---

### 7.4 Implementation Sequencing for Phase 3

**Phase 3 is the critical path. Recommended breakdown:**

**Week 1: Engine Foundation**
- Build eligibility engine evaluation order (§4.1)
- Implement Steps 1–4 (Admin validation, Suspension, Visiting player, Same-day)
- Unit tests for each step
- **Deliverable:** `getPlayersForMatch` stub returning 50% complete eligibility

**Week 2: Advanced Rules**
- Implement Steps 5–8 (Premier, Play-up, Cup, U21, Warnings)
- Play-up count and re-registration logic
- Cup eligibility tracking
- Unit tests
- **Deliverable:** `getPlayersForMatch` complete with all eligibility checks

**Week 3: Server-Side Validation + Conflict Handling**
- Implement `selectPlayer` server-side revalidation
- Higher-team priority auto-deselection
- Auto-removal notification flow
- Integration tests
- **Deliverable:** Full `selectPlayer` implementation with conflict resolution

**Week 4: UI Integration + Testing**
- Squad Selection view with eligibility display
- Reason string labels and badges
- Same-day conflict visibility
- Cross-team selection status
- Cross-functional test suites (Suite 11)
- **Deliverable:** Phase 3 complete, ready for player availability (Phase 4)

---

### 7.5 Specification Clarifications Needed Before Build

Recommended clarifications to add to v1.1 of the specification:

| # | Section | Clarification | Rationale |
|----|---------|---------------|-----------|
| **1** | §13 | Define "qualifying play-up appearances" includes/excludes goalkeepers in re-registration context | Avoid implementation error |
| **2** | §13.2 | Clarify "lowest-ranked team" means highest Team Rank number | Terminology consistency |
| **3** | §6.3 | Specify "five league appearances" not five total appearances | Visiting player cup rule precision |
| **5 | §5 | Document suspension carryover process: manual re-flagging each season | Operational clarity |
| **6** | §14.2 | Cup appearance count resets per team, not cumulative across teams | Cup eligibility precision |
| **7** | §13 | Visiting players cannot be auto-re-registered | Prevent conflict with §6 |

---

## 8. Risk Assessment and Mitigation

### 8.1 High-Risk Items

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| **API Rate Limit Exceeded** | Medium | High | Implement caching (Strategy 1, §5.3) before launch |
| **Same-Day Logic Error** | Medium | High | Comprehensive test Suite 1 (8 scenarios); code review |
| **Play-Up Counting Error** | Medium | High | Validate against real HKFC data; audit trail in endpoint logs |
| **U21 Double-Game Misbehavior** | Low | Medium | Test Suite 4; isolated logic, testable in units |
| **Premier Restriction Ambiguity** | Low | Medium | Clear test cases (Suite 5); document before build |
| **Re-Registration Logic Complexity** | Medium | Medium | Separate unit tests; dry-run against historical data |

---

### 8.2 Specification Ambiguity Risks

| Ambiguity | Impact | Recommendation |
|-----------|--------|-----------------|
| "Qualifying play-up appearances" | Medium | Clarify before implementation (§7.5, item 1) |
| Visiting player re-registration | Medium | Add explicit rule: "Visiting players exempt from re-registration" (§7.5, item 7) |
| Cup appearance count | Low | Clarify "per team" not cumulative (§7.5, item 6) |
| Suspension carryover | Medium | Document manual process (§7.5, item 5) |

---

## 9. Sign-Off Checklist for Implementation

**Before Phase 3 starts:**

- [ ] Specification reviewed and approved by HKFC committee
- [ ] Three new People fields added to Airtable
- [ ] Competition Type field added to Matches table
- [ ] All active players data validated (complete Registered Team, Position, Ability)
- [ ] Team Rank validated (unique 1–8)
- [ ] Test data seed script created and populated
- [ ] Caching strategy designed and approved
- [ ] Eligibility engine pseudocode reviewed by stakeholders
- [ ] Risk mitigation plan approved

**Before Phase 3 sign-off:**

- [ ] All 80 test scenarios pass
- [ ] `getPlayersForMatch` response time <2s under load
- [ ] `selectPlayer` revalidation confirmed working
- [ ] Higher-team priority auto-deselection confirmed working
- [ ] Coach approval from 2+ test users
- [ ] No API rate-limit violations during load test

---

## Conclusion

The HKFC Eligibility & Selection Rules Specification v1.0 is **ready for implementation**. The specification is:

- **Clear:** Explicit evaluation order, standardized reason strings, well-defined rules
- **Implementable:** No contradictions with Airtable architecture or MVP Blueprint
- **Testable:** 80 comprehensive test scenarios cover all rule combinations
- **Performant:** With caching, achievable within Airtable API constraints

**Critical success factor:** Implement caching strategy and comprehensive same-day conflict tests in Phase 3. These are the highest-complexity, highest-risk items.

**Timeline:** Phase 3 (Squad Selection + Eligibility Engine) is a 4-week effort. Allocate 80–120 engineer hours.

---

**Analysis completed:** July 2026  
**Reviewer:** Lead Solution Architect, HKFC Squad Selection App  
**Status:** Ready for build planning
