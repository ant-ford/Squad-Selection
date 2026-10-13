# Project context after chat cleanup

Consolidated 13 Oct 2026 from the local imported project conversations, the original project memory notes, repository documents and GitHub main `5f072071638e4ff859da8673a5b1f1e981a22270` (PR #329). This is a dated handover, not live deployment status. README and current code take precedence when they change. No production data or settings were changed during consolidation.

## Current state and superseded work

- Eddy is the HKFC men's hockey app: `app.eddy.global`, API `api.eddy.global`, repository `ant-ford/Squad-Selection`. Supabase replaced Airtable on 2 Oct 2026. There is no planned rollback to Airtable.
- The 6 Oct review was delivered across sessions 1–11. Subsequent GitHub main includes Team availability for active players and coaches, registered-name editing and missing-name tasks, Events admin meetings and date polls, and screen-download recovery. Do not restart the old review prompts as an unfinished backlog.
- Team availability is `/team-availability`, with old `/coach/availability` links redirected. It is read-only, includes all active teams, and excludes private notes. The earlier uncommitted `/availability` implementation is superseded by the released route and access rules.
- Production retention was switched to `remove` on 7 Oct 2026 after the owner agreed with the due list. It runs at 11:30 HKT, capped at 20 people. The first removal run was expected on 8 Oct; this review did not inspect its production outcome.
- Web Push is configured on in production and preview. Each device opts in through Profile → Notifications. The historical phone tests were still outstanding; no claim of successful end-to-end delivery is made here.
- Session 11's fixes (#309–#316) are merged: System menu, shared SystemView type, old suspension flag actions, person-page suspensions and links, phone header, taken-duty handling, WhatsApp links, TBC sorting, and no-show marks. The old flags support both Clear and Make a suspension, with audit records.
- GitHub main #329 restores screen-download recovery after ten minutes: at most two reload attempts per window. The old permanent per-tab recovery limit is superseded.
- Photo thumbnail backfill is complete according to the delivery records: 222 made, none failed, and a confirming dry run found all 222 present. Do not rerun it as an outstanding migration task.
- July rollover is implemented and documented in `SEASON_ROLLOVER.md`; the initial 2026–2027 seed prevents another apply before July 2027. Running it remains an owner action.

## Product decisions to preserve

### Availability, teams and selection

- Availability is opt-out: no exception means Available. Store an explicit Available only when it overrides Opt-In Only or a standing rule. Both always-store and always-delete were considered and rejected. Keep TypeScript and SQL resolution identical.
- The owner prefers compact fixture lists with small answer buttons inside each card. The large 44 px segmented control and repeated whole-day answer rows were reverted (#232). Goalkeepers retain the collapsed Set whole day link. Propose a fixture-density change with a screenshot before altering this decision.
- Weekly screens have short labels and almost no explanatory text. Express rules through available controls; put explanations in errors, guides and code comments.
- Team availability starts with all teams collapsed; expansions persist per tab. Keep Expand all / Collapse all. Names use first name plus surname, avoiding ambiguity. Counts use Selected Team (EOS, then SOS, then Registered), green at target squad size, amber at 11+, red below; match-card counts are small blue badges.
- Selection legality always uses the true registered team; displayed/selected teams are optics. Section Rank is the stored ranking; other ranks and ability are derived. Recommendations are advisory.
- Automatic re-registration resets play-up counting from the new registered team. The production catch-up was already performed; do not repeat historical catch-up SQL merely because an old chat mentions it.
- Only Section Captains activate/deactivate players. The September instruction to deactivate in Airtable was superseded after cutover. Coaches operate on their own teams; Section Captains and the Assistant Director have every-team coaching access.
- Season plans hide captaincy interest and show the full expected-availability answer, such as Most matches (50–90%) (#287).
- Keep fixture/result date groups prominent, results in home–away order, 24-hour times, and TBC games after timed games on the same day. Follow the glossary for labels and date formats.

### Umpiring

- The coordinator's workflow is weekly open-duty WhatsApp → replies/offers → outside umpires for gaps → final captain-group message → season reporting and commitment totals.
- An umpire still on commitment cannot be paid. Free or on-commitment offers get priority and auto-confirm; paid offers await the coordinator. Paid is a flag, not a fee amount.
- Own-game clashes use under 105 minutes at the same ground or under two hours at another ground; same-day TBC counts as a clash. An umpire can Take anyway.
- Outside names come from recent Eddy assignments plus unmatched HKFC match-card umpire names, deduplicated by canonical name. Preserve known spelling and Did you mean suggestions. The outside umpire's club field was explicitly dropped as clutter; do not reintroduce it without a request.
- WhatsApp coordinator messages are coordinator-only, not exposed merely by Section Captain access. Use `api.whatsapp.com/send`; the previous `wa.me` redirects corrupted symbols. No-show mark is `✗Name`.
- A duty can be Not needed for a walk-over while no umpire is confirmed; it remains visible but is excluded from totals. Taking a slot closes competing offers rather than keeping paid offers as reserves.

### Events

- Friendlies stay in fixtures. Events cover trials, social functions, team socials, tournaments, tours and now admin meetings; existing trial-session workflows were not to be moved wholesale into Events.
- Events must feel like a light addition. No waiting list or two-stage tour sign-up. QR attendance register replaced the earlier no-show-only approach; GPS check-in was rejected.
- Responses are opt-in, editable to the deadline. Event calendar entries use the subscribed feed, with Going/Maybe only. No separate event ICS download; no routine event emails. WhatsApp sharing is the normal notification helper.
- A member bringing guests or signing up other players pays for them. Guests include name, adult/child and dietary answers. No-shows are charged. Manager answers on another person's behalf do not make the manager their payer.
- Payment modes include free, pay on the night, PayMe/FPS proof, membership-account charging, and self-funded with no bills. An optional HTTPS link can join an event WhatsApp group. There is no separate treasurer role.
- Admin-meeting defaults are editable and based on active offices/current team links, not active-player status. They do not count as commitment social functions.
- Find a date offers two to six options. Options freeze after publication; choosing a future option preserves replies and carries Available into Going atomically. Proposed dates do not enter calendars or billing. Refer to current Events code and tests rather than the original brainstorm.

### Membership, PDFs, privacy and communications

- Officers sign in using their personal People email; office access comes from linked active offices. Officers receive mail at `offices.office_email` first, with personal email as fallback. Office-originated mail uses the office mailbox where the configured sender permits it.
- Membership stages advance through their workflows. The Membership Officer performs final acceptance on club confirmation. Existing HKFC members do not apply for club membership again: they submit the levy form, sent to the front desk.
- PDFs are made and retained first, then checked and sent from the application screen. New applications go to the club Membership Department; existing-member levy forms go to the front desk. Sending the latter also accepts the member. U18 registration goes to the Men's Convenor for onward delivery to HKHA; Player Statements go to Membership.
- Office-use PDF fields, including TP No. and Interview month, stay blank. Keep the club's prefilled direct-debit limit. Draw signatures within field rectangles. Chinese font glyph padding and the SAM scan conversion are documented in the private PDF notes; do not replace templates blindly.
- Sign-in emails deliberately contain no clickable magic link: corporate mail scanners burn the single-use token. Keep `docs/supabase-magic-link-email.html` as the recoverable template. A code-first subject was proposed, but the chats do not confirm it was applied; verify the live setting before claiming it is done.
- The stale-phone sign-in incident involved a cached pre-migration Auth endpoint. Incognito/new-browser checks and clearing the installed app's stale site data were the diagnostic path. This does not establish that every Failed to fetch is a cache problem.
- Personal details are removed 13 months after last activity, subject to the documented protections. Names remain in historical results. `hkid_hidden` is owner-set and suppresses ID questions/uploads without erasing the stored identity data.
- Public screenshots, fixtures and PR bodies use fictional data only. This repository is public: do not add player histories, identity documents, blank private application templates, credentials, real-data screenshots or licensed font files.
- Stats expose disciplinary cards only to the player's own career view. Lucky charms are positive only; comparisons use minimum sample sizes and appropriate same-season games. Bump the summary version when aliases or response shapes change.
- Captain messages should be concise and respectful, without joking emojis. Ask squads to answer in Eddy through fixture links rather than transposing WhatsApp poll answers. Notify should remain usable with an empty squad so availability can be collected before selection.
- Keep the office named Men's Convenor in the app and normal prose; Sports Convenor guide is the guide title. Historical guide-renaming messages conflict: the final owner decision above takes precedence.
- On-screen Eddy is the outlined Fairwater Script wordmark. Plain text is retained for device-rendered titles, accessibility, email, push, calendar, PDF/CSV and WhatsApp. Never commit the licensed font.

## Remaining checks and owner decisions

These were recorded as outstanding; they were not verified on production during this handover.

1. After 20 Oct 2026, review dropping the Airtable `archive` schema with owner approval. Review obsolete Airtable webhook, Cloudflare webhook secret, tokens, preview/GitHub and hkha-sync secrets, and the Apps Script key. The runtime and hkha-sync Airtable code were removed; account/integration cleanup is a separate owner task. Preserve the migration mapping and cutover record as needed.
2. Verify the first and recent retention removal runs through System/production records. Removal is already configured; do not switch it on again as unfinished work.
3. Test push on a real phone, including opt-in, kit receipt, squad delivery from another sender, and opening the installed app after time away. Zero delivered alerts can mean no opted-in device; the sender is excluded from squad alerts. Measure CPU/subrequest use under a realistic Notify load. HKHA-driven duty moves still lacked a push hook in the session notes; check current code before implementing.
4. Tap an umpiring WhatsApp link on a phone and confirm `✅`, `💰` and `✗` survive. Confirm the external captains guide reflects System in the menu and the Kit guide covers Insights; recheck guides after later app changes.
5. Compare production `/api/my-fixtures` CPU, request bytes and latency after the speed work, especially lower-team players. Historical local timing gains are not production benchmarks.
6. Confirm production stored office titles agree with Men's Convenor and Chairman. A visible My Tasks heading and the unused stored waiting-role title were left as optional owner decisions, not approved tasks.
7. Identify the club's TeamSnap account owner to remove men's data; Anthony said he is not responsible for that account. Do not assume the request has been fulfilled.
8. Check the committee draft automation after the tool migration. The latest imported scheduled run failed because Claude subscription access was disabled; migration into Codex does not prove the schedule is active here. Do not create a duplicate schedule without inspecting the existing configuration and receiving the owner's request.

## Related repositories and private resources

- `ant-ford/hkha-sync`: fixtures, results, duty sync and heartbeat. Use current main there; historical Lock HKHA Sync instructions described Airtable. Confirm the Supabase equivalent before altering corrected fixtures.
- `ant-ford/eddy-site`, local `C:\dev\eddy-site`: public landing page, privacy, What's new and guides at `eddy.global/guides`. Audience is every club: avoid HKFC branding in guide/site prose and avoid naming infrastructure providers or hosting locations in public privacy text. The approved tagline is Squads, kit, events and membership, on your phone.
- `C:\dev\eddy-tools\db-read.mjs`: private preview read helper. Its preview snapshot is not current production data. Mask connection strings in wrappers and never print secret values.
- `C:\dev\eddy-pdf-templates`: durable private blank PDF templates and fonts, also uploaded to R2. These were already supplied; do not ask for them again. Do not add them to this public repository.
- Committee updates are personal work, outside the public Eddy repo. Use the installed `committee-update` skill. The intended schedule was first Monday monthly around 08:10 Hong Kong time, with a first-week guard. Drafts go in `Documents\Committee updates`; vice-captain notes finish the draft. Stale preview figures must be labelled and replaced with owner-supplied production results from the skill's read-only `scripts/stats.sql`.
- The committee update covers section-wide administration, results and men's section notes. Describe Eddy as consolidated club admin; do not offer it to the Ladies or include unnecessary access/selection detail. Historical injuries and named-member figures are in the private records, not this public handover.

## Local work and recovery

At consolidation the main checkout was `bbad50e`, its cached `origin/main` was `b2c6a15`, and GitHub main was `5f07207`. README was refreshed from the verified GitHub version; implementation must update the code checkout first. No branches were switched and no application code was changed.

`C:\dev\Squad-Selections-team-avail-open`, branch `feat/team-availability-for-everyone`, still had seven modified files: App, header items, TeamAvailability, header tests, authorization tests, Worker auth and Worker index. Its old permission/route design overlaps the shipped feature and must be compared with latest main before any reuse or cleanup. A private patch snapshot was retained. Do not delete this worktree merely to clear chats.

Other local worktrees included older wording branches and the `hopeful-bhabha` / `objective-pike` folders. Assess clean state, unpushed commits and merge ancestry before cleanup. Preserve the remote `assets/pr-screenshots` branch because historical PR bodies link its images.

Follow README's worktree rules. If a worktree has a `node_modules` junction, remove only the junction before removing the checkout, and verify the main dependencies remain. Use PowerShell-compatible commands; avoid assumptions about shell helpers available in the earlier Claude environment. GitHub CLI was unavailable on PATH in this consolidation session.

The private backup beside this chat contains the imported project conversation records, original Claude project records and memory, and the older Team availability patch. It is outside the public repo. Conversation readers reported `thread/items/list is not supported yet`, so filesystem records supplied the history. Backups preserve detail and historical contradictions; they are not instructions to repeat completed work. The preparation did not delete or archive any chats.

