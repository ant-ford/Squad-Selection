## HKHA (Hockey Hong Kong, China – Men's Section) Competition Bye-Laws Summary

**Key Rules Impacting Player Eligibility for Squad Selection (July 2024 version)**

This is a concise, developer-focused reference for the HKFC Squad Selection App. **These rules must be enforced as hard filters** before any player is presented in squad-building views. The primary function of the app is to respect **eligibility first** and proactively prevent invalid selections.

---

### 1. Visiting Players (Bye-laws 6.1–6.6)

- **Definition**: Player **without** a valid Hong Kong Identity Card or Recognizance (Form No. 8).
- **Club-Restricted (Hard Filter)**: Fixed to **one team** within the club; cannot move between teams (Bye-law 6.4).
- **Cup/Tournament Eligibility (Hard Filter)**: **Ineligible** for any Cup/Tournament until they have played a minimum of **5 League matches** for their registered team, AND the Committee has been informed (Bye-law 6.5).
- **Early Season Compliance (Warning)**: Must play **3 consecutive matches** in the first half of the season. *App action: Show a warning if this threshold is at risk.*

**App Implications:**
- **Hard Filter**: Prevent cup/tournament selection until `leagueMatchesPlayed >= 5`.
- **Hard Filter**: Prevent cross-team selection completely.

---

### 2. Player Movement / Play-Ups (Bye-laws 7.1–7.8)

#### 2.1 General Rules & Same-Day Priority
- **No Same-Day Conflict (Rule 7.1)**: No player (except U21) may play for more than one team on any single match day.
- **Higher Team Priority (Hard Filter)**: If a player is marked as "Available" for a higher-ranked team fixture on a given match day, the app **must block** them from being selected for any lower-ranked team fixture on that same day.
    - **Implementation**: The lockout applies to the **entire calendar day**, regardless of match kick-off times (e.g., if available for A team at 10 AM, they cannot be selected for B team at 4 PM). The app should check all fixtures scheduled for that date and prioritize the highest-ranked team.

#### 2.2 Designated Team Movement (Rule 7.2)
- **Higher → Lower (Hard Filter)**: Blocked completely without Committee approval.
- **Lower → Higher (Standard Players)**: Allowed for a **maximum of 3 League matches** per season. On the **4th League appearance**, they are automatically re-registered to the highest-ranked team they played for.

#### 2.3 Special Movement Exceptions

- **Premier Division Restriction (Rule 7.4) (Hard Filter)**: No player movement between the Premier team and lower-ranked teams until **both involved teams have completed their first 3 matches** of the season.

- **Goalkeeper Exemption (Rule 7.5) [INTENT-BASED INTERPRETATION]**: 
    - *Context:* Bye-law 7.5 is ambiguously drafted but its intent (preventing sandbagging) clearly points to allowing GKs flexibility to cover shortages by playing *up*. 
    - *HKFC Strategy:* Non-A-team goalkeepers are registered to the lowest-ranked team.
    - **App Implication (Hard Filter Override):** A goalkeeper registered to a team in Division One or below is **exempt from the 3-match play-up limit** (Rule 7.2b) when being selected to play **up** for a higher-ranked team as a goalkeeper. The app must **NOT** increment the play-up count for a GK playing up, and must **NOT** trigger auto-re-registration warnings for them. *(Note: If they play up but are selected as a field player, standard 7.2 rules apply).*

- **U21 Players (Rule 7.6) [CLUB OVERRIDE APPLIES]**: 
    - *Official Bye-law 7.6:* States U21s must play for their designated team, can only play for the **immediate next higher-ranked team**, and limits "double-game" U21s to 3 per team.
    - *HKFC Operational Override:* The club operates on the understanding that U21s can jump multiple ranks (e.g., D team to B team) and there is no enforced timing/sequence for when they play their designated team vs. their play-up team on the same day.
    - *Match Timing Context:* Because HKFC has multiple teams in the same division, fixture times can flip week-to-week (e.g., a higher-ranked team might play *before* a lower-ranked team). The app **must allow** a U21 to be selected for a higher-ranked team even if that match is scheduled *before* their designated team's match on the same day.
    - **App Implication:** 
        - Allow U21s to be selected for **any** higher-ranked team (ignore the "immediate next" restriction).
        - **Do not enforce match timing/sequence on the same day** (ignore chronological kick-off times).
        - **Retain Hard Filter (Rule 7.6(c))**: Still enforce the "maximum of 3 U21 players playing their second match of the day per team" limit.

---

### 3. Knockout/Cup Rules (Bye-laws 7.7–7.10)

- **Premier Player Ban (Rule 7.7) (Hard Filter)**: Any player registered for a Premier Division team at **any time** during the current season is **ineligible** for any HKHA Cup/Plate/Bowl match.
- **Play-Ups in Cups (Rule 7.8)**: A lower-ranked player may play for a higher-ranked team in a Cup, but this counts toward their 3-match play-up limit (Bye-law 7.2b) — *except for GKs utilizing the 7.5 exemption.*
- **Cross-Cup Movement (Rule 7.9) (Hard Filter)**: Once a player plays in a Cup competition for one team, they **cannot play** for any other team in *any* Cup competition without Committee approval.
- **League Match Requirement (Rule 7.10) (Hard Filter)**: Must have played **at least 2 League matches** for **any** HKFC team before playing in a Knockout Tournament.

---

### 4. Suspensions & Misconduct (Bye-laws 16.3–16.10)

- **Manual Process**: Suspensions are applied when officially notified by HKHA.
- **App Implication**: The app provides visibility of suspension status (`isSuspended: true` or `matchesToServe > 0`) as a **hard filter** to block selection.
- **Note**: The app does **not** automatically calculate or apply suspensions based on yellow/red cards. This is a manual data entry point managed by club administrators based on official HKHA notifications.

---

### Implementation Notes for Zite / App

- **Filter Hierarchy**: 
    1. Manual Suspension Status (from admin input)
    2. Visiting Player Status
    3. Same-Day Priority Conflicts
    4. Play-up Limits (excluding GKs moving up)
    5. Cup Rules

- **Source of Truth**:
    - **Player Data**: `hkha-sync` `People` table (`isVisitingPlayer`, U21 status, `everRegisteredToPremier`, Goalkeeper boolean).
    - **Team Hierarchy**: `hkha-sync` `Teams` table (`Team Rank`).
    - **Match Counts**: `Match Cards` table (Count League appearances, Cup appearances). **Crucial:** When tallying `Play Up?` appearances for the 3-match limit, explicitly exclude rows where the player's position was Goalkeeper.
    - **Suspension Data**: Admin-entered via app UI, not automatically calculated.

- **Warnings vs. Hard Blocks**:
    - *Hard Block*: Selecting a suspended player, selecting a field player for their 4th play-up, selecting a lower player when they are available for a higher team playing that day.
    - *Warning*: Approaching the 3-game play-up limit for field players.