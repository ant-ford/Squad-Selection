# Design notes: change history (Track C) and notices (Track D)

From the 6 Oct 2026 review. The build waits for session 3's admin and API
work, which changes the same Worker modules. **Questions for the owner are in
bold.** Eddy sends no new emails for any of this.

## Track C: change history

### What's there today

- `activity_log` has `actor_person_id`, `action`, `entity`, `entity_id` and
  `fields text[]`. Its comment says it holds field *names*, never values.
  Only officer actions write to it (CRM, joiners, registration, trials,
  erasure), and nothing reads it.
- Squad saves, auto-select, kit colour, Opt-In Only and coaches' availability
  answers leave only `console.log` lines, and nobody can read those.
- Every database call goes through one `fetch` in
  `worker/src/data/supabase.ts`. A request-scoped context (`requestContext.ts`,
  AsyncLocalStorage) already wraps every request.

### Who made the change

- `requireAuthorizedUser` stores the person's `api_id` in the request
  context. `call()` sends it as `x-eddy-actor` on every PostgREST request.
  That's one change, not one per call site (there are about 190).
- The trigger reads
  `current_setting('request.headers', true)::json ->> 'x-eddy-actor'` and finds
  the uuid through the unique `people.api_id` index. It never raises: an
  unknown actor is logged with no person.
- A new `actor_label` column covers changes that have no person:
  - `hkha-sync`: there's no header, so the trigger infers it when the update
    sets `last_hkha_sync`. No hkha-sync change is needed.
  - `retention`: the cron.
  - `sql`: anything outside PostgREST, such as the Table Editor.

### What gets logged

- One generic `AFTER INSERT OR UPDATE OR DELETE` row trigger on `matches`,
  `people`, `team_people` and `offices`.
- It compares `to_jsonb(old)` with `to_jsonb(new)` and skips housekeeping
  columns: `updated_at`, `last_hkha_sync`, `last_seen_at`,
  `profile_updated_at`, `stage_updated_at`, and the rank columns, which
  ranking history already covers.
- New column `changes jsonb`, holding `{field: [old, new]}`:
  - **Personal and billing fields** (people's identity, contact, address,
    guardian and bank columns) keep today's rule: field names only, values
    never stored.
  - **Everything else** stores old and new values: teams, Active, Opt-In
    Only, kit colours, auto-select, match status, offices.
- **Squads are logged inside `set_match_selection`, not by a trigger.**
  - The function deletes and re-inserts a whole side, so a row trigger would
    log every player as removed and added again on every save. A squad save
    also always writes both sides.
  - Instead, the function compares the old and new lists and writes one row
    only when something changed: `action 'squad'`,
    `changes {side, added: [...], removed: [...]}`.
- **Coaches' availability answers:** a trigger on `availability_exceptions`
  that logs only when the actor isn't the player. Players' own taps would
  swamp the log, and `updated_by_id` already shows who answered last.
- Writes that come back unchanged log nothing.

### Reading it

- `GET /api/history?person=<api_id>` and `GET /api/history?match=<api_id>`
  return
  `[{at, actor, action, summary, fields}]`.
  - Names are resolved on the server.
  - Summaries are short, e.g. "Squad HKFC C: +Sam Lee −Tom Wu", "Kit:
    White → Blue", "Opt-In Only on", "Contact details changed".
- Who sees it:
  - A match's history: its teams' coaches and every officer.
  - A person's history: officers, and coaches of that person's team, who see
    only the non-personal rows.
- A "History" sheet:
  - Person: from the membership sheets and the squad row.
  - Match: from the squad screen's menu.
  - Same layout as the kit set History list (`SetSheet.tsx`). It uses
    whichever overlay component exists at the time; Track B migrates it later.
- README: one line saying squad selections and officer changes are audited.

### Questions

1. **Store old and new values for non-personal fields? This changes the
   "names only" rule.** Recommended: yes. Personal and billing fields stay
   names-only.
2. **Log coaches' availability answers (not players' own)?** Recommended: yes.
3. **How long to keep history?** Recommended: two seasons, removed by the
   existing nightly retention job.

### Cost

About 2 to 4 log rows per squad save, and a few hundred rows a week across
the section, well within the free plan. The trigger's api_id lookup is one
indexed read per changed row.

## Track D: notices and the weekly loop

### D1 Umpire duties for the umpire

- **Calendar feed:** confirmed assignments (`umpire_assignments.status =
  'confirmed'`) are added as events: "Umpiring: Pak A v HKFC C (slot 1)".
  - A cancelled duty stays in the feed with `STATUS:CANCELLED` for 14 days,
    so calendars remove it instead of silently keeping it.
  - The feed cache key gains a duty version, or the 5-minute cache is
    accepted.
- **Player page:** a "Your duty: Sat 09:00, HKFC pitch" line under My Tasks,
  showing the next confirmed duty in the next 14 days. `getMyFixtures`
  already returns `umpiring`, so it gains `nextDuty`.
- **My Tasks:** a line when a duty you hold has moved or been cancelled:
  "Your duty moved: Sat 09:00 → Sun 10:30" with an "OK" button.
  - It needs `umpire_duties.previous_match_date` and `changed_at`, kept by a
    small trigger.
  - It needs `umpire_assignments.seen_change_at`; "OK" stamps it.
  - My Tasks is computed on each request, so this is one more query against
    the person's confirmed assignments.

### D2 Ask to be reactivated

- AccessNotActive gets an "Ask to be reactivated" button in place of today's
  mailto link (which tells nobody).
  - `POST /api/reactivation` uses a verified email and an inactive People
    row.
  - It creates one open `steps` row (`process 'reactivation'`) per Active
    Section Captain office holder. A person has at most one open request.
- Each captain's My Tasks shows "Sam Lee asks to be reactivated (HKFC C)"
  linking to `/reactivate/:id`, which offers **Activate** or **Not now**.
  - The first answer closes every captain's copy.
  - Activate sets `active = true`, which the existing trigger stamps.
- The button then shows "Asked on 6 Oct". No email is sent.

### D3 One "WhatsApp these people" list

- One component: `<WhatsAppList people template />`.
  - The template text is editable and fills in {first name}.
  - Each person gets one wa.me link. Tapping it writes a `message_log` row
    (person, template, message, mobile) through `POST /api/messages`.
  - A tap is the nearest Eddy gets to "sent", the same as the Airtable Apps
    Script it replaces.
- Templates come from `message_templates`: 23 imported rows, all
  Airtable-era, and nothing reads them yet. Officers pick one or type their
  own.
- All three ways of building wa.me links today move into one helper
  (`src/lib/whatsapp.ts`); E4 finishes that.
- Where it's used:
  - Email Lists groups (Chairman screen);
  - waivers or details not done;
  - kit waiting over 14 days;
  - silent players (D5).
- Who sees it: whoever already sees the list it sits on.

### D4 The weekly loop

- **"WhatsApp the coach"**: after a No or Maybe on a fixture you're selected
  for, a link to your team's coach with the fixture filled in.
  - **This shows coaches' mobile numbers to their own players. Today no screen
    does that. Owner's call.**
- **"Changes since you notified"** in NotifySquadSheet:
  - New table `squad_notices (match_id, side, notified_at, notified_by,
    squad uuid[])`, written when the coach copies the announcement or opens a
    WhatsApp link. The sheet needs the match id and side, which it doesn't
    have today.
  - The sheet compares that squad with the current one: "+Sam −Lee since Thu
    20:14", with WhatsApp links for just those players.
  - The fixture card shows a dot while there are unsent changes.
- **"Start from last squad"**:
  - `getPlayersForMatch` also returns the same team's most recent earlier
    squad.
  - The button adds those players as pending changes, skipping anyone
    Unavailable or blocked.
  - Nothing is saved until the coach saves.

### D5 Silent players

- `people.last_seen_at` already exists (PR #156).
  - `requireAuthorizedUser` updates it inside `waitUntil` only when the cached
    People row says it's before today (HK), so at most once a day per person.
  - The update is conditional (`last_seen_at=lt.<today>`), so two devices
    can't double-write.
- Squad rows get a grey "not seen 6 wks" chip when:
  - the player hasn't been seen in 42 days, and
  - has no explicit answer for this fixture.
- The client can't tell an explicit Available from the default today.
  `getPlayersForMatch` adds `answered: boolean` and `lastSeenDays`.
- No Available taps are stored, so the opt-out model is unchanged.

### D6 Fixture changes

- HKHA handles a postponement by keeping the old row with status
  Rescheduled and adding a new row on the new date (Pak A v HKFC A: 20 Sep
  Rescheduled, then 13 Dec Scheduled). Time and venue changes are written in
  place.
- On preview, every future fixture lacks an HKHA fixture id, so hkha-sync
  matches them by date|home|away.
- A `before update` trigger on `matches` keeps `previous_match_date`,
  `previous_venue`, `previous_status` and `changed_at` when any of the three
  changes.
- Fixture lists include Rescheduled and Cancelled matches whose `changed_at`
  is within 7 days. Today only Scheduled matches are listed.
- Cards show:
  - "Moved from 09:00" or "Venue changed" on the moved match;
  - "Postponed" on the old row (Rescheduled), plus the new date when a
    Scheduled row with the same teams and division exists later in the
    season.
- NotifySquadSheet offers a ready message: "Change: HKFC C v Pak A is now
  Sun 10:30 at King's Park".

### D7 Web Push (after D1-D6, only with the owner's go-ahead)

- **Personal alerts only:**
  - a selected player turns Unavailable → the coach;
  - a duty is moved or cancelled → the umpire;
  - kit is offered → the receiver;
  - "Send to Eddy app" in Notify → the squad.
- Parts:
  - a `push_subscriptions` table (person, endpoint, keys), pruned on 404
    or 410;
  - VAPID signing and aes128gcm encryption with WebCrypto in the Worker;
  - a small `push-sw.js` added through Workbox `importScripts`, which keeps
    the generated service worker.
- Budget: one subrequest per device, sent in `waitUntil`, capped at 40 per
  invocation. A Notify send covers one squad.
- iOS needs 16.4 or later and the app on the Home Screen, so reach will be
  partial.

### D8 Training check-in (optional)

A weekly "Training" event using the existing events and QR attendance. Its
check-ins would pre-fill the practice % in commitment reviews.
**Owner decision: build it or not.**

### Questions for the owner

1. D4: show coaches' mobile numbers to their own players ("WhatsApp the
   coach")?
2. D2: should every Active Section Captain get the reactivation task, with
   the first answer closing it for all? Recommended: yes.
3. D6: "Postponed" and "Moved from" shown for 7 days. OK?
4. D7: go-ahead for push once D1-D6 are live?
5. D8: training check-in, yes or no?

### Order

D5 (smallest, and it feeds D3) → D6 → D1 → D2 → D3 → D4, then D7 if
approved.
