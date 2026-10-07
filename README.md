# Eddy

Eddy is the Hong Kong Football Club men's hockey section's web app. It covers player availability, squad selection, the section ranking and eligibility for eight league teams. It also covers the section's membership and admin work: applications and signing, commitment reviews, waivers, kit, season plans, volunteering, events, umpiring duties, HKHA registration, suspensions, data checks and club stats.

- App: https://app.eddy.global (a phone-first PWA). API: https://api.eddy.global.
- Repo: `ant-ford/Squad-Selection`. Results come from a separate repo, `ant-ford/hkha-sync`.

**For AI sessions:** this README and the code are the current truth. Everything under `docs/archive/` is history. Read [Working rules](#working-rules) before changing anything, and [docs/glossary.md](docs/glossary.md) before writing any on-screen text.

---

## Architecture

```
 Browser (React 19 + Vite PWA, app.eddy.global)
   │  sign-in: Supabase Auth email code, behind a Cloudflare Turnstile check
   │  every data call: HTTPS + Bearer JWT (+ X-Eddy-Fresh for 10 s after a write)
   ▼
 API Worker  (worker/src, Cloudflare Workers free plan, api.eddy.global)
   │  checks the JWT with Supabase while it reads auth_context() in parallel
   │  applies every business rule · versioned cache · crons · email · AI
   ├──► Supabase Postgres via PostgREST (secret key)   eddy-production / eddy-preview
   ├──► R2 bucket FILES (photos, IDs, signatures, PDFs) eddy-files / eddy-files-preview
   ├──► Supabase Edge Function render-pdf (fills PDF templates)
   └──► Cloudflare edge cache (calendar feeds)

 hkha-sync (GitHub Actions, other repo) ──► writes fixtures and results to Postgres
 backup.yml (GitHub Actions) ──► nightly encrypted pg_dump to R2 eddy-backups
 (both write a heartbeat row, which the daily health check reads)
```

- **Browser (`src/`).** Presentation only. It talks to Supabase for sign-in and to the Worker for everything else. It never reads tables, and never decides eligibility, play-up counts or rankings. See [Frontend](#frontend).
- **Worker (`worker/src/`).** The authoritative backend. Free plan limits shape the code: **10 ms CPU and 50 subrequests per request or cron run**. Every Postgres call, R2 call and email is a subrequest, and long jobs work in capped batches.
- **Postgres.** All club data since the switch from Airtable on **2 Oct 2026**. Multi-row writes that must succeed together are SQL functions called through `rpc()`, so each is one transaction. Statement triggers bump a counter in `cache_versions` on every real change, whoever makes it (the Worker, hkha-sync or the Table Editor). The Worker's caches are keyed on those counters.
- **Shared code (`shared/`).** Rules and formats used by both sides (display team, ability groups, stages, profile field specs, etc.). `worker/src` must not import `src/`, and `src/` must not import `worker/`.

### What's left of Airtable

Eddy ran on Airtable until 2 Oct 2026, and the Airtable code was removed in October 2026. What stays for good:
- **`rec…` ids.** Imported rows keep their Airtable id in `airtable_id`, and every public id is `api_id = coalesce(airtable_id, id::text)`. Calendar feed URLs, `/join?ref=`, `/review/:id` links in sent emails and bookmarked matches all carry `rec…` ids. Rows created in Eddy have uuid ids.

What stays until after 20 Oct 2026:
- **The `archive` schema** holds the raw Airtable JSON. Since migration `20261007000102`, retention reads it only while it exists, so nothing depends on it. Dropping it needs the owner's yes.
- **The records of the move:** `docs/CUTOVER.md`, `docs/migration/FIELDS.md` and `docs/Airtable Schema.json`.

---

## Screens and who opens them

The Worker decides access. `SECTION_OFFICES` in `worker/src/auth.ts` maps each officer screen to the offices that open it, and `/api/my-profile` tells the app which to show. The app hides what a person can't open, and the Worker refuses it regardless.

| Screen | Route | Who |
|---|---|---|
| Player view | `/` | Everyone signed in. Applicants at stages 1–2 go to `/apply` instead. |
| Coach view: fixtures, squad, ranking, team availability | `/coach`, `/coach/match/:id`, `/coach/ranking`, `/coach/availability` | Coaches, for their teams. Section Captains and the Assistant Director, for every team. Only Section Captains make players inactive. |
| Umpire view | `/umpiring` | The club's umpires. The Umpire Coordinator and Section Captains run the duties. |
| Membership | `/membership` | Membership Officer, Section Captains |
| Email lists | `/chairman` | Chairman, Section Captains |
| Kit | `/kit` | Kit Convenor, Section Captains |
| Season plans | `/season-plans` | Section Captains, plus coaches for their own teams |
| Trial sessions | `/trial-sessions` | Section Captains, Assistant Director |
| HKHA registration (Registered Names, Visiting) | `/registration` | Men's Convenor |
| People, and a person's admin page | `/people`, `/people/:id` | Membership Officer, Men's Convenor, Section Captains (each sees only their own sections' blocks) |
| Suspensions | `/suspensions` | Men's Convenor |
| Offices and teams | `/club` | Section Captains |
| Data checks | `/data-checks` | Men's Convenor, Section Captains |
| Events | `/events/manage`, `/events/manage/:id` | Social Secretary and Section Captains (any event); a team's social secretaries (that team's events) |
| Volunteers | `/volunteers` | Every officer, coach and team captain |
| System | `/system` | The owner (`SYSTEM_OWNER_IDS`) and Section Captains |
| Stats, quizzes | `/stats`, `/quizzes` | Everyone |

"Men's Convenor" is the `hockeyConvenor` office, and "Chairman" is `sectionChair` (see the glossary).

A new screen here also needs a line in `tools/demo/screens.mjs`, and fixtures for the calls it makes, so the screen smoke test opens it ([Testing](#testing)).

---

## Data model (Supabase Postgres)

Schema = `supabase/migrations/*.sql`, applied in version order. RLS is on for every table with **no policies and no grants to `anon`/`authenticated`**, so only the service role can read or write. The Worker authenticates with the project's secret key (`DATA_SUPABASE_SECRET_KEY`) and goes through `worker/src/data/supabase.ts` (paging, a retry on 500/502/503/504, `SupabaseError`).

| Area | Tables |
|---|---|
| People and offices | `people`, `offices`, `team_people`, `family_members`, `relatives`, `previous_clubs`, `shirt_numbers` |
| Teams and fixtures | `teams`, `matches`, `match_cards`, `match_selections`, `match_selection_versions`, `match_selection_changes`, `hkha_sync_state` |
| Availability | `availability_exceptions`, `availability_rules` |
| Ranking | `ranking_events`, `ability_group_config` |
| Discipline | `suspensions` (manual ones; card-point suspensions are derived from match cards) |
| Membership | `applications`, `signatures`, `commitments`, `declarations`, `steps`, `registration_events` |
| Trials and joiners | `trial_sessions`, `trial_availability`, `applicant_trials` |
| Season | `season_plans`, `season_plan_options`, `course_signups`, `season_rollovers`, `season_rollover_people` |
| Kit | `kit_orders`, `kit_sets`, `kit_moves`, `kit_sizes` |
| Events | `events`, `event_responses`, `event_payments` |
| Umpiring and HKHA | `umpire_duties`, `umpire_assignments`, `umpire_pool`, `hkha_registrations` |
| Quizzes | `quizzes`, `quiz_scores` |
| Messages and logs | `email_log`, `message_templates`, `message_log`, `activity_log`, `files`, `r2_deletions` |
| System | `cache_versions`, `error_log`, `heartbeats` |

- **Views.** `api_*` views (`api_players`, `api_players_lite`, `api_matches`, `api_match_cards`, `api_people_crm`, `api_reviews`, `api_suspensions`, …) are the shapes the Worker reads, and carry `api_id`. `api_players_lite` is the squad screens' narrow player read. `*_v` views are derived reads (`people_v`, `commitments_v`, `kit_sets_v`, `reviews_due_v`, `retention_due_v`, `retention_schedule_v`, …).
- **Functions (RPCs).**
  - Sign-in and reads:
    - `auth_context`: the person, their team links and offices, the umpire flag and the cache versions, in one call;
    - `read_cache_versions`;
    - `season_context`: everything eligibility, stats and attendance need for a season, in one call, or a narrower version for one player.
  - Selection and ranking: `apply_squad_changes` (a coach's adds and removes), `set_match_selection` (replaces a whole side; kept for stale PWAs), `update_people_ranks`, `insert_ranking_events`.
  - Availability: `set_availability`, `set_availability_for_date`, `availability_rule_status`.
  - Reviews: `start_review`, `submit_member_report`, `submit_sponsor_review`, `submit_officer_review`.
  - Applications and declarations: `submit_application`, `sign_application`, `submit_declarations`, `submit_season_plan`.
  - Kit: `kit_allocate`, `kit_move`, `kit_confirm`, `kit_swap`.
  - Officer admin: `admin_update_person`, `admin_create_person`, `admin_save_office`, `admin_save_team`, `admin_save_suspension`, `admin_clear_suspension`, `link_match_card`, `link_match_cards_by_name`, `resolve_registration_event`.
  - Profiles and retention: `delete_own_profile`, `erase_personal_data`, `retention_stamp`.
  - Season and system: `season_rollover`, `season_rollover_plan`, `season_rollover_undo`, `set_umpire_pool`, `log_client_error`, `system_health_snapshot`, `prune_system_health`.
- **Triggers.** `updated_at` on every mutable table, plus the rules that live in the database:
  - the `cache_versions` counters: statement triggers that bump only on a real change;
  - automatic re-registration after the last allowed play-up (`match_cards_auto_reregister`);
  - linking match cards to people by exact Registered Name (`match_cards_link_person`). Both match-card triggers run only when the columns they read change;
  - stamping `inactive_since` and the membership stage;
  - commitment periods.
- **Squad changes.** Every squad write goes through `on_squad_changed()`. It stores who was added or removed, by whom and by which path, in `match_selection_changes`, and bumps that side's version.
- **Files.**
  - Stored in R2 (binding `FILES`) and referenced from `files`. The browser only ever gets signed links (`worker/src/files.ts`), which expire within two hours, or two days for photos and posters.
  - Photos also get a 128 px thumbnail (`?v=thumb`).
  - An object released by a removal is deleted 35 days later (`r2_deletions`), to match backup retention.
  - Club documents with personal data are private R2 objects served behind sign-in (`/api/club-docs/:name`), never `public/docs`.

The data access seam is `worker/src/data/`: one repository per module (people, teams, officers, matches, matchCards, availabilityExceptions, availabilityRules, abilityGroups, rankingEvents, membershipEvents, commitments, suspensions, seasonData). The accessors (`people(env)` and so on) return the Supabase repositories, and tests swap in in-memory fakes. Newer features call PostgREST directly from their own module (`kit.ts`, `events.ts`, `apply.ts`, `admin/*`, …).

---

## Where business rules live

| Rule | Place |
|---|---|
| Eligibility (fixed 7-step order, exact reason strings, `RULE_IDS`) | `worker/src/eligibility.ts`; golden matrix `tests/golden-eligibility.test.ts`; spec `docs/HKFC Eligibility & Selection Rules Specification v1.0.md` |
| Play-up counting and allowances (3, or 8 for U21) | `worker/src/playUp.ts`, `shared/playUpAllowance.ts`; re-registration trigger in migration `20261003090000`; moves to review are resolved on Data checks (`resolve_registration_event()`) |
| Suspensions: card points (Bye-Law 16.3) derived from match cards; manual ones (red cards, disciplinary) entered by the Men's Convenor, served one after another, counting league and cup matches only | `worker/src/suspension.ts`, `worker/src/discipline.ts`, `shared/discipline.ts`, table `suspensions` |
| Section ranking, ability groups | `worker/src/ranking.ts`, `shared/abilityGroup.ts`, `shared/abilityRank.ts`; spec `docs/Coaches Ranking System.md` |
| Recommendations (advisory, never auto-select; returned with the squad's player list) | `worker/src/recommendations.ts` |
| Squad saves: a save sends only adds and removes; changes merge unless a change since the loaded version touched the same player (`409`); derby safety; higher-team priority | `worker/src/squad.ts`, `src/lib/squadDelta.ts`, SQL `apply_squad_changes()` / `on_squad_changed()` |
| Availability (exception-based, standing rules, Opt-In Only) | `worker/src/availability.ts`, `worker/src/availabilityRules.ts`, SQL `set_availability()` / `availability_rule_status()`. The rule cases are pinned on both sides: `tests/availabilityRuleCases.test.ts` and `scripts/availability-rule-checks.mjs` |
| Sign-in and access (who is a player, coach, officer, applicant) | `worker/src/auth.ts` (`SECTION_OFFICES`), `worker/src/authContext.ts`, SQL `auth_context()` |
| Registered Names and match-card linking | trigger `match_cards_link_person`; `link_match_cards_by_name()` when the Men's Convenor saves a name (`worker/src/registration.ts`); `link_match_card()` by hand on Data checks (`worker/src/matchCardLink.ts`) |
| Data checks (unlinked cards, shared Registered Names, re-registrations to review, incomplete players, likely duplicates) | `worker/src/dataChecks.ts`, `shared/dataChecks.ts` |
| Officer edits (people, offices, teams): each writes an `activity_log` row; one Membership Officer and one Chairman at a time (`offices_one_holder_idx`) | `worker/src/admin/*`, SQL `admin_*()`; a person's history: `GET /api/history` |
| System health | `worker/src/systemHealth.ts`: 5xx errors and app crashes go to `error_log`, each scheduled job writes `heartbeats`, a daily check runs, and `/system` shows the results |
| Season rollover (each July, run by the owner) | SQL `season_rollover_plan()` / `season_rollover()` / `season_rollover_undo()`; checklist `docs/SEASON_ROLLOVER.md` |
| Membership stages, applications, signing order | `shared/membershipStages.ts`, `worker/src/apply.ts`, `worker/src/applicationSigning.ts`, SQL `sign_application()` |
| Commitment reviews and their emails | `worker/src/reviews.ts`, `worker/src/reviewEmails.ts`, `worker/src/reviewDrafts.ts` |
| Data retention (13 months), Delete my profile | `worker/src/retention.ts`, SQL `retention_stamp()` / `erase_personal_data()`; `docs/DATA_RETENTION.md` |
| Change history (audited: squad selections, fixture and kit changes, teams, Active, Opt-In Only, offices, answers coaches give for players; who and when, values for non-personal fields only, kept two seasons) | `match_selection_changes` (squads), `activity_log` written by officers' functions and by the `audit_row()` trigger (migration `20261007160004`, actor from the Worker's `x-eddy-actor` header); read by `worker/src/history.ts` (`GET /api/history?person=` / `?match=`) |
| Displayed team (optics only) | `shared/displayTeam.ts`: Selected Team EOS, then SOS, then the true registered team |

**Invariants. Don't break these:**
1. Eligibility runs in a fixed order, and its reason strings and `RULE_IDS` never change: add new ones, never edit existing ones. If a golden test fails, don't deploy.
2. Every selection write is revalidated in the Worker. The client is never trusted.
3. Section Rank is the only stored ranking. Team rank, positional rank and ability are derived.
4. Availability is exception-based: no record means Available. An `Available` record is stored only where something else (a standing rule, or Opt-In Only) would otherwise give a different answer. `needsExplicitAvailable()` decides that in TypeScript, and `availability_rule_status()` in SQL. Keep the two in step.
5. The play-up GK exemption comes from the match card's Goalkeeper flag, never the player's position. Team order comes from `teams.team_rank`, never names.
6. The displayed team is optics. Every rule uses the true registered team.
7. Read fresh on write paths (no cache). Cached reads are keyed on `cache_versions`, so they stay exact in every isolate whoever writes. A table the Worker starts caching needs its own counter and triggers (see `20261007140003_cache_versions.sql`). Only the few caches outside the versions are dropped by hand (`worker/src/invalidation.ts`).
8. Squad writes go through `apply_squad_changes()` or `set_match_selection()`, which call `on_squad_changed()`. Never write `match_selections` directly.
9. `erase_personal_data()` must clear every table that refers to a person, and a redefinition keeps every existing delete. `tests/retentionCoverage.test.ts` fails on a table nobody has classified.
10. The sign-in storage key never changes (`src/lib/authClientOptions.ts`, pinned by `tests/authClientOptions.test.ts`). A new key would sign everyone out.

---

## Worker internals

- **Routing:** `worker/src/index.ts`, with the officer admin routes in `worker/src/admin/routes.ts`. Every `/api` route needs a verified Supabase session. Coach and officer routes check `AuthorizedUser` from `auth.ts`, and registering to join needs only a verified email. The only routes without a session are `/health`, signed stored-file links (`files.ts`) and the HMAC-signed `.ics` calendar feeds. `tests/authorization-routes.test.ts` pins this.
- **Sign-in:** each request checks the JWT with Supabase (`/auth/v1/user`; an isolate remembers a checked token for 60 s) and, in parallel, reads `auth_context()`. An isolate reuses that answer for 10 s. For 10 s after a write the app sends `X-Eddy-Fresh`, so a person always reads their own change, whichever isolate answers (`shared/freshHeader.ts`).
- **Caching:**
  - `worker/src/cache.ts` keeps reads in each isolate's memory, under keys that carry the cache versions of the tables they're built from (`getVersioned`), so a write anywhere moves the key.
  - KV (`CACHE`) holds only the club Stats summaries.
  - Calendar feeds are kept in Cloudflare's edge cache under the same versions.
- **Request stats:** `worker/src/requestContext.ts` counts database calls, bytes and wait time. The figures go out as a `Server-Timing` header and one log line per request.
- **Crons:** `scheduled()` in `index.ts`. Preview has no crons, so its `/system` shows every job as never run.
  - **03:00 UTC (11:00 HKT):** commitment review emails, within a counted budget of about 40 subrequests.
  - **03:30 UTC:** retention. `RETENTION_MODE` stays `report` until the owner flips it to `remove`.
  - **04:00 UTC:** the system health check.
    - It reads the heartbeats and the error log, refreshes the umpire pool, and prunes rows older than 90 days.
    - When something is wrong, it puts a "System" line in the owner's My Tasks and emails `SYSTEM_ALERT_EMAIL`.
- **Errors:** every 5xx the Worker answers, and every crash the app reports (`POST /api/client-error`, signed in and rate-limited), goes to `error_log`. Scheduled jobs, the nightly backup (`scripts/backup/heartbeat.sh`) and hkha-sync write `heartbeats`.
- **Email:**
  - `worker/src/mailer.ts` sends over Resend, with a 10 s timeout.
  - Resend's free plan allows 100 emails a day and 3,000 a month, and Supabase sign-in codes share that allowance.
  - Eddy caps itself at 70 recipients a day (`DAILY_LIMIT`) and logs every send in `email_log`.
  - Preview sends everything to `MAIL_REDIRECT_TO`.
- **AI:** OpenRouter (`AI_DRAFT_MODEL`, data collection denied, 25 s timeout) drafts review and sponsor text and reads ID documents (`reviewDrafts.ts`, `vision.ts`, `idRead.ts`). Officers always confirm or edit the result.
- **PDFs:** `worker/src/pdf/` collects the data, and the `render-pdf` Edge Function (`supabase/functions/render-pdf`) fills the templates. `PDFS="on"` enables it.

---

## Frontend

- **Routes:** `src/App.tsx`. Sign-in and Player view load with the app. Every other screen is lazy-loaded, and unknown paths go to `/`.
- **Data:** React Query hooks in `src/lib/queries.ts`, over `src/lib/apiClient.ts` (Bearer JWT, plus `X-Eddy-Fresh` after writes). The player page starts its requests in parallel as soon as there is a session.
- **Sign-in:** `@supabase/auth-js` only (`src/lib/supabase.ts`, `src/lib/auth.tsx`), never the whole supabase-js. Turnstile (`src/components/Turnstile.tsx`) is on when `VITE_TURNSTILE_SITE_KEY` is set.
- **One header on every signed-in screen:** `src/components/AppHeader.tsx`, with its rules in `src/lib/header.ts`. It has:
  - the screen's title, which is also the page's `h1` and tab title;
  - a back arrow on child screens;
  - the burger and profile menus;
  - the Player / Coach / Umpire switch.
- **Building blocks:**
  - Components in `src/components/ui/`: ActionButton, Field, Input, Tabs, StatusChip, StepProgress, ErrorState and Sheet.
  - Status colours: `src/styles/status-tokens.css`, `src/lib/statusTone.ts` and `src/lib/availabilityTone.ts`.

  New screens use these, not hand-written classes.
- **Forms:**
  - `useUnsavedChanges` asks before leaving unsaved work.
  - `useDraft` keeps drafts of long forms.
  - `useFormGaps` lists what's missing next to the submit button.
- **Words:** `docs/glossary.md`. Weekly screens carry almost no explanatory text: rules are enforced by which options are shown.
- **PWA** (`vite.config.ts`, Workbox):
  - The app shell is precached.
  - `web-shell/index.ts` answers a missing hashed file with a 404, so a client on an old deploy can recover. `src/lib/staleDeploy.ts` reloads once, then clears the caches.
  - Files opened through signed links (photos, posters) are cached for up to two days. Each new link is a new URL, so a cached copy is never stale.
  - App crashes are reported to the Worker (`src/lib/clientErrors.ts`).

---

## Working rules

### Migrations
- **New files only.** Never edit a migration that has been applied anywhere; a fix is a new file.
- **Version = `YYYYMMDDHHMMSS` in Hong Kong time.** It must be newer than every version on `origin/main`. When several sessions work at once, each uses its own seconds value, so versions can't collide.
- **Version-clash check.** Before applying anywhere:
  - `git fetch origin`, and check that no other file (on main or an open branch) uses your version;
  - if a newer version has merged since, renumber yours first.

  `supabase db push` silently skips a second file with the same version; a 6 Oct 2026 clash had to be repaired with `migration repair`.
- **Preview first:** Claude applies migrations to **eddy-preview** with `npx supabase@2.118.0 db push --db-url <percent-encoded URL> --workdir <checkout>`, through a wrapper that masks the URL.
- **Production is the owner's:** the owner applies to **eddy-production**, and it must be there **before** the PR that needs it merges.
- **CI checks both ends.** `scripts/check-migrations.mjs` rejects duplicate versions, and a PR that adds a migration older than main's newest. The deploy job stops if production lacks any migration in the repo.
- **Keep the database rules whole.**
  - A new table the Worker caches needs a `cache_versions` counter and triggers.
  - A redefinition of `erase_personal_data()` keeps every existing delete.

### Owner-only actions
The owner (Anthony) does these, and Claude asks first:
- anything that writes to production (migrations, data fixes, scripts with `--target=production`);
- GitHub secrets and environments; Cloudflare, Supabase and Resend settings, including Supabase Auth's CAPTCHA and email rate limit;
- approving preview deploys and merging PRs;
- flipping `RETENTION_MODE`; running the July season rollover;
- setting `hkid_hidden`; who is in `SYSTEM_OWNER_IDS`.

Live scripts:
- `scripts/migration/`: `import-kit-order`, `load-quizzes`, `upload-club-doc`, `upload-pdf-template`, `backfill-photo-thumbnails`.
- `scripts/`:
  - `check-migrations.mjs` and `worker-secrets.mjs`, both used by CI;
  - `availability-rule-checks.mjs`, the SQL half of the availability rule cases;
  - `backup/`: dump, restore and heartbeat.

### Branches and PRs
Several sessions share one checkout, so don't switch branches in it. Work in a git worktree off `origin/main`.
- Keep PRs small, with one concern each.
- Branch names start with `feat/`, `fix/`, `ci/` or `docs/`. Only `feat/`, `fix/` and `ci/` can deploy to preview.
- `npm run verify` must be green before you push.

---

## Environments and deploys

| | Production | Preview |
|---|---|---|
| Frontend | `app.eddy.global` (root `wrangler.jsonc`, static assets + `web-shell/`) | local Vite on port 5173 or 5174 |
| API Worker | `hkfc-api` at `api.eddy.global` | `hkfc-api-preview.ant-ford.workers.dev` (`[env.preview]`, no crons) |
| Database | Supabase `eddy-production` | Supabase `eddy-preview`, a copy of real club data |
| Files | R2 `eddy-files` | R2 `eddy-files-preview` |
| Deployed by | `ci.yml` on every merge to `main` | `preview.yml`, run by hand and approved by the owner |

- **Production deploys are CI only.**
  - The Cloudflare token lives in the `production` GitHub environment, which admits only `main`.
  - The deploy job runs in this order:
    1. verifies the code;
    2. checks that production has every migration;
    3. deploys the web Worker;
    4. deploys the API Worker, with `DATA_SUPABASE_SECRET_KEY`, `RESEND_API_KEY` and `OPENROUTER_API_KEY` from that environment (`wrangler deploy --secrets-file`, via `scripts/worker-secrets.mjs`);
    5. deploys the `render-pdf` Edge Function.
  - `CALENDAR_SECRET` is a Worker secret set once.
  - Roll back with `npx wrangler rollback`, or from the Cloudflare dashboard.
- **Preview workflow:**
  1. One preview Worker serves every session, so check what is on it first: `gh run list --workflow preview.yml --limit 3`.
  2. Dispatch with `gh workflow run preview.yml --ref <branch>`, and send the owner the run link to approve. GitHub doesn't notify them about their own runs.
  3. Run `npm run dev:preview-api` (Vite in `preview-api` mode against the preview Worker). CORS admits only `localhost:5173` and `:5174`.
  4. The owner signs in in the browser. Preview data is real, so it's **view only**, apart from test records you create and remove.
- **Frontend env:**
  - `.env.production` and `.env.preview-api` are committed on purpose: they hold only public values. `.env` is local.
  - The variables are `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_TURNSTILE_SITE_KEY`.
- **Local API:** `npm run dev:api` runs the API Worker locally with the preview settings.
- **Windows:**
  - In dev, the Cloudflare Vite plugin is applied to builds only (it deadlocks on Windows).
  - After a local build, a stray `workerd` can hold `dist/`: kill it and delete `dist/`.

---

## Testing

```bash
npm run verify      # typecheck (app, worker, web-shell, legacy-redirect, tests) + vitest + vite build; what CI runs
npx vitest run tests/golden-eligibility.test.ts
```

- Tests are unit tests in `tests/`, one file per module, with no browser and no real database.
- Factories live in `tests/helpers/factories.ts`.
- The data layer is faked in two ways, both explained in `tests/helpers/README.md`:
  - the repositories in `worker/src/data/` are replaced by in-memory fakes (`tests/helpers/fakeRepos.ts`);
  - direct PostgREST calls go to one shared fetch fake (`tests/helpers/postgrest.ts`), which fails a test on any query it doesn't understand.
- **Screens on fictional data:** `node tools/demo/serve.mjs` runs the real app on the demo harness's fixtures, as any persona (`?as=coach`, `?as=mens-convenor`, …). `node tools/demo/smoke.mjs` opens every screen in the table above, as each persona that can open it, and fails on a console error, a request with no fixture, or the error screen. The fixtures are typed against `src/api`, so `npx tsc -p tools/demo` catches a changed response shape. CI runs both on every pull request (`.github/workflows/smoke.yml`). **An endpoint that changes shape needs its fixture changed in the same PR.** See `tools/demo/README.md`.
- SQL functions don't run in the tests. When you change one, test it on eddy-preview inside a transaction that is rolled back. For the availability rules, `scripts/availability-rule-checks.mjs` prints that SQL.
- Must-run tests by module:
  - `eligibility.ts`: `eligibility`, `golden-eligibility` and `recommendations`;
  - `ranking.ts`: `ranking`, `abilityGroup` and `abilityRank`;
  - anything touching availability: the `availability*` and `sameDay*` files, including `availabilityRuleCases`;
  - `auth.ts` or any route: `authorization-routes`; sign-in on the app: `authClientOptions`;
  - retention or any new table that refers to a person: `retentionCoverage`.

---

## Docs index

| Document | What it is |
|---|---|
| [docs/glossary.md](docs/glossary.md) | The words on screen: product and screen names, offices, availability terms, writing rules |
| [docs/HKFC Eligibility & Selection Rules Specification v1.0.md](docs/HKFC%20Eligibility%20%26%20Selection%20Rules%20Specification%20v1.0.md) | The club's eligibility and selection rules, which the engine implements |
| [docs/HKHA Competition Bye-Laws Summary.md](docs/HKHA%20Competition%20Bye-Laws%20Summary.md) | Developer summary of the HKHA bye-laws (source PDF: 10 Sep 2026 edition, alongside it) |
| [docs/Coaches Ranking System.md](docs/Coaches%20Ranking%20System.md) | Section ranking and ability-group spec |
| [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md) | What is removed when, Delete my profile, `hkid_hidden` |
| [docs/RESTORE.md](docs/RESTORE.md) | Backups (nightly to R2), restore drill, restoring production |
| [docs/SEASON_ROLLOVER.md](docs/SEASON_ROLLOVER.md) | The July checklist: dry run, apply, undo |
| [docs/design/HISTORY_AND_NOTICES.md](docs/design/HISTORY_AND_NOTICES.md) | Design and owner decisions for change history and notices |
| [tests/helpers/README.md](tests/helpers/README.md) | How to use the test fakes |
| [tools/demo/README.md](tools/demo/README.md) | The demo harness: the app on fictional data, personas, the screen smoke test, guide screenshots |
| [scripts/migration/README.md](scripts/migration/README.md) | The live data scripts (kit order, quizzes, club docs, PDF templates, photo thumbnails) |
| [docs/supabase-magic-link-email.html](docs/supabase-magic-link-email.html) | The sign-in email template set in Supabase Auth. It deliberately has no link, because mail scanners that follow one burn the code. |
| [docs/CUTOVER.md](docs/CUTOVER.md) | The 2 Oct 2026 Airtable → Supabase switch-over runbook (record) |
| [docs/migration/FIELDS.md](docs/migration/FIELDS.md) | Which Airtable fields became which columns (record) |
| [docs/archive/](docs/archive/) | Historical reviews, the cleanup prompt and report, and the original roadmap. Not current. |
