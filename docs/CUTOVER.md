# Switch-over: Airtable → Supabase

**Updated 1 Oct 2026.** It is finished on Friday 2 Oct, from what the last checks show.

- **When:** Saturday 3 Oct 2026 (Sunday 4 Oct in reserve), with the owner present throughout.
- **Go/no-go:** Friday 2 Oct. Every box under [Before Saturday](#before-saturday) must be ticked, or the switch-over moves.
- **Hard stop:** Airtable's subscription ends on 20 Oct 2026. Until then Airtable is the way back, but only on the day itself (see [Roll back](#5-decide-the-same-day)).

**Roles.** The **owner** (Anthony) does everything in Airtable, Fillout, Make, Google Apps Script, Cloudflare and GitHub settings. The owner also runs every script that writes eddy-production: `import-airtable.mjs`, `import-kit-order.mjs`, and migrations. **Claude** writes the PRs, runs the read-only checks (parity, `/health`, read comparisons) and watches the logs. Claude never writes to Airtable, Fillout, Make or Apps Script.

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
- [ ] **Every migration on `main` is applied to eddy-production**, and its data tables are still empty. Still to apply, as of 1 Oct evening: `20261001200000_application_signing` and `20261001210000_application_signing_order`, plus anything merged later. A read-only comparison with preview must match.
- [ ] **The id fix is merged** (`fix/eddy-ids`): squad saves, auto-select, approving an applicant, Notify Now and contact lookups accept the uuid ids of people and commitments created in Eddy.
- [ ] The October forms work in preview: commitment reviews ✓, waivers ✓, member details ✓, new joiner (propose, apply, sign) ✓. The gaps that stay manual are listed under [Not in Eddy yet](#not-in-eddy-yet).
- [ ] Before the freeze, the owner has saved anything that only exists in Fillout (see [Before cancelling](#before-cancelling-by-20-oct)), at least the two PDFs Fillout hosts.

## 1. Freeze (owner, about 30 minutes)

Nothing may write to Airtable after this point, or it is lost.

1. **Close every Fillout form**, all 17. Set each form's closed message to "This form has moved to Eddy: eddy.global", because emails sent before today still link to them:
   - Section Captain New Joiner (Create), Section Captain New Joiner (Update);
   - Applicant New Joiner Form, Sponsor New Joiner Form, Signatures New Joiner Form;
   - Trials Registration Login, Trials Registration;
   - Member Login Page, Member Data Update, Member Waivers & Consent;
   - Member Commitment Reporting, Sponsor Commitment Review, Membership Officer Commitment Review;
   - Hockey Rules Quiz 1.0 (2025), 1.0 (2026), 2.0 (2026), 3.0 (2026).
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

The production Worker is still on Airtable at this point, so the app keeps working, read-mostly, for anyone using it.

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
  node import-kit-order.mjs --file="2026-27 Kukri Kit Order 1 (2026.08.17).csv" --name="2026-27 Kukri order 1" --supplier=Kukri --ordered-on=2026-08-17 --apply --target=production --i-understand-this-writes-production
  ```

- Upload the New Members Info Sheet to production if it is not there yet (done 1 Oct): `node upload-club-doc.mjs --target=production --i-understand-this-writes-production`.
- Then back up eddy-production (**Actions → Database backup → Run workflow**), so the starting point is kept.

**After the flip, never run `import-airtable.mjs` again.** It copies Airtable over whatever Eddy holds, and rows hkha-sync creates have no `airtable_id`, so a re-import would duplicate them.

## 3. Flip (Claude PR, owner merges)

1. A PR sets `DATA_BACKEND = "supabase"` in the production `[vars]` of `worker/wrangler.toml`. Merging deploys it through CI in about 5 minutes.
2. Point hkha-sync at production only, re-enable it, and run it once by hand:

   ```bash
   gh variable set SYNC_TARGETS --repo ant-ford/hkha-sync --body '["supabase-production"]'
   ```

   ```bash
   gh workflow enable "HKHA Sync" --repo ant-ford/hkha-sync
   ```

   ```bash
   gh workflow run "HKHA Sync" --repo ant-ford/hkha-sync
   ```

3. Check that `/health?deep=1` answers, and that the request log shows `dbCalls` and no `airtableCalls` for data routes.

## 4. Smoke test (both, 1 hour)

Signed in as a player, a coach, the Section Captain and an officer:

- **Player:** dashboard fixtures, availability (one fixture, a whole date, the rest of the day after a No), standing rules, season stats, My Tasks, My details, volunteering, kit (who holds my set), and an existing calendar feed link. Imported people keep their Airtable ids, so old links keep working.
- **Coach:** fixture list, squad selection (save, derby, displacement), match kit, auto-select, recommendations, ranking (move, reorder, activate or deactivate), ranking history, WhatsApp notify, season plans for their teams.
- **Section Captain:** season plans (all teams), volunteers, kit screens, propose a new joiner (on a test person only).
- **Officer:** membership board and Insights, Statements board and Notify Now, email lists and CSV, active-member export, sign an application and approve an applicant (test applicant only).
- **October forms:** commitment report and reviews (with AI drafts), waivers, member details, new joiner application.
- **Stats:** club, teams, players, umpires.

Watch Workers Logs for an hour for errors, 5xx responses and slow requests. Then delete any test people made on production.

## 5. Decide the same day

Writes made after the flip exist only in Supabase, so decide by Saturday evening:

- **Go:** keep Fillout closed, Make off, the automations off and the Apps Script archived. Airtable stays read-only until 20 Oct.
- **Roll back:**
  1. A PR sets `DATA_BACKEND = "airtable"`; the merge deploys it.
  2. Re-open the Fillout forms. Re-enable the Make scenario, the automations, the Apps Script and hkha-sync with `SYNC_TARGETS=["airtable"]`.
  3. Anything written in Supabase since the flip must be re-entered in Airtable by hand. Claude lists it from `activity_log` and `updated_at`.
  4. **Some work cannot go back.** Kit moves, season plans, volunteering, declarations and applications started in Eddy have no Airtable home. They are lost on a rollback unless re-entered elsewhere. So rolling back is only realistic on Saturday itself.

## Not in Eddy yet

These stay manual after the switch-over, until they are built:

| What | Until it is built |
|---|---|
| Existing HKFC member joining hockey: the "Accepted" email and the front desk levy PDF (the Make scenario did both) | The Membership Officer sends them by hand. The levy form is filled already (inside the new member's application PDF); it needs the front desk's address and its own trigger. |
| Trials registration, Hockey Rules quizzes | "Flag an officer". Rebuilt later from the saved Fillout forms. |
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
