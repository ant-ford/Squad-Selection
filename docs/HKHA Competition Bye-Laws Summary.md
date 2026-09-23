## HKHA (Hockey Hong Kong, China – Men's Section) Competition Bye-Laws Summary

**Key Rules Impacting Player Eligibility for Squad Selection (September 2026 version)**

This is a concise, developer-focused reference for the HKFC Squad Selection App. Source: `HockeyHKMS Competition Bye-Laws (Updated on 10 September 2026).pdf`. **These rules must be enforced as hard filters** before any player is presented in squad-building views. The primary function of the app is to respect **eligibility first** and proactively prevent invalid selections.

The [HKFC Eligibility & Selection Rules Specification](HKFC%20Eligibility%20%26%20Selection%20Rules%20Specification%20v1.0.md) is authoritative for app behaviour; this page summarises the bye-laws behind it.

---

### What changed from the July 2024 version

| Bye-law | Change | App impact |
| --- | --- | --- |
| 7.1 | The U21 same-day exemption is removed. Nobody, U21s included, plays for two teams on a match day. The old 7.6 (U21 second match, max 3 per team) is deleted. | U21 double-game block and warning removed. A higher team's pick now moves the player out of a same-day lower squad. |
| 7.2(b) | U21s may play up **8** league matches; the **9th** re-registers them. Everyone else is unchanged at 3 / 4th. | Play-up allowance is per player (`playUpAllowance` in `worker/src/playUp.ts`). |
| 5.1 | "Local Player" only with a valid HKID. No HKID at registration, including a receipt-only applicant, means "Non-Local", subject to the visiting-player rules and the 3-per-team cap. Reclassification counts from the Committee's approval date and is not backdated. | Data, not code: flag these players `Is Visiting Player`; clear the flag on the approval date. |
| New 7.3 | An injury-related request (lower-team registration, exemption from movement rules) needs a medical report from a registered practitioner within **one week** of the match, or it is automatically declined. | Process only. |
| Numbering | The visiting-player fixed-team clause is now part of 6.3 and the cup clause is 6.4. In Bye-law 7: 7.3 injury, 7.4 recording movements, 7.5 Premier first three matches, 7.6 goalkeeper exemption. The clause labels in the PDF's Bye-law 7 are misprinted; these numbers follow the content. | References updated. |

Everything else in the diff is wording, US spelling and page layout.

---

### 1. Visiting Players (Bye-laws 5.1, 6.1–6.6)

- **Definition**: Player **without** a valid Hong Kong Identity Card. Since September 2026 this is any **Non-Local Player** under 5.1: no valid HKID at registration, including someone holding only an application receipt.
- **Recognizance (Form 8)**: 6.1 still names it alongside the HKID, but 5.1 is the later rule and says only a valid HKID makes a player Local. **HKFC follows 5.1: a Form 8 holder is a visiting player.**
- **Club-Restricted (Hard Filter)**: Fixed to **one team** within the club; cannot move between teams (6.3).
- **Cup/Tournament Eligibility (Hard Filter)**: **Ineligible** for any Cup/Tournament until they have played a minimum of **5 matches** for their registered team, AND the Committee has been informed (6.4).
- **Early Season Compliance (Warning)**: Must play **3 consecutive matches** in the first half of the season (6.1). *App action: Show a warning if this threshold is at risk.*
- **Reclassification**: A Non-Local player who obtains an HKID may apply to be Local; it takes effect from the Committee's approval date only (5.1).

**App Implications:**
- **Hard Filter**: Prevent cup/tournament selection until the player has 5 appearances for the registered team.
- **Hard Filter**: Prevent cross-team selection completely.
- **Data**: `Is Visiting Player` is set by hand. It must include Non-Local players, and is cleared on the approval date, not when the HKID arrives.

---

### 2. Player Movement / Play-Ups (Bye-laws 7.1–7.11)

#### 2.1 One Match Per Day (Rule 7.1)
- **No Same-Day Conflict**: No player, **including U21s**, goalkeepers and listed substitutes, may play for more than one team on any single match day. There is no longer any U21 exception.
- **Higher Team Priority (HKFC)**: A lower-ranked team cannot select a player a higher-ranked team has already selected that day (`Selected for [Team] on same day`). If the lower team picked first, the higher team's pick wins: saving the higher squad removes the player from the lower one and tells the saving coach.
    - The lockout applies to the **entire calendar day**, regardless of kick-off times.
    - Mere **availability** for a higher team does not lock the player out of their own team (product decision 2026-09-03); it is a warning, `Available for [Team] on same day`.

#### 2.2 Designated Team Movement (Rule 7.2)
- **Higher → Lower (Hard Filter)**: Blocked completely without Committee approval.
- **Lower → Higher (Standard Players)**: Allowed for a **maximum of 3 League matches** per season. On the **4th**, they are automatically re-registered to the highest-ranked team they played for.
- **Lower → Higher (U21 Players)**: Allowed for a **maximum of 8 League matches** per season. On the **9th**, they are re-registered to that higher team and cannot play for a lower team without the Committee's prior written approval. U21s remain bound by 7.1: one match per day.

#### 2.3 Injury Requests (Rule 7.3)
- Special consideration on account of injury (registration in a lower team, exemption from movement rules) needs a medical report from a practitioner registered with the Hong Kong Medical Council (or an accepted foreign equivalent), submitted within **one week** of the match in which the player was injured. Late requests are automatically declined. Process only; not enforced by the app.

#### 2.4 Special Movement Exceptions

- **Premier Division Restriction (Rule 7.5) (Hard Filter)**: No player movement between the Premier team and lower-ranked teams until **both involved teams have completed their first 3 matches** of the season.

- **Goalkeeper Exemption (Rule 7.6) [INTENT-BASED INTERPRETATION]**:
    - *Context:* The bye-law is ambiguously drafted but its intent (preventing sandbagging) clearly points to allowing GKs flexibility to cover shortages by playing *up*.
    - *HKFC Strategy:* Non-A-team goalkeepers are registered to the lowest-ranked team.
    - **App Implication (Hard Filter Override):** A goalkeeper registered to a team in Division One or below is **exempt from the play-up limit** (Rule 7.2b) when being selected to play **up** for a higher-ranked team as a goalkeeper. The app must **NOT** increment the play-up count for a GK playing up. *(Note: If they play up but are selected as a field player, standard 7.2 rules apply.)*

---

### 3. Knockout/Cup Rules (Bye-laws 7.7–7.10)

- **Premier Player Ban (Rule 7.7) (Hard Filter)**: Any player registered for a Premier Division team at **any time** during the current season is **ineligible** for any HKHA Cup/Plate/Bowl match.
- **Play-Ups in Cups (Rule 7.8)**: A lower-ranked player may play for a higher-ranked team in a Cup, subject to 7.2(b): it counts toward their play-up allowance (3, or 8 for a U21), *except for GKs using the 7.6 exemption.*
- **Cross-Cup Movement (Rule 7.9) (Hard Filter)**: Once a player plays in a Cup competition for one team, they **cannot play** for any other team in *any* Cup competition without Committee approval.
- **League Match Requirement (Rule 7.10) (Hard Filter)**: Must have played **at least 2 League matches** for **any** HKFC team before playing in a Knockout Tournament.

---

### 4. Suspensions & Misconduct (Bye-laws 16.3–16.10)

- **Manual suspensions**: Applied by club administrators when officially notified by HKHA (`isSuspended: true` or `matchesToServe > 0`).
- **Automatic card suspensions**: Calculated from yellow-card penalty points (16.3) and red cards by `worker/src/suspension.ts`.
- **App Implication**: Either kind is a **hard filter** that blocks selection; neither clears the other.

---

### Implementation Notes

- **Filter Hierarchy** (see the spec, §4):
    1. Admin data
    2. Suspension
    3. Visiting Player Status
    4. Same-Day Conflicts
    5. Premier Division Restriction
    6. Play-up Limits (excluding GKs moving up)
    7. Cup Rules

- **Source of Truth**:
    - **Player Data**: `People` table (`Is Visiting Player`, `U21 Eligible`, `everRegisteredToPremier`).
    - **U21 status**: `People.U21 Eligible` formula: under 21 on 1 September of the season. The bye-laws do not state the reference date; HKFC follows the 1 September date that 5.3 uses for juniors.
    - **Team Hierarchy**: `Teams` table (`Team Rank`).
    - **Match Counts**: `Match Cards` table. **Crucial:** When tallying `Play Up?` appearances, exclude rows where `Match Cards.Goalkeeper` is true.

- **Warnings vs. Hard Blocks**:
    - *Hard Block*: Selecting a suspended player; selecting a player for another play-up once the re-registering one has been played (4 play-ups, or 9 for a U21); selecting a player a higher team has already picked that day.
    - *Warning*: The last two play-ups of the allowance (2nd and 3rd; 7th and 8th for a U21); availability for a same-day higher team.
