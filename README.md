# Eddy (HKFC Squad Selection)

Eddy is the Hong Kong Football Club men's hockey section's web app. It covers player availability, squad selection, the section ranking and eligibility for eight league teams, plus the section's membership work: applications and signing, commitment reviews, waivers, kit, season plans, volunteering, events, umpiring duties, HKHA registration and club stats.

- App: https://app.eddy.global (a phone-first PWA). API: https://api.eddy.global.
- Repo: `ant-ford/Squad-Selection`. Results come from a separate repo, `ant-ford/hkha-sync`.

**For AI sessions:** this README and the code are the current truth. Everything under `docs/archive/` is history. Read [Working rules](#working-rules) before changing anything.

---

## Architecture

```
 Browser (React 19 + Vite PWA, app.eddy.global)
   │  Supabase Auth only: email one-time code -> session JWT
   │  every data call: HTTPS + Bearer JWT
   ▼
 API Worker  (worker/src, Cloudflare Workers free plan, api.eddy.global)
   │  verifies the JWT, finds the person, applies every business rule
   │  in-memory + KV cache · crons · email (Resend) · AI drafts (OpenRouter)
   ├──► Supabase Postgres via PostgREST (secret key)   eddy-production / eddy-preview
   ├──► R2 bucket FILES (photos, IDs, signatures, PDFs) eddy-files / eddy-files-preview
   └──► Supabase Edge Function render-pdf (fills PDF templates)

 hkha-sync (GitHub Actions, other repo) ──► writes fixtures and results to Postgres
 backup.yml (GitHub Actions) ──► nightly encrypted pg_dump to R2 eddy-backups
```

- **Browser (`src/`).** Presentation only. It talks to Supabase for sign-in and to the Worker for everything else. It never reads tables, and never decides eligibility, play-up counts or rankings.
- **Worker (`worker/src/`).** The authoritative backend. Free plan limits shape the code: **10 ms CPU and 50 subrequests per request or cron run**. Every Postgres call, R2 call and email is a subrequest, and long jobs work in capped batches.
- **Postgres.** All club data since the switch from Airtable on **2 Oct 2026**. Multi-row writes that must succeed together are SQL functions called through `rpc()`, so each is one transaction.
- **Shared code (`shared/`).** Rules and formats used by both sides (display team, ability groups, stages, profile field specs, etc.). `worker/src` must not import `src/`, and `src/` must not import `worker/`.

### Airtable (legacy, being removed in October 2026)

Airtable stopped being read or written on 2 Oct 2026, and its subscription ends on 20 Oct 2026. Until the removal PRs land, the Worker still contains Airtable code:
- `worker/src/airtable.ts`;
- the Airtable halves of `worker/src/data/*.ts`;
- `backendFor(...) === "airtable"` branches;
- `shared/mappers`.

Production runs `DATA_BACKEND="supabase"`. Treat Airtable branches as dead, and don't add to them.

What stays for good:
- **`rec…` ids.** Imported rows keep their Airtable id in `airtable_id`, and every public id is `api_id = coalesce(airtable_id, id::text)`. Calendar feed URLs, `/join?ref=`, `/review/:id` links in sent emails and bookmarked matches all carry `rec…` ids. Rows created in Eddy have uuid ids.
- **The `archive` schema** holds the raw Airtable JSON until it's dropped after 20 Oct. Nothing new may depend on it.

---

## Data model (Supabase Postgres)

Schema = `supabase/migrations/*.sql`, applied in version order. RLS is on for every table with **no policies and no grants to `anon`/`authenticated`**, so only the service role can read or write. The Worker authenticates with the project's secret key (`DATA_SUPABASE_SECRET_KEY`) and goes through `worker/src/data/supabase.ts` (paging, a retry on 500/502/503/504, `SupabaseError`).

| Area | Tables |
|---|---|
| People and offices | `people`, `offices`, `team_people`, `family_members`, `relatives`, `previous_clubs`, `shirt_numbers` |
| Teams and fixtures | `teams`, `matches`, `match_cards`, `match_selections`, `hkha_sync_state` |
| Availability | `availability_exceptions`, `availability_rules` |
| Ranking | `ranking_events`, `ability_group_config` |
| Membership | `applications`, `signatures`, `commitments`, `declarations`, `steps`, `registration_events` |
| Trials and joiners | `trial_sessions`, `trial_availability`, `applicant_trials` |
| Season | `season_plans`, `season_plan_options`, `course_signups` |
| Kit | `kit_orders`, `kit_sets`, `kit_moves`, `kit_sizes` |
| Events | `events`, `event_responses`, `event_payments` |
| Umpiring and HKHA | `umpire_duties`, `umpire_assignments`, `hkha_registrations` |
| Quizzes | `quizzes`, `quiz_scores` |
| Messages and logs | `email_log`, `message_templates`, `message_log`, `activity_log`, `files` |

- **Views.** `api_*` views (`api_players`, `api_matches`, `api_match_cards`, `api_people_crm`, `api_reviews`, …) are the shapes the Worker reads, and carry `api_id`. `*_v` views are derived reads (`people_v`, `commitments_v`, `kit_sets_v`, `reviews_due_v`, `retention_due_v`, …).
- **Functions (RPCs).**
  - Selection and ranking: `set_match_selection`, `update_people_ranks`, `insert_ranking_events`, `apply_availability_changes`.
  - Reviews: `start_review`, `submit_member_report`, `submit_sponsor_review`, `submit_officer_review`.
  - Applications and declarations: `submit_application`, `sign_application`, `submit_declarations`, `submit_season_plan`.
  - Kit: `kit_allocate`, `kit_move`, `kit_confirm`, `kit_swap`.
  - Profiles and retention: `delete_own_profile`, `erase_personal_data`, `retention_stamp`.
- **Triggers.** `updated_at` on every mutable table, plus the rules that live in the database:
  - automatic re-registration after the last allowed play-up (`match_cards_auto_reregister`);
  - linking match cards to people;
  - stamping `inactive_since` and the membership stage;
  - commitment periods.
- **Files.** In R2 (binding `FILES`), referenced from `files`. The browser only ever gets short-lived signed links (`worker/src/files.ts`). Club documents with personal data are private R2 objects served behind sign-in (`/api/club-docs/:name`), never `public/docs`.

The data access seam is `worker/src/data/`: one repository per module (people, teams, officers, matches, matchCards, availabilityExceptions, availabilityRules, abilityGroups, rankingEvents, membershipEvents, commitments). Newer features call PostgREST directly from their own module (`kit.ts`, `events.ts`, `apply.ts`, …).

---

## Where business rules live

| Rule | Place |
|---|---|
| Eligibility (fixed 7-step order, exact reason strings, `RULE_IDS`) | `worker/src/eligibility.ts`; golden matrix `tests/golden-eligibility.test.ts`; spec `docs/HKFC Eligibility & Selection Rules Specification v1.0.md` |
| Play-up counting and allowances (3, or 8 for U21) | `worker/src/playUp.ts`, `shared/playUpAllowance.ts`; re-registration trigger in migration `20261003090000` |
| Suspensions (Bye-Law 16.3 card points) | `worker/src/suspension.ts` |
| Section ranking, ability groups | `worker/src/ranking.ts`, `shared/abilityGroup.ts`, `shared/abilityRank.ts`; spec `docs/Coaches Ranking System.md` |
| Recommendations (advisory, never auto-select) | `worker/src/recommendations.ts` |
| Squad saves, derby safety, higher-team priority | `worker/src/squad.ts` + `set_match_selection()` |
| Availability (exception-based, standing rules, Opt-In Only) | `worker/src/availability.ts`, `worker/src/availabilityRules.ts` |
| Sign-in and access (who is a player, coach, officer, applicant) | `worker/src/auth.ts` |
| Membership stages, applications, signing order | `shared/membershipStages.ts`, `worker/src/apply.ts`, `worker/src/applicationSigning.ts`, SQL `sign_application()` |
| Commitment reviews and their emails | `worker/src/reviews.ts`, `worker/src/reviewEmails.ts`, `worker/src/reviewDrafts.ts` |
| Data retention (13 months), Delete my profile | `worker/src/retention.ts`, SQL `retention_stamp()` / `erase_personal_data()`; `docs/DATA_RETENTION.md` |
| Displayed team (optics only) | `shared/displayTeam.ts`: Selected Team EOS, then SOS, then the true registered team |

**Invariants. Don't break these:**
1. Eligibility runs in a fixed order, and its reason strings and `RULE_IDS` never change: add new ones, never edit existing ones. If a golden test fails, don't deploy.
2. Every selection write is revalidated in the Worker. The client is never trusted.
3. Section Rank is the only stored ranking. Team rank, positional rank and ability are derived.
4. Availability is exception-based: no record means Available. An `Available` record is stored only where something else (a standing rule, or Opt-In Only) would otherwise give a different answer. `needsExplicitAvailable()` decides that.
5. The play-up GK exemption comes from the match card's Goalkeeper flag, never the player's position. Team order comes from `teams.team_rank`, never names.
6. The displayed team is optics. Every rule uses the true registered team.
7. Read fresh on write paths (no cache), and invalidate caches after writes.

---

## Worker internals

- **Routing:** `worker/src/index.ts`. Every `/api` route needs a verified Supabase session. Coach and officer routes check `AuthorizedUser` from `auth.ts`, and registering to join needs only a verified email. The only routes without a session are `/health`, signed stored-file links (`files.ts`) and the HMAC-signed `.ics` calendar feeds. `tests/authorization-routes.test.ts` pins this.
- **Caching:** `worker/src/cache.ts` keeps a per-isolate memory cache plus KV (`CACHE`). Writes invalidate the affected keys. The club stats summaries live in KV.
- **Request stats:** `worker/src/requestContext.ts` counts database calls, bytes and wait time. The figures go out as a `Server-Timing` header and one log line per request.
- **Crons:** `scheduled()` in `index.ts`, at 03:00 UTC (11:00 HKT; commitment review emails) and 03:30 UTC (retention, `RETENTION_MODE` = `report` until the owner flips it to `remove`).
- **Email:** `worker/src/mailer.ts` over Resend. Resend's free plan allows 100 emails a day and 3,000 a month, and Supabase sign-in codes share that allowance. Eddy caps itself at 70 recipients a day (`DAILY_LIMIT`) and logs every send in `email_log`. Preview sends everything to `MAIL_REDIRECT_TO`.
- **AI:** OpenRouter (`AI_DRAFT_MODEL`, data collection denied) drafts review and sponsor text and reads ID documents (`reviewDrafts.ts`, `vision.ts`, `idRead.ts`). Officers always confirm or edit the result.
- **PDFs:** `worker/src/pdf/` collects the data and has the `render-pdf` Edge Function (`supabase/functions/render-pdf`) fill the templates. `PDFS="on"` enables it.

---

## Working rules

### Migrations
- **New files only.** Never edit a migration that has been applied anywhere; a fix is a new file.
- **Version = `YYYYMMDDHHMMSS` in Hong Kong time.** It must be newer than every version on `origin/main`. When several sessions work at once, each uses its own seconds value, so versions can't collide.
- **Version-clash check:** before applying anywhere, `git fetch origin` and check that no other file (on main or an open branch) uses your version. If a newer version has merged since, renumber yours first. `supabase db push` silently skips a second file with the same version; a 6 Oct 2026 clash had to be repaired with `migration repair`.
- **Preview first:** Claude applies migrations to **eddy-preview** with `npx supabase@2.118.0 db push --db-url <percent-encoded URL> --workdir <checkout>`, through a wrapper that masks the URL.
- **Production is the owner's:** the owner applies to **eddy-production**, and it must be there **before** the PR that needs it merges, because a merge deploys at once.
- CI rejects duplicate versions, and rejects a PR that adds a migration older than main's newest.

### Owner-only actions
The owner (Anthony) does these, and Claude asks first:
- anything that writes to production (migrations, data fixes, scripts with `--target=production`);
- GitHub secrets and environments; Cloudflare, Supabase and Resend settings;
- approving preview deploys and merging PRs;
- flipping `RETENTION_MODE`;
- setting `hkid_hidden`.

Never run `scripts/migration/import-airtable.mjs` again: production has data written since the switch-over. The live scripts in `scripts/migration/` are `import-kit-order`, `load-quizzes`, `upload-club-doc` and `upload-pdf-template`.

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

- **Production deploys are CI only.** The Cloudflare token lives in the `production` GitHub environment, which admits only `main`. The deploy job uploads the Worker's secrets from that environment. Roll back with `npx wrangler rollback`, or from the Cloudflare dashboard.
- **Preview workflow:**
  1. One preview Worker serves every session, so check what is on it first: `gh run list --workflow preview.yml --limit 3`.
  2. Dispatch with `gh workflow run preview.yml --ref <branch>`, and send the owner the run link to approve. GitHub doesn't notify them about their own runs.
  3. Run `npm run dev:preview-api` (Vite in `preview-api` mode against the preview Worker). CORS admits only `localhost:5173` and `:5174`.
  4. The owner signs in in the browser. Preview data is real, so it's **view only**, apart from test records you create and remove.
- **Frontend env** (`.env`, `.env.preview-api`, `.env.production`, not committed): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`.
- **Windows:** in dev, the Cloudflare Vite plugin is applied to builds only (it deadlocks on Windows). After a local build, a stray `workerd` can hold `dist/`: kill it and delete `dist/`.

---

## Testing

```bash
npm run verify      # typecheck (app, worker, web-shell, legacy-redirect, tests) + vitest + vite build; what CI runs
npx vitest run tests/golden-eligibility.test.ts
```

- Tests are unit tests in `tests/`, one file per module, with no browser and no real database.
- Factories live in `tests/helpers/factories.ts`.
- The Supabase path is tested with fakes of `fetch` for PostgREST, and of the repositories in `worker/src/data/`. Some older tests still drive the legacy fake Airtable (`tests/helpers/airtable.ts`); they're being rewritten in October 2026.
- Must-run tests by module:
  - `eligibility.ts`: `eligibility`, `golden-eligibility` and `recommendations`;
  - `ranking.ts`: `ranking`, `abilityGroup` and `abilityRank`;
  - anything touching availability: the `availability*` and `sameDay*` files.

---

## Docs index

| Document | What it is |
|---|---|
| [docs/HKFC Eligibility & Selection Rules Specification v1.0.md](docs/HKFC%20Eligibility%20%26%20Selection%20Rules%20Specification%20v1.0.md) | The club's eligibility and selection rules, which the engine implements |
| [docs/HKHA Competition Bye-Laws Summary.md](docs/HKHA%20Competition%20Bye-Laws%20Summary.md) | Developer summary of the HKHA bye-laws (source PDF: 10 Sep 2026 edition, alongside it) |
| [docs/Coaches Ranking System.md](docs/Coaches%20Ranking%20System.md) | Section ranking and ability-group spec |
| [docs/DATA_RETENTION.md](docs/DATA_RETENTION.md) | What is removed when, Delete my profile, `hkid_hidden` |
| [docs/RESTORE.md](docs/RESTORE.md) | Backups (nightly to R2), restore drill, restoring production |
| [docs/CUTOVER.md](docs/CUTOVER.md) | The 2 Oct 2026 Airtable → Supabase switch-over runbook (record) |
| [docs/migration/FIELDS.md](docs/migration/FIELDS.md) | Which Airtable fields became which columns |
| [scripts/migration/README.md](scripts/migration/README.md) | The live data scripts (kit order, quizzes, club docs, PDF templates) |
| [docs/archive/](docs/archive/) | Historical reviews, the cleanup prompt and report, and the original roadmap. Not current. |
