# Glossary

One place for the words the app uses: what each term means, and the variants to avoid. A later UI sweep makes the screens match it (see the sweep checklist at the end).

For: developers (Claude sessions) and the section's officers. Counts are rough and come from `src/`, `shared/`, `worker/src/`, `index.html` and `vite.config.ts` on 6 Oct 2026. They count user-visible strings, not comments. The owner confirmed the product name, the two home names, the Men's Convenor, the Chairman and the bulk-answer buttons on 6 Oct 2026.

## Writing rules

| Rule | Use | Avoid | Notes |
|---|---|---|---|
| Case | Sentence case for headings, buttons, tabs, menu items, field labels, toasts | Title Case ("Send Sign-In Email", "Coach Access Required", "Play-Up Opportunities", "Join Date") | Proper names keep their capitals: office titles (Membership Officer), named documents (Player Statement), HKFC, HKHA, months and days. |
| Product name | **Eddy** (owner, 6 Oct 2026). In prose: "Eddy"; where the club needs naming, "Eddy, HKFC men's hockey". | "HKFC Squad Selection", "HKFC Squad", "HKFC Men's Hockey Squad Management" | Today: "Eddy" (logo alt text, footer, emails, WhatsApp text, Join.tsx); "HKFC Squad Selection" (`index.html` title, Login title, loading screen, calendar PRODID, PWA `name`); "HKFC Squad" (header wordmark, PWA `short_name`); "HKFC Men's Hockey Squad Management" (footer). The PWA manifest is generated from `vite.config.ts` (there is no `public/manifest*`) and still says "HKFC Squad Selection", "HKFC Men's Hockey squad selection, availability and ranking". |
| Times | 24-hour: `14:30`. Use `formatHkTime()` (adds "HKT" when the device is outside Hong Kong) or `safeFormat(d, 'HH:mm')` | `h:mm a` ("2:30 PM"), "8pm" | Every screen is 24-hour now (checklist item 7 is done). The one exception is the volunteering option labels in `shared/volunteering.ts` ("4:30-6pm"): they are stored answers. |
| Dates | Through the helpers in `src/lib/dateUtils.ts`: `safeFormat(date, fmt)` (always Hong Kong time), `countdownLabel()` ("Today", "Tomorrow", "in 5 days"). Fixture dates: `FIXTURE_DATE` (`'EEE d MMM'`, "Sun 18 Oct", no year) and `<DateHeading>` in `src/components/shared/DateHeading.tsx` | Calling date-fns `format` directly; device-local time | "d MMM yyyy" (6 Oct 2026) is typed out at 21 sites in 15 files. There is no named constant for it yet; the sweep should add one beside `FIXTURE_DATE`. Worker side: `hkTime()` in `shared/umpiring.ts`; `formatWhen()`/`formatDay()` in `worker/src/calendar.ts` (en-GB, `hour12: false`). |
| Text size | At least 12 px on screen: `text-xs` | `text-[10px]`, `text-[11px]` | 126 uses in 41 files. The most are in PlayerRanking.tsx (16), membership/charts.tsx (12), CommitmentReview.tsx (11) and CalendarSheet.tsx (7). |
| Fixture title | "HKFC B vs Kai Tak A" | "v" | "vs" in 8 files; "v" only in Umpiring.tsx. |
| Not yet known | "TBC" | "TBD" | "TBC" in Umpiring.tsx; "TBD" in calendar.ts (Venue/Division). |
| Organisations | "HKHA" | "HockeyHK", "Hockey HK" | See [Club and league](#club-and-league). |

## App and screens

| Term | Meaning | Avoid | Where the variants are today |
|---|---|---|---|
| **Player view** | The player home, `/` (`PlayerDashboard.tsx`): My team, play-up and support fixtures, tasks, events. | "Player Dashboard", "My page", "your page", "player page" | "Player View" is the header button on 17 screens (CoachHeader.tsx plus 16 pages). "Go to Player Dashboard" in CoachLayout.tsx, EmailLists.tsx and MembershipBoard.tsx. "My page" in ManageEvents.tsx and CheckIn.tsx. "player page" in ManageEvents.tsx. "your page" in a PlayerDashboard.tsx toast. |
| **Coach view** | The coach home, `/coach` (`CoachDashboard.tsx`): the fixture list with team tabs. Ranking (`/coach/ranking`) is the other coach screen. | "Coach Dashboard", "Dashboard", "coach area" | "Coach View" is the button that opens it (PlayerDashboard.tsx). Inside the coach screens the same place is "Dashboard" (CoachHeader.tsx button and aria-label) and "Coach Dashboard" (CoachDashboard.tsx h1). |
| Umpire view | `/umpiring`, the umpiring duties. Its header button is for the club's umpires and the Umpire Coordinator. | "Umpiring page" | Already one name (UmpireViewButton.tsx). |
| My tasks | The forms someone still owes, shown at the top of Player view. | "Forms to complete" | Emails say "under My Tasks" (reviewEmails.ts, reviews.ts) and "your tasks" (joinerEmails.ts). The screen has no visible heading; its aria-label is "Forms to complete". |
| My details | The person's own details form (`/my-details`). | "Profile" | |
| Availability preferences | The sheet where a player sets standing rules (profile menu). | "Availability rules", "standing rules" | Already consistent in the UI. "Rules" is only the code name. |
| Help | The profile-menu link to the guides on eddy.global. | | |

## Signing in and out

| Term | Use | Avoid | Where the variants are today |
|---|---|---|---|
| Sign in | Getting in: an email, then a code or the link in it. The login screen says "Enter your email to sign in". | "Log in", "Login" (as a word on screen) | Login.tsx says "Sign In" and "Send Sign-In Email" (Title Case). "Please log in again" in apiClient.ts. |
| Log out | Leaving the app (profile menu). | "Sign out", "Logout" | The "Sign out" button in AccessNotActive.tsx. HeaderMenus.tsx and Apply.tsx already say "Log out". |
| Signed in | The state ("You're signed in as …"). | "Logged in" | Already consistent. |

## Availability

| Term | Meaning | Avoid | Where the variants are today |
|---|---|---|---|
| **Available**, **Maybe**, **No** | The three answers to a fixture. The stored value for "No" stays `Unavailable` (`AvailabilityStatus`); only the label changes. | "Unavailable", "Not available", "Out" on buttons, chips, filters and legends | "Unavailable" is shown in AttendanceGrid.tsx (legend), CoachAvailabilitySheet.tsx (option and two sentences), PlayerFilters.tsx (filter chip), PlayerRow.tsx (status chip), AvailabilityRulesSheet.tsx (rule chips), PlayerFixtureCard.tsx (preference line), SeasonStats.tsx and CommitmentReview.tsx (count labels). "Not available" in AvailabilityNoteSheet.tsx (title) and StatementSheet.tsx ("Not Available" count). PlayerFixtureCard.tsx, PlayerAvailabilitySheet.tsx and SameDayGamesPrompt.tsx already say "No". |
| Going | The label for Available once the player is selected (`availableLabel()`, `shared/availableLabel.ts`). The app and the calendar feed share it. | | The calendar feed marks a "No" as "(declined)". |
| Answer | What a player gave for one fixture (an availability exception). It always beats a preference. | "Response", "status" on screen | |
| Availability preference | A standing rule ("Play-ups", "Support games", "Midweek games", "Between dates", "All future fixtures") that gives the default for fixtures not answered one by one. | "Rule" on screen | `AvailabilityRule`, `shared/schema/domainTypes.ts` |
| Default | The default is Available for any fixture with no answer and no preference (opt-out). | | |
| Opt-in only | Set by a coach for one player. That player counts as No for any fixture they have not answered. | "Opt-In Only" | `People."Opt-In Only"`. CoachAvailabilitySheet.tsx already uses sentence case. |
| Note | The optional text added to a Maybe or No. | "Comment", "reason" | |
| Event answers | Special events use a different scale: **Going**, **Maybe**, **Not going** (`RESPONSE_LABEL`, `shared/events.ts`). | Using fixture words for events | |

## Teams and selection

| Term | Meaning | Avoid | Source |
|---|---|---|---|
| Team names | Full name: "HKFC A" … "HKFC H", as HKHA writes them and as stored in Teams. In chips and tight columns use `shortTeam()` ("C"). In prose: "the C team". | "Men's C", "C Team", "Team C" | `src/lib/format.ts`, `JOINER_TEAMS` in `shared/joiners.ts` |
| Registered team | The team HKHA has the player registered to (`People.Registered Team`). Every rule uses it: eligibility, play-up limits, suspensions, recommendations, re-registration. | | `shared/displayTeam.ts` |
| Selected team | The team the app shows for a player: Selected Team EOS, else SOS, else the registered team. It is for display only, and the Section Captain sets it. | Using it in any rule | `selectedDisplayTeam()` |
| My team | The Player view section with the player's selected-team fixtures and any fixture they are selected for. | | `fixtures.ts` category `own` |
| Play-up | Playing for a team above your registered team. A qualifying play-up is a match card with Play Up ticked, not as goalkeeper, this season, and not a friendly. The allowance is 3, or 8 for a U21 player (Bye-Law 7.2(b)). The appearance after the last one allowed re-registers the player to the higher team. | "Play up" (as a noun), "Play-Up" | `isQualifyingPlayUpCard()` in `worker/src/playUp.ts`; `shared/playUpAllowance.ts` |
| Support | A registered-team fixture shown to a player whose selected team is higher: they can drop back to support it. A "support game" in preferences means fixtures for teams below yours. | "Play down" | `worker/src/fixtures.ts` category `support` |
| Squad | The players a coach selects for one fixture (Selected Players Home/Away). Teams have a target squad size. | "Team sheet", "lineup" | |
| Selected | In the squad for a fixture. | "Picked" (on buttons) | |
| Fixture | One HKFC side's game on the fixture list: what players answer and coaches pick for. A derby (HKFC B vs HKFC C) is one match but two fixtures. | "Match" for anything you answer or select for | |
| Match | The league's record of a game (the Matches table): result, status, division, match card. | | |
| Game | Fine in casual player-facing text and in stats ("games played", "support games"). | | ClubStats.tsx, LuckTabs.tsx and PlayersTab.tsx use it a lot. |
| Match card | HKHA's record of who played in a match: shirt number, goals, cards, play-up, goalkeeper, U21, VP. It is the source of truth for appearances, play-ups and suspensions. | "Match Card" (mid-sentence), "team sheet" | `MatchCard`, `shared/schema/domainTypes.ts`. ClubStats.tsx says "Match Cards". |
| Friendly | Not a competitive fixture (Competition Type FRIENDLY, which includes warm-ups). It never counts towards any official total. | | `isFriendly()` |
| Suspension | Yellow-card points per season (Bye-Law 16.3). 5 points means 1 match out, 10 means 2, and 15 means 3 plus a referral. It is served by completed fixtures of the registered team. Red cards are set by hand (Is Suspended, Matches To Serve). | | `worker/src/suspension.ts` |
| Visiting player (VP) | A player here for a short time. Usually their stage is Temporary. | | `isVisitingPlayer`; the "VP" chip in PlayerRow.tsx |
| U21 | Under 21 on 1 September of the season (`People.U21 Eligible`). | | |

## Ranking and ability

| Term | Meaning | Avoid | Source |
|---|---|---|---|
| Ranking | The coaches' ordered list of every active player (`/coach/ranking`). | "Player Ranking" (Title Case) | PlayerRanking.tsx |
| Section rank | A player's place in the whole section, from 1 up. Coaches move it. | | `worker/src/ranking.ts` |
| Team rank (T#) | Place among players of the same selected team. It is derived, not set. | | `annotateWithDerivedRanks()` |
| Positional rank | Place among players of the same position. It is derived. | | |
| Ability | The playing ability grade, A+ to H−: an ability group (A–H) plus a sub-group (+, none, −), derived from section rank and the group sizes. | "Level", "grade" | `shared/abilityGroup.ts`, `shared/abilityRank.ts` |
| Ability groups | How many players each group holds, set on the ranking screen. | "Ability Group Configuration" | PlayerRanking.tsx |
| Position | Goalkeeper, Defender, Midfielder, Forward, Flexible/Varies. Short forms are GK, DEF, MID, FWD, FLEX (`POS_SHORT`). | "Playing position" on chips | `src/lib/format.ts` |

## Club and league

| Term | Meaning | Avoid | Where the variants are today |
|---|---|---|---|
| **HKHA** | Hong Kong Hockey Association, the league body. | "HockeyHK", "Hockey HK" | "HockeyHK" is on about 43 lines in 18 files. On screen: MyTasksBanner.tsx, JoinerEdit.tsx, JoinerTask.tsx, Registration.tsx. In emails and PDFs: joinerEmails.ts, u18Registration.ts, pdf/templates.ts. Exceptions (leave alone): the signed declaration wording in `shared/declarations.ts` (changing it needs a new `DECLARATIONS_VERSION`), the U18 form's own title, and the competition names `clubStats.ts` gets from the league ("HockeyHK Cup"). |
| HKHA registration | Registering a player with HKHA for a team this season. The Men's Convenor's screen is `/registration`. | "League registration" | JoinerEdit.tsx says "league registration". |
| Registered name | The name HKHA has on the player's registration. Match card names are matched against it. | "Registered Name" (mid-sentence) | `registered_name`. Registration.tsx already says "Registered name". |
| Section | HKFC's men's hockey section. | | |
| Season | 1 July to 30 June, written "2026–27". | | |

## Offices and roles

Office titles are proper names and keep their capitals.

| Title | Short | What it does in the app | Avoid | Source |
|---|---|---|---|---|
| Section Captain | | Coach rights on every team. Membership board, email lists, kit, season plans, trial sessions. Proposes new joiners. It comes from two places: the Teams.Section Captain link and the Section Captains office. | "Captain" alone | `worker/src/auth.ts`, `worker/src/data/officers.ts` |
| Coach | | Coach rights for the teams they are linked to (Teams.Coach). | | |
| Men's Convenor | | Registers players with HKHA; the only office that opens `/registration`. Gets the U18 forms. Mailbox mensconv@. | "Hockey Convenor" (on 29 lines today) | office key `hockeyConvenor` (the code name stays) |
| Membership Officer | MO | Signs last on applications (stage 6), approves, sends the application PDF. Completes commitment reviews. | "MO" on screen | `shared/membershipStages.ts` |
| Chairman | | Signs applications (stage 5). Email lists. | "Section Chair" (the offices table's title and a JoinerEdit.tsx label) | stage `5. Chairman (Signed)` |
| Assistant Director of Hockey | ADH | Coach rights on every team, Volunteers, trial sessions. | "Director of Hockey", "ADH" on screen | office `assistantDirector` |
| Umpire Coordinator | | Runs the umpiring duties and fills gaps. | "Umpiring Coordinator" | |
| Kit Convenor | | Kit orders, handing kit out, spares. | "Kit Manager" | |
| Social Secretary | | Any special event. A team's social secretary keeps only that team's events. | | `worker/src/eventAccess.ts` |
| Sponsor | | A member on the sponsors list who signs a new joiner's application (stage 4) and their commitment review. It grants no access. | | `worker/src/data/officers.ts` |
| Treasurer | | Gets event payment lists. | | PaymentsSection.tsx |

## Membership

| Term | Meaning | Avoid | Source |
|---|---|---|---|
| New joiner | Someone going through the membership process, from trial to acceptance. The process is "New Joiner" on the board. | "Registrant" | `shared/joiners.ts` |
| Applicant | A new joiner whose People Status is Applicant. "The applicant" is fine in officer screens. | | `audienceOf()`, `shared/profile.ts` |
| Membership stages | 1. Trial Application → 2. Section Captain Invitation → 3. Club Application (Signed) → 4. Sponsor (Signed) → 5. Chairman (Signed) → 6. Membership Officer (Signed) → Accepted. Off the pipeline: Rejected, Temporary (a player registered without the membership process, usually visiting). Anything else shows as "Needs fixing". Make moves stages 1–6; the app only moves 6 → Accepted. | Renaming the stages on screen (they are the stored values) | `shared/membershipStages.ts` |
| Type of application | Existing HKFC Member or New HKFC Member. | "Applicant Type" | ApplicantSheet.tsx |
| Member type | The club member's type: Main, Spouse, Child, Partner. | | `shared/profile.ts` |
| Membership category | Sports Preferred, Junior (21-27), Junior (under 21), Sports Debenture, Sports Subscriber. | "Category", "application category" | emailLists.ts ("Category"), joiners.ts ("application category") |
| Trial | Registering interest to join (stage 1). Trial sessions are before the season; practice trials are invitations from the Section Captains once it has started. | | `shared/trials.ts` |
| Commitment | The playing commitment a member signs up to for a period (Commitment End). "On commitment" means it has not ended yet. | | |
| Commitment review | The review at the end of a commitment: Not Started → Notified Member → Member Submitted → Sponsor Submitted → Complete. | "Statement review" | `shared/statementStages.ts` |
| Player Statement | The form and PDF the member, sponsor and MO fill in for a commitment review. | "Commitment Form" (the old Fillout name) | MyTasksBanner.tsx and StatementCard.tsx still say "Commitment Form". |
| Waivers & declarations | Each season's Code of Conduct and disclaimers, plus parent or guardian consent for under-18s. A signature records the version agreed to. | "Waivers & Declarations" | Waivers.tsx, MyTasksBanner.tsx |
| Volunteering | What a member offers to do each season (coaching, umpiring level and so on). | | `shared/volunteering.ts` |
| Season plan | A player's plan for the season (how much they will play). Its "Not available this season" option is a plan, not a fixture answer. | | `shared/seasonPlan.ts` |

## Umpiring

| Term | Meaning | Avoid | Source |
|---|---|---|---|
| Umpiring duty | A slot (1 or 2) HKHA gives an HKFC team to umpire, often in other clubs' games. Club umpires take duties in Umpire view. | "Umpire slot", "assignment" on screen | `shared/umpiring.ts` |
| Free / paid | Someone still on their commitment umpires free. After that they choose. Paid waits for the coordinator. | "Unpaid" | |
| Outside umpire | Someone from outside the club who covers a duty. | "External" on screen | |

## Sweep checklist

Each row is variant → term. File names are under `src/` unless shown otherwise.

1. **Availability labels.** "Unavailable" / "Not available" → "No" on every button, chip, filter, legend and count label: AttendanceGrid.tsx, CoachAvailabilitySheet.tsx, PlayerFilters.tsx, PlayerRow.tsx (render a label, not the raw `availabilityStatus`), AvailabilityRulesSheet.tsx, PlayerFixtureCard.tsx (preference line), AvailabilityNoteSheet.tsx (title), SeasonStats.tsx, pages/CommitmentReview.tsx, membership/StatementSheet.tsx. The stored value stays `Unavailable`. The bulk buttons for a day with several fixtures: "All going / All maybe / All out" → "All available / All maybe / All no" (PlayerDashboard.tsx).
2. **Player home.** "Player View" → "Player view" (CoachHeader.tsx and 16 pages). "Go to Player Dashboard" → "Go to Player view" (CoachLayout.tsx, EmailLists.tsx, MembershipBoard.tsx). "My page" → "Player view" (ManageEvents.tsx, CheckIn.tsx). "your player page" → "Player view" (ManageEvents.tsx). "your page" → "Player view" (PlayerDashboard.tsx toast).
3. **Coach home.** "Coach View" → "Coach view" (PlayerDashboard.tsx). "Dashboard" button and aria-label → "Coach view" (CoachHeader.tsx). The "Coach Dashboard" h1 → "Coach view", or remove it (CoachDashboard.tsx). "Umpire View" → "Umpire view" (UmpireViewButton.tsx).
4. **HKHA.** "HockeyHK" → "HKHA" in what the app shows and sends: MyTasksBanner.tsx, JoinerEdit.tsx, JoinerTask.tsx, Registration.tsx, `worker/src/joinerEmails.ts`, `worker/src/pdf/u18Registration.ts` (email subject, body, filename). Leave `shared/declarations.ts`, the U18 template title and the competition names in `shared/clubStats.ts` alone. "league registration" → "HKHA registration" (JoinerEdit.tsx).
5. **Sign in / log out.** "Sign In" → "Sign in" and "Send Sign-In Email" → "Send sign-in email" (pages/Login.tsx). "Sign out" → "Log out" (AccessNotActive.tsx). "Please log in again" → "Please sign in again" (lib/apiClient.ts).
6. **Sentence case.** "Play-Up Opportunities" → "Play-up opportunities", "Support Fixtures" → "Support fixtures", "My Team" → "My team" (PlayerDashboard.tsx, SameDayGamesPrompt.tsx). "Coach Access Required" (CoachLayout.tsx). "Auto-Select" and "Select All" (SquadSelection.tsx). "Player Ranking" and "Ability Group Configuration" → "Ability groups" (PlayerRanking.tsx). "Add Internet Calendar" and "Generate Calendar Link" (CalendarSheet.tsx). "Kit Size Distributions" (kit/KitInsights.tsx). "New Joiners" (membership/MembershipInsights.tsx). The field labels in membership/ApplicantSheet.tsx and membership/StatementSheet.tsx ("Join Date", "Commitment End", "Games Umpired" and so on). "Stage Updated At" (MembershipBoard.tsx). "Review Progress Updated At" (membership/StatementsBoard.tsx). "Shirt No" (Registration.tsx). "Hockey Rules quizzes" (HeaderMenus.tsx). "Waivers & Declarations" (Waivers.tsx, MyTasksBanner.tsx).
7. **Times.** (Done.) `h:mm a` → `HH:mm` (or `formatHkTime`): apply/trialSteps.tsx, events/EventSheet.tsx, events/eventText.ts, events/PaymentsSection.tsx, events/RegisterSection.tsx, MyTasksBanner.tsx, JoinerEdit.tsx (and the "8pm" placeholder), TrialSessions.tsx. **Check first:** the option labels in `shared/volunteering.ts` ("4:30-6pm") are stored answers, so changing them needs a data migration.
8. **Dates.** Add a named constant or helper for "d MMM yyyy" next to `FIXTURE_DATE`, and use it at the 21 inline sites: apply/trialSteps.tsx, events/PaymentsSection.tsx, membership/ApplicantSheet.tsx, membership/StatementCard.tsx, membership/StatementSheet.tsx, profile/steps.tsx, CommitmentReview.tsx, JoinerTask.tsx, Kit.tsx, MyDetails.tsx, MyVolunteering.tsx, Quizzes.tsx, SignApplication.tsx, Volunteers.tsx, Waivers.tsx.
9. **Text size.** `text-[10px]` / `text-[11px]` → `text-xs` (126 uses in 41 files). Start with PlayerRanking.tsx, membership/charts.tsx, CommitmentReview.tsx, CalendarSheet.tsx, AvailabilityRulesSheet.tsx, PlayerRow.tsx, PastFixtureCard.tsx, AttendanceGrid.tsx.
10. **Smaller fixes.** "v" → "vs" (Umpiring.tsx). "TBD" → "TBC" (`worker/src/calendar.ts`). "Commitment Form" → "Player Statement" (MyTasksBanner.tsx, membership/StatementCard.tsx). "Applicant Type" → "Type of application" (membership/ApplicantSheet.tsx). "Category" → "Membership category" (`shared/emailLists.ts`). Give My Tasks a visible name that matches the emails, or change the emails. "Match Cards" → "match cards" mid-sentence (ClubStats.tsx).
11. **Product name** → "Eddy": `index.html` title, the PWA `name`/`short_name`/`description` in `vite.config.ts`, pages/Login.tsx title, App.tsx loading screen, components/AppHeader.tsx wordmark and logo alt text, components/AppFooter.tsx, `worker/src/calendar.ts` PRODID, and the emails (most already say "Eddy").
12. **Men's Convenor.** "Hockey Convenor" → "Men's Convenor" in what the app shows and sends (29 lines): App.tsx, api/registration.ts, pages/JoinerEdit.tsx, JoinerTask.tsx, Registration.tsx, `shared/joiners.ts`, `shared/registration.ts`, and in `worker/src` auth.ts, data/officers.ts, declarations.ts, index.ts, joinerEmails.ts, joiners.ts, mailer.ts, myTasks.ts, pdf/u18Registration.ts, reference.ts, registration.ts, volunteerAccess.ts, volunteering.ts. Error messages and comments too; the office key `hockeyConvenor` and the offices table's stored title need a separate decision. "Section Chair" → "Chairman" on screen (JoinerEdit.tsx).
