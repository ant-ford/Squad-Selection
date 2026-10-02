# Switch-over: Airtable → Supabase

**Updated 2 Oct 2026**, after the readiness check (database, settings, import, replacements and free-plan limits).

- **When:** Saturday 3 Oct 2026 (Sunday 4 Oct in reserve), with the owner present throughout.
- **Go/no-go:** Friday 2 Oct. Every box under [Before Saturday](#before-saturday) must be ticked, or the switch-over moves.
- **Hard stop:** Airtable's subscription ends on 20 Oct 2026. Until then Airtable is the way back, but only on the day itself (see [Roll back](#5-decide-the-same-day)).

**Roles.** The **owner** (Anthony) does everything in Airtable, Fillout, Zite, Make, Google Apps Script, Cloudflare and GitHub settings, and runs `import-airtable.mjs`. **Claude** writes the PRs, runs the read-only checks (parity, `/health`, read comparisons, counts) and watches the logs, and with the owner's OK applies migrations and runs `import-kit-order.mjs` and `upload-club-doc.mjs` against eddy-production. Claude never writes to Airtable, Fillout, Zite, Make or Apps Script.

## Before Saturday

GATE C, decided on Friday:

- [x] Every screen works in preview on imported data (preview Worker on `DATA_BACKEND=supabase` since 30 Sep).
- [x] Parity against a fresh Airtable read: no unexplained differences (29 Sep). It runs again on production during the final import.
- [x] The nightly eddy-production backup runs, and a restore drill has passed (29 Sep; `docs/RESTORE.md`).
- [x] Every Airtable automation has its replacement in the Worker (table below).
- [x] hkha-sync has its Supabase write path; it has also been writing eddy-preview since 29 Sep.
- [x] The production Worker has `DATA_SUPABASE_URL`, `DATA_SUPABASE_SECRET_KEY`, the `FILES` bucket and `OPENROUTER_API_KEY`, still on `DATA_BACKEND=airtable`.
- [x] Emails send from menscaptain@hkfchockey.com through Resend (tested 1 Oct).
- [x] Officers and section captains know the date.
- [x] **Every migration on `main` is applied to eddy-production**, and its tables are still empty (2 Oct: 26 migrations; the read-only comparison with preview matches table for table, column for column; RLS on every table; no grants to anon or authenticated).
- [x] **The id fix is merged** (#106): squad saves, auto-select, approving an applicant, Notify Now and contact lookups accept the uuid ids of people and commitments created in Eddy.
- [x] The October forms are in Eddy: commitment reviews, waivers, member details, new joiner (propose, apply, sign in order, PDF to the Club), and trials registration (`/join`). The gaps that stay manual are under [Not in Eddy yet](#not-in-eddy-yet).
- [x] The two PDFs Fillout hosts (SAM terms pages 11-12, Commitment Pledge) are in Eddy; the New Members Info Sheet is on eddy-files (private, behind sign-in).
- [x] The production Worker has every secret, binding and the render-pdf Edge Function it needs (checked 2 Oct); hkha-sync has its production key.
- [x] **#114 is merged**, with its migration `20261002120000_email_recipients` applied to eddy-production first (2 Oct): no blind copies or membership-inbox copies; Eddy counts every address against 70 a day, leaving Resend's last ~30 for sign-in codes; review cron at most 10 a run; KV only for Stats on Supabase. The quizzes migration is on production too.
- [ ] **The three applications part-way through signing** (owner, 2 Oct): the Chairman has signed two, now stage 5 (waiting on the Membership Officer). If the MO signs them in Fillout before the freeze they reach stage 6 and are approved on the board; if not, `backfill-applications.mjs` moves them into Eddy with the stage-3 one and the MO signs there. The stage-3 one (waiting on its sponsor) moves to Eddy after the import either way. Stage 6 (10 people) is fine: approve them on the board. Stage 2 (1 person): after the flip, the Section Captain re-sends the invitation from Eddy.
- [x] **Supabase egress checked** (2 Oct): at most ~260 KB a day across both projects while preview was in use (28 Sep–2 Oct), far below the free plan's 5 GB a month. No week-1 fixes needed up front; keep watching Usage → Egress daily for the first week.
- [x] **The kit order CSV** is at `C:\Users\anthony.ford\Downloads\2026-27 Kukri Kit Order 1 (2026.08.17).csv` (it has names, so it stays out of the repo). Dry run on 2 Oct: 179 sets, 174 matched to a person, 10 goalkeeper sets.
- [x] Quizzes (owner, 2 Oct): the Hockey Rules quizzes are in Eddy (`/quizzes`), and the Fillout quizzes close with the rest. Past scores come with the import (scores above 0; Airtable's 0 meant never taken). The questions and answer keys were loaded into production on 2 Oct from `C:\dev\eddy-quizzes.json`, which stays out of the repository.

## 1. Freeze (owner, about 30 minutes)

Nothing may write to Airtable after this point, or it is lost.

1. **Close every Fillout form**, all 17, and the **Zite trials form**. Set each closed message to "This form has moved to Eddy: https://app.eddy.global" (not eddy.global, which is the public website), because emails sent before today still link to them. For the trials forms use https://app.eddy.global/join; for the quizzes, https://app.eddy.global/quizzes:
   - Section Captain New Joiner (Create), Section Captain New Joiner (Update);
   - Applicant New Joiner Form, Sponsor New Joiner Form, Signatures New Joiner Form;
   - Trials Registration Login, Trials Registration;
   - Member Login Page, Member Data Update, Member Waivers & Consent;
   - Member Commitment Reporting, Sponsor Commitment Review, Membership Officer Commitment Review;
   - Hockey Rules Quiz 1.0 (2025), 1.0 (2026), 2.0 (2026), 3.0 (2026);
   - also: the Zite trials form, the Commitment Record Picker (old review emails link to it) and the 2026.08.24 umpire course sign-up (it writes Airtable).
2. **Switch off the Make.com scenario** "Section Captain - New Joiner Workflow".
3. **Switch off the 9 Airtable automations:**
   - Email Commitment Form (60 Days Trigger);
   - Email Commitment Form (Notify Now Trigger);
   - Update Status when Applicant Accepted;
   - New Applicant - Copy Signatures;
   - Get Updated Signatures;
   - Link Match Cards to People;
   - Update Commitments for # Matches & Teams Played;
   - Update Commitment Records;
   - Add Players to Trials.
4. **Stop using the People "Send WhatsApp" button.** It calls the Google Apps Script web app, which writes Airtable's Message Log. Archive the script's deployment.
5. **Pause hkha-sync:**

   ```bash
   gh workflow disable "HKHA Sync" --repo ant-ford/hkha-sync
   ```

6. Tell Claude "frozen", with the time.

The production Worker is still on Airtable at this point, so the app keeps working for anyone using it, and **anything they do (availability, squad saves, ranking) still goes to Airtable**. Keep the import-to-flip window short: do it early on Saturday, tell players and coaches the app is read-only for an hour, and re-run the import just before the flip (step 3).

## 2. Final import (owner, about 45 minutes)

From `scripts/migration`:

```bash
node import-airtable.mjs --apply --target=production --i-understand-this-writes-production
```

```bash
node parity.mjs --target=production --i-understand-this-writes-production --files=all
```

- **Stop on any unexplained difference.** Fix it, re-run the import (it upserts, so a re-run is safe *now*), then run parity again.
- Then load the kit order (179 sets, idempotent), and check the count matches preview:

  ```bash
  node import-kit-order.mjs --file="C:\Users\anthony.ford\Downloads\2026-27 Kukri Kit Order 1 (2026.08.17).csv" --name="2026-27 Kukri order 1" --supplier=Kukri --ordered-on=2026-08-17 --apply --target=production --i-understand-this-writes-production
  ```

- Move any application still mid-signing into Eddy (owner, 2 Oct: the one waiting on its sponsor; the two waiting on the Chairman are finished in Fillout first). It's a dry run without `--apply`, and touches only stage 3–5 new members with no Eddy application. Then tell each next signer (the sponsor; the MO for any still at stage 5) it's in their My Tasks (no email is sent):

  ```bash
  node backfill-applications.mjs --apply --target=production --i-understand-this-writes-production
  ```

- The Hockey Rules quizzes are already loaded on production (2 Oct; the import doesn't touch them). Only if their questions change, load them again (upserts, so a re-run is safe):

  ```bash
  node load-quizzes.mjs --file="C:\dev\eddy-quizzes.json" --apply --target=production --i-understand-this-writes-production
  ```

- Upload the New Members Info Sheet to production if it is not there yet (done 1 Oct): `node upload-club-doc.mjs --target=production --i-understand-this-writes-production`.
- Claude checks, read-only: the PDF templates and the Chinese font are in eddy-files under `templates/`; how many reviews the first 11:00 HKT run will email (`select count(*) from reviews_due_v`, about 1 expected; at most 10 go a day); the in-flight applicants by stage.
- Then back up eddy-production (**Actions → Database backup → Run workflow**), so the starting point is kept.

**After the flip, never run `import-airtable.mjs` again.** It copies Airtable over whatever Eddy holds, and rows hkha-sync creates have no `airtable_id`, so a re-import would duplicate them.

## 3. Flip (Claude PR, owner merges)

1. **Re-run the import** (`import-airtable.mjs --apply --target=production --i-understand-this-writes-production`), so anything written to Airtable through the app since the first run comes across. It is safe until the flip, never after.
2. Merge the switch PR (ready as a draft): it sets `DATA_BACKEND = "supabase"` (exactly that, lowercase, not through `DATA_BACKEND_OVERRIDES`) in the production `[vars]` of `worker/wrangler.toml`, and bumps the Stats summary version so the first stats are built from Supabase. CI deploys it in about 2 minutes.
3. Point hkha-sync at production only, re-enable it, and run it once by hand:

   ```bash
   gh variable set SYNC_TARGETS --repo ant-ford/hkha-sync --body '["supabase-production"]'
   ```

   ```bash
   gh workflow enable "HKHA Sync" --repo ant-ford/hkha-sync
   ```

   ```bash
   gh workflow run "HKHA Sync" --repo ant-ford/hkha-sync
   ```

4. Check that `/health?deep=1` answers, and that the request log shows `dbCalls` and no `airtableCalls` for data routes.
5. **Kit:** on the kit screen, set the Kukri order's arrival date. Until it is set, every hand-out is refused as "still on order". Kit already handed out before today is recorded on the kit screen as it is handed out.

## 4. Smoke test (both, 1 hour)

Signed in as a player, a coach, the Section Captain and an officer. **Production has no email redirect: every email goes to the real person.** Use only test people whose address is yours, and never press Send on an application, Send invitation, Ask for kit / registration or Invite to a practice trial for a real person.

- **Player:** dashboard fixtures, availability (one fixture, a whole date, the rest of the day after a No), standing rules, season stats, My Tasks, My details, volunteering, kit (who holds my set), and an existing calendar feed link. Imported people keep their Airtable ids, so old links keep working.
- **Coach:** fixture list, squad selection (save, derby, displacement), match kit, auto-select, recommendations, ranking (move, reorder, activate or deactivate), ranking history, WhatsApp notify, season plans for their teams.
- **Section Captain:** season plans (all teams), volunteers, kit screens (set the arrival date), trial sessions, propose a new joiner (on a test person only).
- **Officer:** membership board and Insights, Statements board and Notify Now, email lists and CSV, active-member export, sign an application and approve an applicant (test applicant only).
- **October forms:** commitment report and reviews (with AI drafts), waivers, member details, new joiner application, `/join` with a test email of yours (then delete that test person).
- **Stats:** club, teams, players, umpires.
- **Quizzes:** `/quizzes` lists the three with your score; take one (as yourself, it only stores your score); a Section Captain sees everyone's.

Watch Workers Logs for an hour for errors, 5xx responses and slow requests. Then delete any test people made on production.

## 5. Decide the same day

Writes made after the flip exist only in Supabase, so decide by Saturday evening:

- **Go:** keep Fillout closed, Make off, the automations off and the Apps Script archived. Airtable stays read-only until 20 Oct.
- **Roll back:**
  1. A PR sets `DATA_BACKEND = "airtable"`; the merge deploys it.
  2. Re-open the Fillout forms. Re-enable the Make scenario, the automations, the Apps Script and hkha-sync with `SYNC_TARGETS=["airtable"]`.
  3. Anything written in Supabase since the flip must be re-entered in Airtable by hand. Claude lists it from `activity_log` and `updated_at`.
  4. **Some work cannot go back.** Kit moves, season plans, volunteering, declarations and applications started in Eddy have no Airtable home. They are lost on a rollback unless re-entered elsewhere. So rolling back is only realistic on Saturday itself.

## 6. Watch in week 1

Free-plan limits (checked 2 Oct):

- **Supabase egress** (5 GB a month, production and preview together): look at Usage → Egress daily. If it runs at more than ~150 MB a day, Claude's fixes, in order: read one player's availability, not the season's (availability answers, the coach squad poll, the dashboard); cache calendar feeds; slow the kit board's 20-second refresh; explicit columns instead of `select=*` for players.
- **Resend** (100 addresses a day, 3,000 a month, resetting at 08:00 HKT, shared with sign-in codes): Eddy stops itself at 70. If sign-in codes still fail on a busy day, give Supabase Auth's SMTP its own sending account, or take Resend Pro for October.
- **Workers**: errors from running over 10 ms of CPU (Workers Logs / Metrics), especially uploads of large PDFs (over ~1.5 MB). Workers Builds also builds hkfc-api: check in the dashboard that it doesn't deploy separately from CI.
- **CALENDAR_SECRET** must never change (a new value breaks every subscribed calendar); it's in `eddy-secrets.txt`.

## Not in Eddy yet

These stay manual after the switch-over, until they are built:

| What | Until it is built |
|---|---|
| Existing HKFC member joining hockey: an "Accepted" email to the member | The levy form goes to the front desk from Eddy when the MO presses Send, copying the member and any parent or guardian; sending it accepts them. A separate welcome is by hand. |
| Applications part-way through signing in Fillout at the freeze | Finished in Fillout first, or given an Eddy application record after the import (Before Saturday). |
| A junior already a Member moving to Junior / Sports Preferred Associate (Make's "Child/Junior" route) | By hand: Eddy's new joiner screen refuses people who are already Members. |
| The HockeyHK U18 form for a new under-18 joiner | It comes with their waivers, not with the application, so the Hockey Convenor's registration task shows it only once they've signed waivers. |
| WhatsApp mail merge (People "Send WhatsApp" button: template → personalised message → WhatsApp, logged) | Templates and the message log are imported (`message_templates`, `message_log`); the screen is not built. |
| HockeyHK registration Google Form (pre-filled from Airtable) | Dropped this season. |

## Before cancelling (by 20 Oct)

Save what only exists in the old tools:

- **Airtable:** a final snapshot (CSV for every table, plus attachments) to `eddy-backups`. Copy the text of any automation scripts and AI-field prompts not already in Eddy.
- **Fillout:** the two PDFs it hosts (SAM terms pages 11-12, Commitment Pledge 2026.04) into Eddy's private club documents. The trials form and the four quizzes (questions, answer keys and wording), so they can be rebuilt. A submissions export, if it holds anything Airtable doesn't.
- **Make:** the scenario blueprint (already exported).
- **Apps Script:** the owner has the source. Delete its `AIRTABLE_API_KEY` script property.

Then remove the Airtable side of Eddy (Claude PRs):

- the Airtable client and repositories, shadow reads, the webhook and `register-airtable-webhook.mjs` (delete the webhook in Airtable first), the webhook refresh in the daily cron (keep the cron: it sends the review emails), the Airtable caching and the Airtable check in `/health?deep=1`;
- the Fillout links in the field maps and My Tasks;
- the `AIRTABLE_*` secrets and variables in the Worker and GitHub, and hkha-sync's Airtable target and code;
- README and tests to match.

Revoke the Airtable tokens: the Worker's, the read-only import token and the Apps Script's. The raw archive (`archive.airtable_records`) and `scripts/migration/.migration-cache/` are deleted only with the owner's yes.

Then it is safe to cancel Airtable and Fillout, and to delete the Make scenario and the Apps Script project.

## Accounts afterwards

| Account | After the switch-over |
|---|---|
| Airtable | Not needed. Cancel at the end of the term (20 Oct), after the snapshot. |
| Fillout | Not needed, after the exports above. |
| Make.com | Not needed (free plan; delete the scenario). |
| Google Apps Script | Not needed. The WhatsApp mail merge waits for its Eddy screen. |
| Supabase (free) | eddy-production and eddy-preview. Free projects pause after a quiet week; the nightly backup and hkha-sync keep production busy, but check it over the summer break. |
| Cloudflare | Workers, R2 (`eddy-files`, `eddy-backups`), DNS routes for eddy.global. |
| GitHub | Code, CI, deploys, backups, hkha-sync. |
| Resend | All email. |
| OpenRouter | AI review drafts and ID reading (paid, small). |
| Google Workspace, GoDaddy | The menscaptain@ mailbox and hkfchockey.com's DNS. |

## Automation replacements

| Airtable automation | Replaced by | Ready? |
|---|---|---|
| Email Commitment Form (60 days) | Daily Worker job: one email when a review step starts | Yes (#81) |
| Email Commitment Form (Notify Now) | The same job, started from the Statements board | Yes (#81) |
| Update Status when Applicant Accepted | A database trigger: an applicant moved to Accepted or Temporary becomes a Member | Yes (#81) |
| New Applicant - Copy Signatures | Not needed: signatures are drawn in Eddy | n/a |
| Get Updated Signatures | Not needed, as above | n/a |
| Link Match Cards to People | A database trigger links each new card by Registered Name, when exactly one person has it | Yes (#81) |
| Update Commitments for # Matches & Teams Played | A view, always current; stored when the member submits | Yes (#81) |
| Update Commitment Records | A database trigger creates the yearly periods when a member's join or end date is set or changes | Yes (#81) |
| Add Players to Trials | Not needed: Trials History is no longer required | n/a |
