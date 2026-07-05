# HKFC Eligibility & Selection Rules Specification v1.0

**Purpose:** Eligibility engine specification for the HKFC Squad Selection App.

**Source Documents:**

* HockeyHKMS Competition Bye-Laws (July 2024)
* HKFC Operational Rules and Committee Decisions
* HKFC Squad Selection MVP Blueprint
* Implementation Roadmap v2

---

# 1. Authority and Interpretation

This specification defines the rules used by the HKFC Squad Selection App when determining player eligibility.

## 1.1 Rule Hierarchy

Rules must be applied in the following order:

1. HKFC Operational Overrides documented in this specification
2. HKHA Competition Bye-Laws
3. Administrative data validation requirements

Where HKFC has adopted an operational interpretation or override, the application must follow this specification even where wording differs from the underlying bye-laws.

## 1.2 Core Design Principles

The application is designed around:

* Players are assumed available unless they indicate otherwise.
* Coaches manage exceptions rather than weekly confirmations.
* Eligibility checks occur before squad selection.
* Invalid selections are blocked proactively.
* All server-side endpoints revalidate eligibility before saving.
* Team hierarchy is determined solely by `Teams.Team Rank` where:

  * Rank 1 = highest HKFC team
  * Higher rank number = lower team

## 1.3 Season Definition

Current Season is determined by the `Matches.Season` formula.

Season boundary:

* Starts: 1 July
* Ends: 30 June

All play-up calculations, cup eligibility checks and movement restrictions reset at the start of a new season.

---

# 2. Player Data Requirements

## 2.1 Required People Fields

| Field                      | Type          |
| -------------------------- | ------------- |
| Active                     | Checkbox      |
| Registered Team            | Single Select |
| Playing Position           | Single Select |
| Playing Ability            | Single Select |
| Is Visiting Player         | Checkbox      |
| U21 Eligible               | Checkbox      |
| Is Suspended               | Checkbox      |
| Matches To Serve           | Number        |
| Ever Registered To Premier | Checkbox      |

Playing Position values:

* Goalkeeper
* Defender
* Midfielder
* Forward

Playing Ability values:

* A+
* A
* A-
* B+
* B
* B-
* C+
* C
* C-
* D+
* D
* D-
* E+
* E
* E-
* F+
* F
* F-
* G+
* G
* G-
* H+
* H
* H-

## 2.2 Data Validation

Active players missing any of:

* Registered Team
* Playing Position
* Playing Ability

must be blocked from selection.

Reason:

`Admin data incomplete`

These players should remain visible to coaches but clearly identified as requiring administrative correction.

## 2.3 Inactive Players

Players with:

`Active = false`

must not appear in squad selection screens.

---

# 3. Eligibility Status Model

Eligibility status is limited to:

```json
"eligible"
"warning"
"blocked"
```

Additional informational fields are independent of eligibility:

```json
availabilityStatus
selectedByTeam
sameDayHigherTeam
playUpCount
isU21
```

A player may therefore be:

* Eligible but unavailable
* Eligible but selected by another team
* Warning and selected elsewhere
* Blocked regardless of other statuses

---

# 4. Eligibility Evaluation Order

Rules must be evaluated in the following sequence.

## Step 1

Administrative Data Validation

## Step 2

Suspension Checks

## Step 3

Visiting Player Restrictions

## Step 4

Same-Day Team Movement Rules

## Step 5

Premier Division Restrictions

## Step 6

Play-Up Rules

## Step 7

Cup Eligibility Rules

## Step 8

Generate Warnings

Warnings are evaluated during the relevant rule checks and surfaced only when final eligibility status is not blocked.

---

# 5. Suspension Rules

Reference: Bye-Laws 16.3–16.10

A player is blocked when:

```text
Is Suspended = true
```

or

```text
Matches To Serve > 0
```

Reason:

`Suspended`

Suspensions are managed manually by administrators.

The system must not automatically calculate suspensions from cards.

Suspensions may carry forward into future seasons where required by HKHA rulings.

---

# 6. Visiting Players

Reference: Bye-Laws 6.1–6.6

## 6.1 Definition

Visiting Players are players without:

* Hong Kong Identity Card
* Recognizance (Form 8)

and are flagged:

```text
Is Visiting Player = true
```

## 6.2 Team Restriction

Visiting Players may only play for their registered team.

Any selection for another team is blocked.

Reason:

`Visiting player — fixed to registered team`

## 6.3 Cup Eligibility

Visiting Players require:

**Five appearances for their registered team**

before becoming eligible for any Cup, Plate or Bowl fixture.

Reason:

`Visiting player — fewer than 5 appearances for registered team`

## 6.4 Early Season Warning

Where a Visiting Player has appeared in consecutive early-season matches but remains below eligibility thresholds, show warning:

`Visiting player early-season requirement at risk`

---

# 7. Same-Day Movement Rules

Reference: Bye-Laws 7.1 and HKFC interpretation.

## 7.1 Standard Rule

Players may not represent more than one team on the same calendar day.

Exception:

U21 double-game rules.

## 7.2 Availability Lock

A lower-ranked team may not select a player if:

* Player is available for a higher-ranked team fixture on the same day

or

* Player has already been selected by a higher-ranked team on the same day

Reason:

`Available for [Team] on same day`

or

`Selected for [Team] on same day`

Availability means:

No Unavailable exception exists for the higher team's fixture.

Kick-off times are ignored.

The restriction applies to the entire calendar day.

## 7.3 Higher Team Priority

If:

* Lower team already selected player

and

* Higher team subsequently selects player

then:

* Higher team selection succeeds
* Lower team selection is automatically removed
* Notification is generated for affected lower-team coach

This reflects HKFC's hierarchy principle that higher teams take priority.

---

# 8. Premier Division Restrictions

Reference: Bye-Law 7.4

Movement between:

* Premier Division

and

* Lower divisions

is blocked until BOTH involved teams have completed at least three league matches.

Reason:

`Premier movement restriction — team has not completed 3 matches`

The rule applies regardless of movement direction.

---

# 9. Play-Up Rules

Reference: Bye-Laws 7.2–7.8

## 9.1 Higher to Lower

Players may not move from a higher-ranked team to a lower-ranked team.

Reason:

`Higher-to-lower movement requires Committee approval`

This is a hard block.

## 9.2 Lower to Higher

Players may move upward subject to play-up restrictions.

---

# 10. Play-Up Count Calculation

The application must calculate:

```text
Adjusted Play-Up Count
```

using:

Current season appearances where:

* Play Up? = true

excluding:

* Goalkeeper appearances qualifying under Section 11

Cup appearances count toward the same play-up quota as league appearances.

There is only one play-up count.

---

# 11. Goalkeeper Exemption

Reference: Bye-Law 7.5

## 11.1 Eligibility

Goalkeepers registered to Division One or below receive exemption from play-up limits when:

* Playing as goalkeeper

and

* Match Card Goalkeeper field = true

## 11.2 Excluded Appearances

The following appearances do NOT increase play-up count:

```text
Play Up? = true
AND
Goalkeeper = true
```

## 11.3 No Field Player Exemption

If the same player appears as a field player:

```text
Goalkeeper = false
```

standard play-up rules apply.

---

# 12. U21 Movement Rules

Reference: Bye-Law 7.6 and HKFC operational interpretation.

## 12.1 Same-Day Exception

U21 players may play:

* For their registered team

and

* For any higher-ranked team

on the same day.

This exemption does not permit:

* Two higher teams
* Two lower teams
* Two unrelated teams

## 12.2 Play-Up Limits

U21 players remain subject to standard play-up counting rules.

The U21 exemption applies only to same-day participation.

It does not create additional play-up allowances.

## 12.3 Team Limit

Maximum:

Three U21 double-game players

per team per day.

A double-game player is a U21 player appearing in a second match on the same day.

Warning:

`U21 double-game limit approaching`

Block:

`U21 double-game limit reached`

---

# 13. Re-Registration Logic

Reference: Bye-Law 7.2

## 13.1 Threshold

When a player records four qualifying play-up appearances above their registered team:

The player becomes unavailable for their registered team.

## 13.2 New Effective Team

The player's effective playing team becomes:

The lowest-ranked team for which they have accumulated four qualifying play-up appearances.

Example:

Registered Team:

HKFC C

Appearances:

* HKFC C = 8
* HKFC B = 1
* HKFC A = 3

Player becomes unavailable for HKFC C.

Eligible teams:

* HKFC B
* HKFC A

After a fourth qualifying appearance for HKFC A:

Eligible teams:

* HKFC A only

HKFC B becomes unavailable.

This reflects HKFC operational interpretation of automatic upward re-registration.

Reason:

`Play-up limit reached — re-registration required`

---

# 14. Cup Eligibility Rules

## 14.1 Premier Division Cup Ban

Reference: Bye-Law 7.7

Any player who has been registered to Premier Division at any point during the season is ineligible for:

* Cup
* Plate
* Bowl

Reason:

`Cup ban — ever registered to Premier Division`

---

## 14.2 Minimum League Appearances

Reference: Bye-Law 7.10

Player must have:

Two league appearances

before participating in Cup competitions.

Reason:

`Fewer than 2 league appearances — ineligible for Cup`

---

## 14.3 Cross-Cup Restriction

Reference: Bye-Law 7.9

After appearing in any Cup competition for a team, a player may not appear in Cup competitions for another team during the same season.

Applies across:

* Cup
* Plate
* Bowl

Reason:

`Already played in a Cup for [Team] this season`

---

## 14.4 Visiting Player Cup Rule

Visiting Player restrictions apply in addition to all Cup rules.

---

# 15. API Output Requirements

Each player returned by eligibility endpoints must include:

```json
{
  "eligibilityStatus": "eligible",
  "reason": null,
  "availabilityStatus": "available",
  "selectedByTeam": null,
  "playUpCount": 2,
  "isU21": false
}
```

Eligibility values:

```json
eligible
warning
blocked
```

Availability values:

```json
available
unavailable
```

---

# 16. Standard Reason Strings

## Blocked

```text
Admin data incomplete
Suspended
Visiting player — fixed to registered team
Visiting player — fewer than 5 appearances for registered team
Available for [Team] on same day
Selected for [Team] on same day
Higher-to-lower movement requires Committee approval
Premier movement restriction — team has not completed 3 matches
Play-up limit reached — re-registration required
Cup ban — ever registered to Premier Division
Already played in a Cup for [Team] this season
Fewer than 2 league appearances — ineligible for Cup
U21 double-game limit reached
```

## Warnings

```text
Second play-up appearance
Third play-up appearance
Visiting player early-season requirement at risk
U21 double-game limit approaching
```

Applications must use these exact strings.

---

# 17. Implementation Requirements

## getPlayersForMatch

Must:

1. Load target match
2. Load active players
3. Load availability exceptions
4. Load same-day selections
5. Load current-season match cards
6. Compute play-up counts
7. Apply eligibility rules
8. Return status and reason

## selectPlayer

Must:

1. Recalculate eligibility server-side
2. Reject blocked players
3. Apply higher-team priority rules
4. Remove conflicting lower-team selections where required
5. Generate coach notifications

Client-side validation alone is not sufficient.

---

# 18. Testing Priorities

Mandatory test coverage:

* Same-day higher-team priority
* U21 same-day exemption
* U21 double-game limits
* Goalkeeper exemption
* Premier movement restrictions
* Visiting player restrictions
* Cross-cup eligibility
* Cup appearance minimums
* Play-up counts
* Automatic re-registration logic
* Data validation failures
* Suspension enforcement

---

# 19. HKFC Operational Interpretations

The following interpretations are deliberate HKFC operational decisions:

| Area                      | HKFC Interpretation                                |
| ------------------------- | -------------------------------------------------- |
| Team hierarchy            | Determined by Team Rank                            |
| Higher-team conflicts     | Higher team always takes priority                  |
| Automatic re-registration | Lowest team where fourth play-up threshold reached |
| Goalkeeper exemption      | Only when actually playing as goalkeeper           |
| U21 same-day exemption    | Registered team + higher team only                 |
| Cup play-ups              | Count toward play-up quota                         |
| Availability lock         | No unavailable exception = available               |
| Coach conflict handling   | Automatic lower-team deselection with notification |

These interpretations must be treated as authoritative for application behaviour.
