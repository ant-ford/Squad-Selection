# Demo harness

Eddy's real frontend on fictional data. Use it for:
- the user guides' screenshots;
- trying a screen as someone else;
- the screen smoke test in CI.

Nobody signs in, and nothing reaches a real API or database.

**Fictional data only.** The repository and the guides are public. Never copy preview or production data into the fixtures, the screenshots or a PR.

## Run it

```bash
node tools/demo/serve.mjs          # http://127.0.0.1:5190, or: node tools/demo/serve.mjs 5195
```

Open any screen with `?as=<persona>`, for example http://127.0.0.1:5190/coach?as=coach. The tab keeps the persona as you move around, until another `?as=` changes it. Add `?signedout` to see the sign-in screen. A fixture can offer other states for screenshots as variants after a colon: `player:kit-offered` (a captain says they've handed over your kit), `player:kit-holding` (you're holding a team's kit), `player:checkin-open` (an event's check-in page is open) and `section-captain:charges-sent` (the treasurer's list has gone).

For the Claude desktop app, the `.claude/launch.json` entry is:

```json
{ "name": "eddy-demo", "runtimeExecutable": "node", "runtimeArgs": ["tools/demo/serve.mjs", "5190"], "port": 5190 }
```

| Persona | Who | Opens |
|---|---|---|
| `player` | Sam Carter, HKFC C | Player view, My details, Stats, Quizzes |
| `coach` | Jo Bennett, coach of HKFC C and D | Coach view, Season plans, Volunteers |
| `section-captain` | Alex Morgan | Everything a Section Captain opens, including Umpire view as coordinator |
| `mens-convenor` | Chris Tam | HKHA registration, People, Suspensions, Data checks |
| `membership-officer` | Daniel Price | Membership, People |
| `kit-convenor` | Dan Marsh | Kit |
| `umpire-coordinator` | Graham Holt | Umpire view, running the duties |
| `umpire` | Ravi Patel, a club umpire | Umpire view |
| `social-secretary` | Will Ashford, HKFC C's social secretary | Events |

## How it works

- **`server.mjs`** starts Vite with the repo's own `vite.config.ts`, plus **`plugin.mjs`**. It sets `VITE_API_URL` to `/demo-api`, which overrides any local `.env`.
- **`plugin.mjs`** does two things:
  - it swaps `src/lib/supabase.ts` for **`fakeSupabase.ts`**, which is always signed in;
  - it answers `/demo-api/*` from **`fixtures/`**.
- **Personas** (`personas.mjs`) ride in the fake access token (`Bearer demo.<persona>`), so the server keeps no state, and two tabs can be two people. A persona's offices decide its officer sections. `SECTION_OFFICES` there mirrors `worker/src/auth.ts`.
- **`fixtures/`** has one file per area: `player`, `coach`, `officers`, `people`, `kit`, `events`, `umpiring` and `stats`. Each exports `routes`, a map from `'GET /api/path/:param'` to a handler. A handler returns the response body, or `reply(status, body)` for an error.
  - `data.ts` holds the shared cast and the dates. Dates are relative to today.
  - `assets/` holds fictional images the fixtures use (event posters), served at `/demo-assets/`.
  - Vite loads the fixtures on each request, so an edit shows on the next reload, with no restart.
- **A request no fixture answers** gets a 404 with an `X-Demo-Missing` header, and a `MISSING` line in the server log.

## When an endpoint changes shape, change its fixture in the same PR

Each fixture's body is typed with the app's own response type (`src/api/*`, `shared/*`). Two checks catch a fixture that has fallen behind:

```bash
npx tsc -p tools/demo                 # the fixtures against the app's types
node tools/demo/smoke.mjs             # every screen, as every persona that opens it
```

A new endpoint that a screen calls on load needs a fixture, or the smoke test fails with `no fixture: …`. A new screen in README's "Screens and who opens them" table needs a line in **`screens.mjs`**.

## The smoke test

`smoke.mjs` serves the app on the fixtures and opens every screen in `screens.mjs`, as each persona that opens it, at phone width in headless Chrome or Edge. It runs four tabs at once. A screen fails on:
- an uncaught exception or a `console.error` (React's warnings included);
- a request with no fixture, any 4xx or 5xx, a failed request, a request anywhere but the demo server, or a crash report (`POST /api/client-error`);
- the error screen ("Something went wrong"), an error box, the sign-in screen, being sent to another screen, or no screen title.

```bash
node tools/demo/smoke.mjs --only coach --as section-captain   # a subset, by path or screen name
```

`node tools/demo/ranking-stats-smoke.mjs` checks the simplified ranking rows, saved stats compilation times in HKT, comparisons through the same date last season, completed seasons and missing prior-period data. CI runs it and saves phone and desktop screenshots in `ui-review-screenshots`.

`node tools/demo/availability-notes-smoke.mjs` checks the coach's attendance grid and required player notes: drafts, cancellation, failed-save retry, same-day choices, whole-day and goalkeeper shortcuts, and availability preferences. Every write uses fictional responses. CI runs it and saves review screenshots in `ui-review-screenshots`.

- In Git Bash, `--only /people` is rewritten into a Windows path: use `--only People`, or set `MSYS_NO_PATHCONV=1`.
- Screenshots of failing screens go to `--out` (default `<temp>/eddy-smoke`).
- `CHROME_PATH` picks the browser. The driver, `cdp.mjs`, talks the DevTools protocol over Node's built-in WebSocket, so it needs no npm package.

CI runs it on every pull request (`.github/workflows/smoke.yml`).

## Guide screenshots

The user guides (the eddy-site repository, published at eddy.global/guides) are screenshotted from here, at phone width:

```bash
node tools/demo/shots/run.mjs players ../eddy-site/guides/img       # or: --only home
```

Each guide has a spec in `shots/`: a list of shots, each with a persona, a path, optional steps (open a menu or a sheet), and the viewport, the full page or an element to capture. The runner saves WebP files under the shot's name, so a refresh is one command per guide.

## Gotchas

- **Windows:** the repo path must be the long name (`anthony.ford`, not `ANTHON~1.FOR`), or Vite's file watcher crashes. `server.mjs` resolves it.
- **Worktrees:** a worktree with a `node_modules` junction works. `server.mjs` allows Vite to serve the junction's target.
- **Builds:** don't run `vite build` in the same checkout while the demo server runs, because the build hangs.
