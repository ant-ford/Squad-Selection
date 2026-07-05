# Phase 3 Development Checklist — HKFC Eligibility Engine

**Use this checklist during Phase 3 (Squad Selection + Eligibility Engine) implementation.**

---

## Pre-Build Setup (Week 0)

### Data Schema Validation

- [ ] Confirm three new fields exist on People table:
  - [ ] Is Suspended (checkbox, default: false)
  - [ ] Matches To Serve (number, default: 0, min: 0)
  - [ ] Ever Registered To Premier (checkbox, default: false)

- [ ] Confirm Competition Type field exists on Matches table:
  - [ ] Values: League, Cup, Plate, Bowl
  - [ ] All existing Matches have a value (no nulls)

- [ ] Validate all active players have complete admin data:
  - [ ] Registered Team (required)
  - [ ] Playing Position (required)
  - [ ] Playing Ability (required)

- [ ] Validate all teams in Teams table:
  - [ ] Have unique Team Rank values
  - [ ] Team Rank values are sequential (1, 2, 3, ..., N)
  - [ ] All active teams have Is Premier flag set

- [ ] Teams table cached in memory:
  - [ ] Load Teams once at endpoint startup
  - [ ] Create Map<string, Team> for O(1) lookups

### Test Infrastructure

- [ ] Create TestDataFactory with helper methods:
  - [ ] createPerson(overrides)
  - [ ] createMatch(overrides)
  - [ ] createMatchCard(overrides)
  - [ ] createSquadSelection(overrides)
  - [ ] createAvailabilityException(overrides)

- [ ] Create test database seeding:
  - [ ] 50 test players with varied combinations
  - [ ] 8 teams with proper Team Rank
  - [ ] 30 matches (League + Cup + Plate + Bowl)
  - [ ] 300 match cards with varied Play Up?/Goalkeeper flags

- [ ] Set up test execution framework:
  - [ ] Jest for unit tests
  - [ ] Test scenario runner for integration tests
  - [ ] Mock Airtable API responses

---

## Week 1: Engine Foundation (Steps 1–4)

### Step 1: Admin Data Validation

**Code:**
- [ ] `validateAdminData(person: Person): ValidationResult`
- [ ] Check: Active = true
- [ ] Check: Registered Team not null
- [ ] Check: Playing Position not null
- [ ] Check: Playing Ability not null
- [ ] Reason if any missing: "Admin data incomplete"

**Tests:**
- [ ] ✓ All fields present → eligible
- [ ] ✓ Missing Registered Team → blocked
- [ ] ✓ Missing Playing Position → blocked
- [ ] ✓ Missing Playing Ability → blocked
- [ ] ✓ Inactive player → not returned in list

---

### Step 2: Suspension Check

**Code:**
- [ ] `checkSuspension(person: Person): SuspensionResult`
- [ ] Check: Is Suspended = true → blocked
- [ ] Check: Matches To Serve > 0 → blocked
- [ ] Reason: "Suspended" (both cases)

**Tests:**
- [ ] ✓ Is Suspended = true → blocked
- [ ] ✓ Matches To Serve = 2 → blocked
- [ ] ✓ Both flags set → blocked with "Suspended"
- [ ] ✓ Neither flag set → not blocked

---

### Step 3: Visiting Player Restrictions

**Code:**
- [ ] `checkVisitingPlayerRestrictions(person, match, matchCards): VisitingPlayerResult`
- [ ] Check: Is Visiting Player = false → skip (not a visiting player)
- [ ] Check: Target match team ≠ Registered Team → blocked "Visiting player — fixed to registered team"
- [ ] Check (if Cup/Plate/Bowl): League appearances for registered team < 5 → blocked "Visiting player — fewer than 5 appearances for registered team"

**Tests:**
- [ ] ✓ Non-visiting player → not blocked
- [ ] ✓ Visiting player, different team → blocked
- [ ] ✓ Visiting player, own team, league match → allowed
- [ ] ✓ Visiting player, cup match, 4 league apps → blocked
- [ ] ✓ Visiting player, cup match, 5 league apps → allowed

---

### Step 4: Same-Day Movement Logic

**Code:**
- [ ] `checkSameDayMovement(person, match, teamMap, availExceptions, daySelections): SameDayResult`
- [ ] Get target match Team Rank
- [ ] Get all fixtures on same calendar day (same Date, different match)
- [ ] For each same-day fixture:
  - [ ] Get its Team Rank
  - [ ] Skip if not higher-ranked (lower Team Rank number)
  - [ ] Check: Does player have Unavailable exception for that fixture?
    - [ ] If NO → blocked "Available for [Team] on same day"
  - [ ] Check: Is player already selected by that fixture's team?
    - [ ] If YES → blocked "Selected for [Team] on same day"

**Special Logic:**
- [ ] U21 exception: If player U21 Eligible = true, allow registered team + one higher team same day
  - [ ] Implementation: Exception already embedded in above logic (if no conflict with either)

**Tests:**
- [ ] ✓ Higher team available, lower team selects → blocked with team name
- [ ] ✓ Higher team unavailable, lower team selects → allowed
- [ ] ✓ Higher team already selected, lower tries to select → blocked
- [ ] ✓ Multiple higher teams, show highest one in reason
- [ ] ✓ No same-day fixture → allowed
- [ ] ✓ Time of day ignored (same calendar day = same day)
- [ ] ✓ U21 exception: registered + higher team allowed same day
- [ ] ✓ U21 cannot play two higher teams same day

**Performance Check:**
- [ ] Response time < 500ms for same-day queries (50–100 records)

---

### Week 1 Deliverable

✅ `getPlayersForMatch` endpoint returns eligibility status with Steps 1–4 checks

```json
{
  "eligibilityStatus": "blocked",
  "reason": "Available for HKFC A on same day",
  "playUpCount": 1,
  "isU21": false
}
```

---

## Week 2: Advanced Rules (Steps 5–8)

### Step 5: Premier Division Restriction

**Code:**
- [ ] `checkPremierRestriction(person, match, teamMap, matchCards): PremierResult`
- [ ] Determine: Is movement between Premier and lower division?
  - [ ] targetTeam.IsPremier XOR personTeam.IsPremier
- [ ] If NO Premier movement → skip, return not blocked
- [ ] If YES Premier movement:
  - [ ] Count completed matches for target team this season
  - [ ] Count completed matches for person's registered team this season
  - [ ] If either count < 3 → blocked "Premier movement restriction — team has not completed 3 matches"

**Tests:**
- [ ] ✓ Premier to lower, Premier 2 matches → blocked
- [ ] ✓ Lower to Premier, lower 2 matches → blocked
- [ ] ✓ Both teams 3+ matches → allowed
- [ ] ✓ Within-division movement (no Premier involved) → allowed
- [ ] ✓ Blockade lifts after 3 matches each

---

### Step 6: Play-Up Rules & Count

**Code (Primary):**
- [ ] `calculatePlayUpCount(person, match, matchCards): number`
  - [ ] Filter Match Cards where:
    - [ ] Player = person.id
    - [ ] Team ≠ person.RegisteredTeam
    - [ ] PlayUp = true
    - [ ] Match.Season = currentSeason
    - [ ] **Goalkeeper = false** ← CRITICAL EXCLUSION
  - [ ] Return count

**Code (Blocking):**
- [ ] `checkPlayUpRules(person, match, teamMap, matchCards): PlayUpResult`
- [ ] Get target team rank and person's registered team rank
- [ ] Check: Is target team lower-ranked (higher number)?
  - [ ] If YES → blocked "Higher-to-lower movement requires Committee approval"
- [ ] Check: Is target team higher-ranked (lower number)?
  - [ ] If YES → calculate playUpCount
    - [ ] If playUpCount >= 4 → blocked "Play-up limit reached — re-registration required"
    - [ ] Else → not blocked (warnings will be handled in Step 9)

**Tests:**
- [ ] ✓ First play-up (0 prior) → allowed
- [ ] ✓ Fourth play-up attempt (3 prior) → blocked
- [ ] ✓ GK appearances excluded from count
- [ ] ✓ GK + field player mix: only field counted
- [ ] ✓ Cup play-ups count toward quota
- [ ] ✓ Higher-to-lower always blocked

---

### Step 7: Cup Eligibility

**Code:**
- [ ] `checkCupEligibility(person, match, matchCards): CupResult`
- [ ] If match.CompetitionType = 'League' → skip (not a cup), return not blocked
- [ ] Check 1: Ever Registered To Premier
  - [ ] If person.EverRegisteredToPremier = true → blocked "Cup ban — ever registered to Premier Division"
- [ ] Check 2: Minimum league appearances
  - [ ] Count match cards where:
    - [ ] Player = person.id
    - [ ] Season = match.Season
    - [ ] Match.CompetitionType = 'League'
  - [ ] If count < 2 → blocked "Fewer than 2 league appearances — ineligible for Cup"
- [ ] Check 3: Cross-cup restriction
  - [ ] Find match cards where:
    - [ ] Player = person.id
    - [ ] Team ≠ match.Team (different team)
    - [ ] Season = match.Season
    - [ ] Match.CompetitionType ≠ 'League' (cup/plate/bowl)
  - [ ] If found → blocked "Already played in a Cup for [Team] this season"

**Tests:**
- [ ] ✓ Premier player cup ban (EverRegisteredToPremier = true)
- [ ] ✓ Non-Premier allowed (if other checks pass)
- [ ] ✓ < 2 league appearances → blocked
- [ ] ✓ >= 2 league appearances → allowed (for this check)
- [ ] ✓ Cross-cup: Cup for A, attempt Cup for B → blocked
- [ ] ✓ Cross-cup: Bowl for A, attempt Plate for B → blocked (all cup types)
- [ ] ✓ League allowed despite cup history (different rule)
- [ ] ✓ Visiting player cup restriction layered on top

---

### Step 8: U21 Double-Game Limit

**Code:**
- [ ] `checkU21DoubleGameLimit(person, match, squadSelections): U21Result`
- [ ] If person.U21Eligible = false → skip, return not blocked
- [ ] If target match team = person.RegisteredTeam → skip (not a play-up), return not blocked
- [ ] Count U21 double-game players already selected for target team same day:
  - [ ] Filter squad selections where:
    - [ ] Match.Team = targetMatch.Team
    - [ ] Match.Date = targetMatch.Date
    - [ ] Status = 'Selected'
  - [ ] For each, count those where:
    - [ ] Player.U21Eligible = true
    - [ ] Player also has selection for their RegisteredTeam same day
  - [ ] If count >= 3 → blocked "U21 double-game limit reached"
  - [ ] If count = 2 → **not blocked, but warning** (Step 9)

**Tests:**
- [ ] ✓ Non-U21 not affected
- [ ] ✓ U21 playing own team not counted toward limit
- [ ] ✓ U21 double-game count 3 → blocked
- [ ] ✓ U21 double-game count 2 → warning (not blocked)
- [ ] ✓ U21 double-game counted correctly (must be in 2 matches same day)

---

### Step 9: Warning Generation

**Code (if not blocked):**
- [ ] `generateWarnings(person, match, matchCards): string[]`
- [ ] Play-up warnings:
  - [ ] If playUpCount = 2 → add "Second play-up appearance"
  - [ ] If playUpCount = 3 → add "Third play-up appearance"
- [ ] Visiting player early-season warning:
  - [ ] If person.IsVisitingPlayer = true AND early in season AND count < 3 → add "Visiting player early-season requirement at risk"
- [ ] U21 double-game warning:
  - [ ] If person.U21Eligible AND u21DoubleGameCount = 2 → add "U21 double-game limit approaching"

**Tests:**
- [ ] ✓ Play-up count = 2 → warning
- [ ] ✓ Play-up count = 3 → warning
- [ ] ✓ Play-up count = 4+ → blocked (not warning)
- [ ] ✓ Visiting player warning (if risk)
- [ ] ✓ U21 double-game warning (count = 2)

---

### Week 2 Deliverable

✅ `getPlayersForMatch` endpoint complete with all eligibility checks (Steps 1–9)

```json
{
  "eligibilityStatus": "warning",
  "reason": "Third play-up appearance",
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 3,
  "isU21": false
}
```

---

## Week 3: Server-Side Validation & Conflict Handling

### selectPlayer Implementation

**Pre-Selection Checks:**
- [ ] Validate request: matchId and playerId present
- [ ] Load match from Airtable
- [ ] Load player from Airtable
- [ ] Validate user is a coach for this match's team

**Eligibility Revalidation:**
- [ ] Call evaluateEligibility() with current data
- [ ] If eligibilityStatus = 'blocked':
  - [ ] Return error with exact reason string
  - [ ] Do NOT create Squad Selection record

**Higher-Team Priority Logic:**
- [ ] Query all Squad Selections for player on same calendar day
- [ ] For each selection, get the match's team and team rank
- [ ] If any selected team is lower-ranked (higher rank number) than target team:
  - [ ] Delete that lower-team selection record
  - [ ] Log auto-removal with timestamp and reason
  - [ ] Set AutoRemovedDueToHigherTeam = true on deleted record
  - [ ] Capture details for response

**Create Selection:**
- [ ] Create Squad Selection record:
  - [ ] Match = matchId
  - [ ] Player = playerId
  - [ ] Status = request.status (Selected or Reserve)
  - [ ] SelectedBy = userContext.userId
  - [ ] AutoRemovedDueToHigherTeam = false (only if this selection causes removal of others)

**Response:**
- [ ] Return success with new record ID
- [ ] Include autoRemovedLowerTeamSelection info if applicable

**Tests:**
- [ ] ✓ Blocked player selection rejected with reason
- [ ] ✓ Eligible player selection succeeds
- [ ] ✓ Higher team selects, lower team deselected automatically
- [ ] ✓ Lower team can still select (no higher team conflict)
- [ ] ✓ Multiple conflicts handled correctly

---

### Notification Flow (MVP Minimal)

- [ ] Add in-app notification mechanism:
  - [ ] Store removal reason in Squad Selection or audit log
  - [ ] Coach sees notification banner on next view refresh
  - [ ] No real-time notification (Phase 7 enhancement)

**Or Alternative MVP Approach:**
- [ ] Auto-removal is transparent to coach
- [ ] Coach manually refreshes squad view to see changes
- [ ] Minimal UX impact; full notifications in Phase 7

---

### Week 3 Deliverable

✅ `selectPlayer` endpoint with server-side validation and auto-removal logic

```json
{
  "success": true,
  "record": {
    "id": "sel_12346",
    "match": "match_abc",
    "player": "person_xyz",
    "status": "Selected"
  },
  "autoRemovedLowerTeamSelection": {
    "team": "HKFC C",
    "reason": "Higher-team priority: HKFC A selection overrides HKFC C"
  }
}
```

---

## Week 4: UI Integration & Testing

### Squad Selection View Implementation

**Player List Display:**
- [ ] Show all active players for the match
- [ ] Display eligibility status with color coding:
  - [ ] Green: eligible
  - [ ] Amber: warning
  - [ ] Red: blocked
- [ ] Display reason string as label/tooltip
- [ ] Disable selection controls for blocked players

**Contextual Information:**
- [ ] Show availability status (available/unavailable)
- [ ] Show play-up count
- [ ] Show U21 status
- [ ] Show current selection status (not selected / selected / reserve)

**Same-Day Conflict Visibility:**
- [ ] If player selected for another team same day, show:
  - [ ] Which team (team name)
  - [ ] Selection status (selected/reserve)
  - [ ] Link/navigation to that fixture

**Filtering:**
- [ ] Filter by position
- [ ] Filter by availability
- [ ] Filter by eligibility status

**Selection Controls:**
- [ ] Tap to select (creates record)
- [ ] Tap again to deselect (deletes record)
- [ ] Secondary action for Reserve status

---

### Test Suite Execution

**Must Pass Before Sign-Off:**

- [ ] **Suite 1 (Same-Day):** 8/8 tests pass
  - [ ] includes higher team priority, U21 exemption
  
- [ ] **Suite 2 (Play-Up):** 10/10 tests pass
  - [ ] includes GK exemption, re-registration logic
  
- [ ] **Suite 3 (GK Exemption):** 5/5 tests pass

- [ ] **Suite 4 (U21 Exemption):** 7/7 tests pass
  - [ ] includes double-game limits
  
- [ ] **Suite 5 (Premier Restriction):** 6/6 tests pass

- [ ] **Suite 6 (Visiting Players):** 7/7 tests pass

- [ ] **Suite 7 (Cup Eligibility):** 8/8 tests pass

- [ ] **Suite 8 (Re-Registration):** 6/6 tests pass

- [ ] **Suite 9 (Suspension):** 4/4 tests pass

- [ ] **Suite 10 (Admin Validation):** 5/5 tests pass

- [ ] **Suite 11 (Cross-Functional):** 8/8 tests pass (or 4/8 for MVP, complete in v1.1)

---

### Performance Testing

- [ ] Response time test:
  - [ ] `getPlayersForMatch` < 2 seconds (50 players, cached)
  - [ ] `selectPlayer` < 1 second
  
- [ ] Load test:
  - [ ] 8 concurrent coaches, 5 calls each/min for 10 minutes
  - [ ] No API rate limit hits (with caching)
  - [ ] No timeout errors

- [ ] API request profiling:
  - [ ] Verify cache is being used
  - [ ] Log total Airtable requests/call
  - [ ] Monitor API quota usage

---

### User Acceptance Testing

- [ ] 2+ coaches validate workflow for 1 week:
  - [ ] Create squads for multiple fixtures
  - [ ] Verify eligibility blocks work as expected
  - [ ] Verify reason strings are clear
  - [ ] Verify same-day conflicts handled correctly

- [ ] Admin validates player management:
  - [ ] Update suspension status → player blocked
  - [ ] Update Ever Registered To Premier → player cup-banned
  - [ ] Changes take effect immediately

---

### Week 4 Deliverable

✅ Phase 3 complete and signed off

**Checklist:**
- [ ] All 80 test scenarios pass (or 72/80 core + 8 deferred)
- [ ] Performance targets met
- [ ] User testing passed
- [ ] Code reviewed and merged
- [ ] Documentation updated
- [ ] Phase 4 ready to start

---

## Ongoing (During All Weeks)

### Code Quality

- [ ] TypeScript strict mode enabled
- [ ] No `any` types (use generics or union types)
- [ ] Functions have JSDoc comments
- [ ] Constants defined (not magic strings)
- [ ] Error handling for all Airtable queries

### Logging & Monitoring

- [ ] Log all eligibility rule evaluations (debug level)
- [ ] Log API request counts per `getPlayersForMatch` call
- [ ] Log response times
- [ ] Alert if response time > 3 seconds

### Version Control

- [ ] Branch: `feature/phase-3-eligibility-engine`
- [ ] Commit messages reference Spec § sections
- [ ] PR includes test results summary
- [ ] All tests passing before merge

### Documentation

- [ ] Code comments explain complex logic (same-day, re-registration)
- [ ] README updated with eligibility engine overview
- [ ] Troubleshooting guide for common eligibility issues
- [ ] API documentation updated

---

## Common Pitfalls (Watch Out!)

⚠️ **Off-by-One Errors:**
- Play-up count: >= 4 is blocked, < 4 is allowed
- U21 double-game: >= 3 is blocked, = 2 is warning
- League appearances: >= 2 is required for cup

⚠️ **Goalkeeper Logic:**
- GK exemption only applies if Goalkeeper = true AND player is actually a GK
- Must exclude GK appearances from play-up count
- But if same GK plays as field player, standard rules apply

⚠️ **Same-Day Timing:**
- Ignore kick-off times; entire calendar day is same-day
- Multiple fixtures same day are all potential conflicts

⚠️ **Cup Eligibility Layers:**
- Check Premier ban first (hard block)
- Then minimum league appearances
- Then cross-cup restriction
- All three must pass

⚠️ **Re-Registration Logic:**
- Only triggers at 4+ play-up appearances
- Effective team is highest one where threshold is met
- Player becomes unavailable for lower teams (implicit block)

⚠️ **Visiting Player Combination:**
- Fixed to registered team (hard block for other teams)
- Cup requires 5 league appearances
- Both restrictions apply, can't bypass one with the other

---

## Sign-Off Template

**Phase 3 Development Complete: [ ] Date**

**Test Results:**
- Suite 1–10: [ ] PASS
- Suite 11: [ ] PASS / [ ] 4/8 Deferred
- Performance: [ ] <2s getPlayersForMatch, <1s selectPlayer
- Load Test: [ ] PASS (no rate limit hits)

**User Testing:**
- Coach 1: [ ] PASS
- Coach 2: [ ] PASS
- Admin: [ ] PASS

**Code Quality:**
- [ ] TypeScript strict mode
- [ ] All tests passing
- [ ] Code review complete
- [ ] Documentation updated

**Ready for Phase 4:** [ ] YES / [ ] NO (explain)

**Signed Off By:** ________________________  Date: __________

---

**End of Developer Checklist**

Print this or keep in IDE. Check items off as completed.
