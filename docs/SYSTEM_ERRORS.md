# Screen recovery and System errors

## Screen-loading recovery

Vite's preload-error event must keep its default behaviour: cancelling it
turns a rejected import into a promise fulfilled with undefined. React.lazy
then crashes trying to read that module's default export.

The original failure now reaches the error boundary while recovery runs.
The first failure reloads; a second failure unregisters the service worker
and clears caches before reloading. Recovery stops after those two attempts
in a tab, or immediately if browser storage is unavailable. Only an
unrecovered failure is reported, once per page load. CSS preload failures
use the same recovery path.

## System

The Errors section defaults to the last 24 hours, with 7- and 30-day history.
Database function system_error_groups counts the whole selected period
before limiting its response to the 50 most recently seen issues.
Each issue includes occurrence counts, first/latest occurrence in that
period, affected routes, build counts, and up to five recent examples.
The screen says when routes or builds are truncated.

Known screen-loading messages, including the old React default-export
failures, share an issue across affected screens. Other errors group by
source, HTTP status, original message and route, with UUID and Airtable
record ids normalised in the grouping key only. Original routes and messages
remain in the examples. Similar messages are symptoms, not proof that their
underlying causes are identical.

New browser reports include the app build and browser family/major version,
never a full user agent. The Worker validates these fields, retains its
existing message/stack scrubbing, and uses the existing bounded detail JSON.
Older reports remain readable, with missing metadata labelled explicitly.
Build counts help check whether a failure recurs on a version containing a
fix; silence does not automatically mark an issue resolved.

Access remains limited to the System owner and Section Captains through the
Worker. The new database function is read-only and executable only by the
service role. Existing logging, rate limits and 90-day pruning are unchanged.
The legacy latest-50-errors field remains for older app clients. A newer app
talking to an older API shows an explicit ungrouped fallback.

## Validation

Use Node.js 24 and Chrome/Chromium, with CHROME_PATH if the browser is not
at a standard location:

    npm run verify
    npx tsc -p tools/demo
    node tools/demo/recovery-smoke.mjs
    node tools/demo/system-smoke.mjs
    node tools/demo/smoke.mjs

The recovery test builds production React/Vite with the actual recovery
modules, then fails real screen JS/CSS requests. It checks successful
recovery, bounded reloads, cache/service-worker clearing, original errors,
and blocked browser storage. The System test uses fictional fixtures only.
Both are included in the screen-smoke CI workflow.

The pgTAP file supabase/tests/system_error_groups.test.sql covers complete
counts beyond 50 reports, browser variants, history, metadata privacy,
permissions and the 50-group response limit. Run it against the local
Supabase database with the repository's SQL-test workflow.

## Rollout

This change adds migration 20261009231003_system_error_groups.sql; it changes
no existing tables or stored data. Before applying anywhere, fetch main and
check migration versions for collisions, following README's migration rules.
Test the migration and Worker in preview first.

### Run preview checks from GitHub

No local Node, Supabase CLI or database client is needed. In GitHub Actions,
open **Preview API**, select branch `fix/screen-recovery-system-errors`, and
run/approve the workflow. Selecting this branch includes the migration and
database tests automatically. Other branches keep their normal API preview
steps. Use the existing workflow without new dispatch inputs so this is
available before the feature branch is merged into main.

The owner must put `PREVIEW_DB_URL` in the GitHub **preview** environment if
it is not there already. Use the eddy-preview PostgreSQL connection URL
(percent-encoded password), preferably the session pooler URL from Supabase's
Connect panel. The backup-preview environment already uses a secret with
this name; GitHub does not share secrets between environments. Do not put
the URL in a workflow input, source file or issue.

The workflow verifies recovery/System UI on fictional data, checks that the
database URL identifies eddy-preview, and refuses other pending or unknown
migration versions. It dry-runs and applies only the System migration using
the pinned Supabase CLI, verifies recorded history, and runs its 24 pgTAP
assertions. Test rows and any temporary pgTAP extension are rolled back.
An already-applied migration is not applied again; its tests are rerun.
Database output is withheld because error messages can include credentials
or row values. A successful database check is required before API deployment.

The same preview Worker is shared by all branches. Runs queue rather than
interrupting a migration in progress. This workflow does not apply anything
to production; the owner still applies the production migration before merge.

The owner must apply this migration to production before merging/deploying
the API that uses it. Production deploys remain CI only. Then deploy the API
and frontend. New build/browser metadata appears only on new reports;
historical metadata cannot be reconstructed.
