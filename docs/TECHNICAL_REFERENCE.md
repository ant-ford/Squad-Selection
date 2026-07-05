# HKFC Eligibility Engine — Technical Reference Guide

**Purpose:** Detailed code examples, data schemas, and implementation specifics for Phase 3 development.

---

## 1. Data Model Reference

### 1.1 People Table — Required Fields

```typescript
interface Person {
  id: string;
  
  // Identity & Status
  Active: boolean;
  PreferredName: string;
  Email: string;
  
  // Team Assignment (NEW/EXISTING)
  RegisteredTeam: string; // Link to Teams table — REQUIRED
  
  // Role & Ability (NEW/EXISTING)
  PlayingPosition: 'Goalkeeper' | 'Defender' | 'Midfielder' | 'Forward'; // REQUIRED
  PlayingAbility: 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'E+' | 'E' | 'E-' | 'F+' | 'F' | 'F-' | 'G+' | 'G' | 'G-' | 'H+' | 'H' | 'H-'; // REQUIRED
  
  // Eligibility Flags (NEW — Must Add in Phase 1)
  IsSuspended: boolean; // Default: false
  MatchesToServe: number; // Default: 0, >= 0
  EverRegisteredToPremier: boolean; // Default: false
  
  // Special Categories
  IsVisitingPlayer: boolean;
  U21Eligible: boolean;
  
  // Metadata
  CreatedTime: string;
  UpdatedTime: string;
}
```

**Airtable Field Configuration:**

| Field Name | Type | Required | Validation |
|------------|------|----------|-----------|
| Active | Checkbox | Yes | — |
| PreferredName | Single Line Text | Yes | — |
| Email | Email | Yes | — |
| RegisteredTeam | Single Select | Yes | Link to Teams.id |
| PlayingPosition | Single Select | Yes | Enum list (4 options) |
| PlayingAbility | Single Select | Yes | Enum list (24 options) |
| IsSuspended | Checkbox | No | Default: false |
| MatchesToServe | Number | No | Default: 0, Min: 0 |
| EverRegisteredToPremier | Checkbox | No | Default: false |
| IsVisitingPlayer | Checkbox | No | — |
| U21Eligible | Checkbox | No | — |

---

### 1.2 Teams Table — Required Fields

```typescript
interface Team {
  id: string;
  Name: string; // e.g., "HKFC A", "HKFC B"
  TeamRank: number; // 1 (highest) to 8 (lowest) — MUST BE UNIQUE
  IsPremier: boolean;
  Active: boolean;
  TargetSquadSize: number; // e.g., 14
  DivisionLevel: string; // e.g., "Premier", "Division 1", "Division 2"
}
```

**Validation Requirement:**
```sql
SELECT COUNT(DISTINCT TeamRank) FROM Teams WHERE Active = true
Must equal COUNT(*) of active teams.
```

---

### 1.3 Matches Table — Required Fields

```typescript
interface Match {
  id: string;
  Date: Date; // Calendar date
  Season: string; // Formula field: derived from Date (1 July boundary)
  
  // Match Details
  Team: string; // Link to Teams (home team)
  OpposingTeam: string; // Link to Teams (away team)
  Division: string; // e.g., "Premier", "Division 1"
  Venue: string;
  KickoffTime?: string; // HH:MM format
  
  // Match Type (NEW FIELD — CRITICAL)
  CompetitionType: 'League' | 'Cup' | 'Plate' | 'Bowl'; // REQUIRED for eligibility
  
  // HKHA Integration
  FixtureId?: string; // From HKHA MCList.asp
  SyncStatus: 'Pending' | 'Synced' | 'Complete';
  
  // Status
  Status: 'Scheduled' | 'Played' | 'Cancelled';
}
```

**Critical Requirement:**
Every Matches record must have CompetitionType populated. Missing values block cup eligibility checks.

---

### 1.4 Match Cards Table — Reference

```typescript
interface MatchCard {
  id: string;
  Match: string; // Link to Matches
  Player: string; // Link to People
  Team: string; // Link to Teams (which team's match it was)
  
  // Role & Status
  PlayerTeam: string; // Single Select: player's registered team
  PlayUp: boolean; // Formula field: Team != PlayerTeam
  Goalkeeper: boolean; // Was player marked as GK in this match?
  Jersey: number; // Jersey number (primary dedup key)
  
  // Stats
  Goals: number;
  YellowCards: number;
  RedCards: number;
  
  // Derived
  Season: string; // Inherited from Match.Season (formula)
}
```

**Key Insight:**  
The `PlayUp?` and `Goalkeeper` fields on Match Cards are the source of truth for play-up counting and GK exemption logic.

---

### 1.5 Squad Selections Table

```typescript
interface SquadSelection {
  id: string;
  Match: string; // Link to Matches
  Player: string; // Link to People
  
  // Selection Status
  Status: 'Selected' | 'Reserve' | 'Standby';
  SelectedBy: string; // Link to People (coach who selected)
  
  // Auto-Removal Tracking (NEW)
  AutoRemovedDueToHigherTeam?: boolean; // Flag if removed by higher-team priority
  AutoRemovedTimestamp?: Date;
  AutoRemovedByTeam?: string; // Which team's selection caused removal
  
  CreatedTime: Date;
}
```

---

### 1.6 Availability Exceptions Table

```typescript
interface AvailabilityException {
  id: string;
  Player: string; // Link to People
  Match: string; // Link to Matches
  Status: 'Unavailable' | 'Maybe';
  Note?: string; // Player's optional reason
  CreatedTime: Date;
}
```

---

## 2. API Response Schemas

### 2.1 getPlayersForMatch Response

```typescript
interface PlayerEligibilityResponse {
  // Core eligibility
  id: string;
  eligibilityStatus: 'eligible' | 'warning' | 'blocked';
  reason: string | null; // Reason string per §16 if not eligible
  
  // Contextual information (independent of eligibility)
  availabilityStatus: 'available' | 'unavailable';
  selectedByTeam: string | null; // Team record ID if selected, null otherwise
  playUpCount: number; // Current season play-up appearances
  isU21: boolean;
  
  // Additional useful fields for UI
  playerDetails: {
    id: string;
    preferredName: string;
    registeredTeam: string;
    position: string;
    ability: string;
    isSuspended: boolean;
    isVisitingPlayer: boolean;
  };
}
```

**Example Response — Eligible:**
```json
{
  "id": "person_abc123",
  "eligibilityStatus": "eligible",
  "reason": null,
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 1,
  "isU21": false,
  "playerDetails": {
    "id": "person_abc123",
    "preferredName": "John Smith",
    "registeredTeam": "team_c",
    "position": "Defender",
    "ability": "B+",
    "isSuspended": false,
    "isVisitingPlayer": false
  }
}
```

**Example Response — Blocked:**
```json
{
  "id": "person_xyz789",
  "eligibilityStatus": "blocked",
  "reason": "Available for HKFC A on same day",
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 2,
  "isU21": false,
  "playerDetails": { ... }
}
```

**Example Response — Warning:**
```json
{
  "id": "person_def456",
  "eligibilityStatus": "warning",
  "reason": "Third play-up appearance",
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 3,
  "isU21": false,
  "playerDetails": { ... }
}
```

---

### 2.2 selectPlayer Request/Response

**Request:**
```typescript
interface SelectPlayerRequest {
  matchId: string;
  playerId: string;
  status: 'Selected' | 'Reserve';
}
```

**Response — Success:**
```json
{
  "success": true,
  "record": {
    "id": "sel_12345",
    "match": "match_abc",
    "player": "person_xyz",
    "status": "Selected",
    "selectedBy": "coach_user_id"
  },
  "autoRemovedLowerTeamSelection": null
}
```

**Response — Success with Auto-Removal:**
```json
{
  "success": true,
  "record": {
    "id": "sel_12346",
    "match": "match_abc",
    "player": "person_xyz",
    "status": "Selected",
    "selectedBy": "coach_user_id"
  },
  "autoRemovedLowerTeamSelection": {
    "team": "HKFC C",
    "previousSelection": "sel_12344",
    "reason": "Higher-team priority: HKFC A selection overrides HKFC C"
  }
}
```

**Response — Blocked:**
```json
{
  "success": false,
  "error": {
    "code": "ELIGIBILITY_BLOCKED",
    "message": "Play-up limit reached — re-registration required",
    "playerId": "person_xyz",
    "matchId": "match_abc"
  }
}
```

---

## 3. Eligibility Engine — Implementation Guide

### 3.1 Step 1: Admin Data Validation

```typescript
function validateAdminData(person: Person): ValidationResult {
  const requiredFields = [
    { field: 'Active', value: person.Active },
    { field: 'RegisteredTeam', value: person.RegisteredTeam },
    { field: 'PlayingPosition', value: person.PlayingPosition },
    { field: 'PlayingAbility', value: person.PlayingAbility }
  ];

  for (const { field, value } of requiredFields) {
    if (!value) {
      return {
        isValid: false,
        reason: 'Admin data incomplete'
      };
    }
  }

  return { isValid: true };
}
```

---

### 3.2 Step 2: Suspension Check

```typescript
function checkSuspension(person: Person): SuspensionResult {
  if (person.IsSuspended === true) {
    return {
      isBlocked: true,
      reason: 'Suspended'
    };
  }

  if (person.MatchesToServe > 0) {
    return {
      isBlocked: true,
      reason: 'Suspended'
    };
  }

  return { isBlocked: false };
}
```

---

### 3.3 Step 3: Visiting Player Restrictions

```typescript
function checkVisitingPlayerRestrictions(
  person: Person,
  targetMatch: Match,
  matchCards: MatchCard[]
): VisitingPlayerResult {
  
  if (!person.IsVisitingPlayer) {
    return { isBlocked: false };
  }

  // Restriction 1: Fixed to registered team
  if (targetMatch.Team !== person.RegisteredTeam) {
    return {
      isBlocked: true,
      reason: 'Visiting player — fixed to registered team'
    };
  }

  // Restriction 2: Cup eligibility (5 league appearances)
  if (targetMatch.CompetitionType !== 'League') {
    const leagueAppearances = matchCards.filter(mc =>
      mc.Player === person.id &&
      mc.Team === person.RegisteredTeam &&
      mc.Match.Season === targetMatch.Season &&
      mc.Match.CompetitionType === 'League'
    ).length;

    if (leagueAppearances < 5) {
      return {
        isBlocked: true,
        reason: 'Visiting player — fewer than 5 appearances for registered team'
      };
    }
  }

  return { isBlocked: false };
}
```

---

### 3.4 Step 4: Same-Day Movement Logic

```typescript
function checkSameDayMovement(
  person: Person,
  targetMatch: Match,
  teamMap: Map<string, Team>,
  availabilityExceptions: AvailabilityException[],
  squadSelections: SquadSelection[],
  allMatches: Match[]
): SameDayResult {
  
  const targetTeamRank = teamMap.get(targetMatch.Team)?.TeamRank;
  const targetDate = targetMatch.Date;

  // Get all fixtures on the same calendar day
  const sameDayMatches = allMatches.filter(m =>
    m.Date === targetDate && m.id !== targetMatch.id
  );

  // Check against each same-day fixture
  for (const sameDayMatch of sameDayMatches) {
    const sameDayTeamRank = teamMap.get(sameDayMatch.Team)?.TeamRank;

    // Only check HIGHER-ranked teams (lower rank number)
    if (sameDayTeamRank >= targetTeamRank) {
      continue; // Not higher-ranked, skip
    }

    // Check if player is available for this higher-ranked team
    const hasUnavailableException = availabilityExceptions.some(ex =>
      ex.Player === person.id &&
      ex.Match === sameDayMatch.id &&
      ex.Status === 'Unavailable'
    );

    if (!hasUnavailableException) {
      // Player is available for higher-ranked team
      const higherTeamName = teamMap.get(sameDayMatch.Team).Name;
      return {
        isBlocked: true,
        reason: `Available for ${higherTeamName} on same day`
      };
    }

    // Check if player already selected by this higher-ranked team
    const isAlreadySelected = squadSelections.some(sel =>
      sel.Player === person.id &&
      sel.Match === sameDayMatch.id &&
      sel.Status === 'Selected'
    );

    if (isAlreadySelected) {
      const higherTeamName = teamMap.get(sameDayMatch.Team).Name;
      return {
        isBlocked: true,
        reason: `Selected for ${higherTeamName} on same day`
      };
    }
  }

  // U21 exception: Allow registered team + one higher team same day
  if (person.U21Eligible) {
    // Exception already built into above logic:
    // U21 can play for registered team and any higher team
    // (both are checked, both allowed if no conflict with BOTH available/selected)
    return { isBlocked: false };
  }

  return { isBlocked: false };
}
```

---

### 3.5 Step 5: Premier Division Restriction

```typescript
function checkPremierRestriction(
  person: Person,
  targetMatch: Match,
  teamMap: Map<string, Team>,
  matchCards: MatchCard[]
): PremierResult {
  
  const targetTeam = teamMap.get(targetMatch.Team);
  const playerRegisteredTeam = teamMap.get(person.RegisteredTeam);

  const isPremierMovement =
    (targetTeam.IsPremier && !playerRegisteredTeam.IsPremier) ||
    (!targetTeam.IsPremier && playerRegisteredTeam.IsPremier);

  if (!isPremierMovement) {
    return { isBlocked: false }; // No Premier movement
  }

  // Check if either team has < 3 completed matches
  const targetTeamMatches = matchCards.filter(mc =>
    mc.Team === targetMatch.Team &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match.Status === 'Played'
  ).length;

  const playerTeamMatches = matchCards.filter(mc =>
    mc.Team === person.RegisteredTeam &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match.Status === 'Played'
  ).length;

  if (targetTeamMatches < 3 || playerTeamMatches < 3) {
    return {
      isBlocked: true,
      reason: 'Premier movement restriction — team has not completed 3 matches'
    };
  }

  return { isBlocked: false };
}
```

---

### 3.6 Step 6: Play-Up Rules

```typescript
function checkPlayUpRules(
  person: Person,
  targetMatch: Match,
  teamMap: Map<string, Team>,
  matchCards: MatchCard[]
): PlayUpResult {
  
  const targetTeamRank = teamMap.get(targetMatch.Team)?.TeamRank;
  const playerTeamRank = teamMap.get(person.RegisteredTeam)?.TeamRank;

  // Rule 1: Higher-to-lower blocked
  if (targetTeamRank > playerTeamRank) {
    return {
      isBlocked: true,
      reason: 'Higher-to-lower movement requires Committee approval'
    };
  }

  // Rule 2: Lower-to-higher (play-up) limits
  if (targetTeamRank < playerTeamRank) {
    const playUpCount = calculatePlayUpCount(
      person,
      targetMatch,
      matchCards
    );

    if (playUpCount >= 4) {
      return {
        isBlocked: true,
        reason: 'Play-up limit reached — re-registration required'
      };
    }
  }

  return { isBlocked: false };
}

function calculatePlayUpCount(
  person: Person,
  targetMatch: Match,
  matchCards: MatchCard[]
): number {
  const registeredTeamId = person.RegisteredTeam;
  const currentSeason = targetMatch.Season;

  const playUpAppearances = matchCards.filter(mc =>
    mc.Player === person.id &&
    mc.Team !== registeredTeamId &&
    mc.PlayUp === true &&
    mc.Match.Season === currentSeason &&
    mc.Goalkeeper === false // CRITICAL: Exclude GK appearances
  );

  return playUpAppearances.length;
}
```

---

### 3.7 Step 7: Cup Eligibility

```typescript
function checkCupEligibility(
  person: Person,
  targetMatch: Match,
  matchCards: MatchCard[]
): CupResult {
  
  // Only applies to Cup/Plate/Bowl
  if (targetMatch.CompetitionType === 'League') {
    return { isBlocked: false };
  }

  // Rule 1: Premier player ban
  if (person.EverRegisteredToPremier) {
    return {
      isBlocked: true,
      reason: 'Cup ban — ever registered to Premier Division'
    };
  }

  // Rule 2: Minimum 2 league appearances
  const leagueAppearances = matchCards.filter(mc =>
    mc.Player === person.id &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match.CompetitionType === 'League'
  ).length;

  if (leagueAppearances < 2) {
    return {
      isBlocked: true,
      reason: 'Fewer than 2 league appearances — ineligible for Cup'
    };
  }

  // Rule 3: Cross-cup restriction
  const cupAppsForOtherTeams = matchCards.find(mc =>
    mc.Player === person.id &&
    mc.Team !== targetMatch.Team &&
    mc.Match.Season === targetMatch.Season &&
    mc.Match.CompetitionType !== 'League'
  );

  if (cupAppsForOtherTeams) {
    const otherTeamName = // Get team name from map
    return {
      isBlocked: true,
      reason: `Already played in a Cup for ${otherTeamName} this season`
    };
  }

  return { isBlocked: false };
}
```

---

### 3.8 Step 8: U21 Double-Game Limit

```typescript
function checkU21DoubleGameLimit(
  person: Person,
  targetMatch: Match,
  squadSelections: SquadSelection[]
): U21Result {
  
  if (!person.U21Eligible) {
    return { isBlocked: false };
  }

  // Only applies if playing for different team (play-up)
  if (targetMatch.Team === person.RegisteredTeam) {
    return { isBlocked: false };
  }

  // Count current U21 double-game players for target team on same day
  const targetTeamSelections = squadSelections.filter(sel =>
    sel.Match.Team === targetMatch.Team &&
    sel.Match.Date === targetMatch.Date &&
    sel.Status === 'Selected'
  );

  const u21DoubleGameCount = targetTeamSelections.filter(sel => {
    // Check if this selected player is U21
    if (!sel.Player.U21Eligible) return false;

    // Check if they're also selected for their registered team same day
    const hasRegisteredTeamSelection = squadSelections.some(s =>
      s.Player === sel.Player &&
      s.Match.Team === sel.Player.RegisteredTeam &&
      s.Match.Date === targetMatch.Date &&
      s.Status === 'Selected'
    );

    return hasRegisteredTeamSelection;
  }).length;

  if (u21DoubleGameCount >= 3) {
    return {
      isBlocked: true,
      reason: 'U21 double-game limit reached'
    };
  }

  return { isBlocked: false };
}
```

---

### 3.9 Step 9: Warning Generation

```typescript
function generateWarnings(
  person: Person,
  targetMatch: Match,
  matchCards: MatchCard[]
): string[] {
  
  const warnings: string[] = [];
  const playUpCount = calculatePlayUpCount(person, targetMatch, matchCards);

  // Play-up approach warnings
  if (playUpCount === 2) {
    warnings.push('Second play-up appearance');
  } else if (playUpCount === 3) {
    warnings.push('Third play-up appearance');
  }

  // Visiting player early-season warning
  if (person.IsVisitingPlayer) {
    const allAppearances = matchCards.filter(mc =>
      mc.Player === person.id &&
      mc.Team === person.RegisteredTeam &&
      mc.Match.Season === targetMatch.Season
    ).length;

    // If early season and not on track for 3, show warning
    // (Implementation depends on your definition of "early season")
    if (allAppearances < 3 && isEarlyInSeason(targetMatch)) {
      warnings.push('Visiting player early-season requirement at risk');
    }
  }

  // U21 double-game approaching
  const u21DoubleGameCount = calculateU21DoubleGameCount(person, targetMatch);
  if (u21DoubleGameCount === 2) {
    warnings.push('U21 double-game limit approaching');
  }

  return warnings;
}
```

---

## 4. selectPlayer Server-Side Validation

### 4.1 Implementation Outline

```typescript
async function selectPlayer(
  request: SelectPlayerRequest,
  userContext: CoachContext
): Promise<SelectPlayerResponse> {
  
  // Step 1: Validate request
  if (!request.matchId || !request.playerId) {
    throw new Error('Invalid request: matchId and playerId required');
  }

  // Step 2: Load match and player
  const match = await airtable.getRecord('Matches', request.matchId);
  const player = await airtable.getRecord('People', request.playerId);

  // Step 3: Validate user is coach for this match's team
  if (!userContext.coachesTeams.includes(match.Team)) {
    throw new Error('Unauthorized: You do not coach this team');
  }

  // Step 4: Re-run eligibility checks server-side (call getPlayersForMatch logic)
  const eligibility = await evaluateEligibility(player, match);

  if (eligibility.eligibilityStatus === 'blocked') {
    return {
      success: false,
      error: {
        code: 'ELIGIBILITY_BLOCKED',
        message: eligibility.reason,
        playerId: request.playerId,
        matchId: request.matchId
      }
    };
  }

  // Step 5: Check for same-day conflicts with higher-ranked teams
  const autoRemovalInfo = await checkAndRemoveLowerTeamConflicts(
    player,
    match
  );

  // Step 6: Create Squad Selection record
  const newSelection = await airtable.createRecord('Squad Selections', {
    Match: request.matchId,
    Player: request.playerId,
    Status: request.status,
    SelectedBy: userContext.userId,
    AutoRemovedDueToHigherTeam: false
  });

  // Step 7: Return response
  return {
    success: true,
    record: newSelection,
    autoRemovedLowerTeamSelection: autoRemovalInfo
  };
}
```

---

### 4.2 Auto-Removal Logic

```typescript
async function checkAndRemoveLowerTeamConflicts(
  player: Person,
  targetMatch: Match
): Promise<AutoRemovalInfo | null> {
  
  const targetTeamRank = teamMap.get(targetMatch.Team)?.TeamRank;
  const targetDate = targetMatch.Date;

  // Find all squad selections for this player on the same day
  const sameDaySelections = await airtable.getRecords(
    'Squad Selections',
    {
      filterByFormula: `AND(
        {Player} = '${player.id}',
        IS_SAME({Match.Date}, '${targetDate}'),
        {Status} = 'Selected'
      )`
    }
  );

  // Check each selection to see if it's for a lower-ranked team
  for (const selection of sameDaySelections) {
    const selectedMatch = await airtable.getRecord(
      'Matches',
      selection.Match
    );
    const selectedTeamRank = teamMap.get(selectedMatch.Team)?.TeamRank;

    if (selectedTeamRank > targetTeamRank) {
      // Lower-ranked team selected, must remove
      await airtable.deleteRecord('Squad Selections', selection.id);

      return {
        team: selectedMatch.Team,
        previousSelection: selection.id,
        reason: `Higher-team priority: ${targetMatch.Team} selection overrides ${selectedMatch.Team}`
      };
    }
  }

  return null;
}
```

---

## 5. Caching Strategy Implementation

### 5.1 In-Memory Cache Class

```typescript
class EligibilityCache {
  private teamCache: Map<string, Team> | null = null;
  private teamCacheExpiry: Date | null = null;
  
  private peopleCache: Map<string, Person> | null = null;
  private peopleCacheExpiry: Date | null = null;
  
  private matchCardsCache: Map<string, MatchCard> | null = null;
  private matchCardsCacheExpiry: Date | null = null;

  private TEAM_TTL_MS = 60 * 60 * 1000; // 1 hour
  private PEOPLE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours
  private MATCHCARDS_TTL_MS = 30 * 60 * 1000; // 30 minutes

  async getTeams(forceRefresh = false): Promise<Map<string, Team>> {
    if (
      !forceRefresh &&
      this.teamCache &&
      this.teamCacheExpiry &&
      new Date() < this.teamCacheExpiry
    ) {
      return this.teamCache;
    }

    const teams = await airtable.getRecords('Teams', {
      filterByFormula: '{Active} = true()'
    });

    this.teamCache = new Map(teams.map(t => [t.id, t]));
    this.teamCacheExpiry = new Date(
      Date.now() + this.TEAM_TTL_MS
    );

    return this.teamCache;
  }

  async getPeople(forceRefresh = false): Promise<Map<string, Person>> {
    if (
      !forceRefresh &&
      this.peopleCache &&
      this.peopleCacheExpiry &&
      new Date() < this.peopleCacheExpiry
    ) {
      return this.peopleCache;
    }

    const people = await airtable.getRecords('People', {
      filterByFormula: '{Active} = true()'
    });

    this.peopleCache = new Map(people.map(p => [p.id, p]));
    this.peopleCacheExpiry = new Date(
      Date.now() + this.PEOPLE_TTL_MS
    );

    return this.peopleCache;
  }

  async getMatchCards(season: string, forceRefresh = false): Promise<MatchCard[]> {
    if (
      !forceRefresh &&
      this.matchCardsCache &&
      this.matchCardsCacheExpiry &&
      new Date() < this.matchCardsCacheExpiry
    ) {
      return Array.from(this.matchCardsCache.values());
    }

    const matchCards = await airtable.getRecords('Match Cards', {
      filterByFormula: `{Match.Season} = '${season}'`,
      pageSize: 100
    });

    this.matchCardsCache = new Map(matchCards.map(mc => [mc.id, mc]));
    this.matchCardsCacheExpiry = new Date(
      Date.now() + this.MATCHCARDS_TTL_MS
    );

    return matchCards;
  }

  invalidateTeams(): void {
    this.teamCache = null;
    this.teamCacheExpiry = null;
  }

  invalidatePeople(): void {
    this.peopleCache = null;
    this.peopleCacheExpiry = null;
  }

  invalidateMatchCards(): void {
    this.matchCardsCache = null;
    this.matchCardsCacheExpiry = null;
  }
}
```

---

### 5.2 Usage in getPlayersForMatch

```typescript
const cache = new EligibilityCache();

async function getPlayersForMatch(matchId: string) {
  // Load uncached data
  const match = await airtable.getRecord('Matches', matchId);
  const availExceptions = await airtable.getRecords(
    'Availability Exceptions',
    { filterByFormula: `IS_SAME({Date}, '${match.Date}')` }
  );
  const daySelections = await airtable.getRecords(
    'Squad Selections',
    { filterByFormula: `IS_SAME({Match.Date}, '${match.Date}')` }
  );

  // Load cached data
  const teamMap = await cache.getTeams();
  const people = await cache.getPeople();
  const matchCards = await cache.getMatchCards(match.Season);

  // Evaluate eligibility
  const results = people.map(player =>
    evaluateEligibility(
      player,
      match,
      teamMap,
      availExceptions,
      daySelections,
      matchCards
    )
  );

  return results;
}
```

---

## 6. Testing Utilities

### 6.1 Test Data Factory

```typescript
class TestDataFactory {
  
  static createPerson(overrides?: Partial<Person>): Person {
    return {
      id: `person_${Math.random().toString(36).substr(2, 9)}`,
      Active: true,
      PreferredName: 'Test Player',
      Email: 'test@example.com',
      RegisteredTeam: 'team_c',
      PlayingPosition: 'Defender',
      PlayingAbility: 'B',
      IsSuspended: false,
      MatchesToServe: 0,
      EverRegisteredToPremier: false,
      IsVisitingPlayer: false,
      U21Eligible: false,
      ...overrides
    };
  }

  static createMatch(overrides?: Partial<Match>): Match {
    const date = new Date().toISOString().split('T')[0];
    return {
      id: `match_${Math.random().toString(36).substr(2, 9)}`,
      Date: date,
      Season: '2024-2025',
      Team: 'team_c',
      OpposingTeam: 'team_opp',
      Division: 'Division 1',
      Venue: 'Test Ground',
      CompetitionType: 'League',
      Status: 'Scheduled',
      ...overrides
    };
  }

  static createMatchCard(overrides?: Partial<MatchCard>): MatchCard {
    return {
      id: `card_${Math.random().toString(36).substr(2, 9)}`,
      Match: 'match_1',
      Player: 'person_1',
      Team: 'team_c',
      PlayerTeam: 'team_c',
      PlayUp: false,
      Goalkeeper: false,
      Jersey: 1,
      Goals: 0,
      YellowCards: 0,
      RedCards: 0,
      Season: '2024-2025',
      ...overrides
    };
  }
}
```

---

### 6.2 Test Scenario Runner

```typescript
interface TestScenario {
  name: string;
  person: Person;
  match: Match;
  matchCards: MatchCard[];
  availabilityExceptions: AvailabilityException[];
  squadSelections: SquadSelection[];
  expectedStatus: 'eligible' | 'warning' | 'blocked';
  expectedReason?: string;
}

async function runTestScenario(scenario: TestScenario): Promise<boolean> {
  const result = evaluateEligibility(
    scenario.person,
    scenario.match,
    teamMap, // from setup
    scenario.availabilityExceptions,
    scenario.squadSelections,
    scenario.matchCards
  );

  const statusMatch = result.eligibilityStatus === scenario.expectedStatus;
  const reasonMatch =
    !scenario.expectedReason ||
    result.reason === scenario.expectedReason;

  if (!statusMatch || !reasonMatch) {
    console.error(`FAIL: ${scenario.name}`);
    console.error(`Expected: ${scenario.expectedStatus} / ${scenario.expectedReason}`);
    console.error(`Got: ${result.eligibilityStatus} / ${result.reason}`);
    return false;
  }

  console.log(`PASS: ${scenario.name}`);
  return true;
}
```

---

## 7. Performance Optimization Checklist

- [ ] Implement EligibilityCache with TTL invalidation
- [ ] Add response time monitoring to getPlayersForMatch (target: <2s)
- [ ] Batch Availability Exceptions query by Date index
- [ ] Filter Match Cards by Season at source (not in memory)
- [ ] Cache Teams table in-memory (rarely changes)
- [ ] Implement request queuing if rate limits encountered
- [ ] Add Airtable API request logging for monitoring
- [ ] Use Airtable batch requests API (if available in Zite)

---

## 8. Specification Reference Quick Links

| Rule | Section | Implementation |
|------|---------|-----------------|
| Admin Data Validation | §2.2 | `validateAdminData()` |
| Suspension | §5 | `checkSuspension()` |
| Visiting Player | §6 | `checkVisitingPlayerRestrictions()` |
| Same-Day Movement | §7 | `checkSameDayMovement()` |
| Premier Restriction | §8 | `checkPremierRestriction()` |
| Play-Up Rules | §9-10 | `checkPlayUpRules()`, `calculatePlayUpCount()` |
| Goalkeeper Exemption | §11 | GK check in `calculatePlayUpCount()` |
| U21 Same-Day | §12 | `checkU21DoubleGameLimit()` |
| Re-Registration | §13 | Part of play-up logic |
| Cup Eligibility | §14 | `checkCupEligibility()` |
| Reason Strings | §16 | Use exact strings in implementations |

---

**End of Technical Reference**

This guide provides ready-to-implement code structures and data schemas. Use in conjunction with the main Implementation Analysis document.
