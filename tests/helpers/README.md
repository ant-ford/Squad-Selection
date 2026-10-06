# Test helpers

| File | What it fakes |
| --- | --- |
| `fakeRepos.ts` | Every repository in `worker/src/data/*.ts` (people, teams, officers, matches, matchCards, availabilityExceptions, availabilityRules, abilityGroups, rankingEvents, membershipEvents, commitments), in memory, and sign-in's `auth_context` call (`authContexts` in `worker/src/authContext.ts`), answered from the same people, teams and officers. A seeded person may carry `uuid`, `umpire` and `crm.profileUpdatedAt`; `db.signedIn(email)` builds the user auth.ts would for them. |
| `postgrest.ts` | Supabase's PostgREST API (`/rest/v1/...`) behind `global.fetch`, for code that calls `db(env)` from `worker/src/data/supabase.ts` directly. |
| `rankingDb.ts` | The real ranking repositories against `postgrest.ts`, seeded for the ranking tests. |
| `factories.ts` | Domain objects: `person`, `team`, `match`, `matchCard`, `exception`, `rule`, `abilityGroup`, `office`, `commitment`, `signedIn({ email, ... })` for a signed-in user as auth.ts builds it, and `recId(label)` for valid ids. `p`/`t`/`m`/`mc` are the eligibility tests' builders. Leave them as they are. |
| `kv.ts` | The CACHE KV binding (only the Stats summaries use it). |

`tests/testFakes.test.ts` pins down how the fakes behave. If you extend a fake, add a case there.

## Writing a test against the data

Keep every assertion about behaviour. A test file that changes what a rule asserts says why in a comment and in its PR.

### 1. Env

```ts
import { SUPABASE_TEST_ENV } from "./helpers/postgrest";
const ENV = { ...SUPABASE_TEST_ENV } as unknown as Env;   // DATA_SUPABASE_URL, DATA_SUPABASE_SECRET_KEY
```

Add anything else the code reads (`SUPABASE_URL` for sign-in, `CALENDAR_SECRET`, ...).

### 2. Install the repositories

```ts
import { useFakeRepos } from "./helpers/fakeRepos";
import { person, team, match, exception, recId } from "./helpers/factories";

const db = useFakeRepos(() => ({            // seeded fresh before every test
  people: [person({ id: ALICE, email: "alice@x.com", registeredTeam: "B" })],
  teams: [team({ teamName: "B", teamRank: 2 })],
}));

beforeEach(() => invalidateAll());          // the module caches still need clearing
```

- Inside a test, `db.state.<repo>` holds the arrays. Push to them, or replace everything with `db.reset({ ... })`.
- Writes change those arrays, so assert on them directly, e.g. `expect(db.state.availabilityExceptions[0].updatedBy).toBe(COACH)`.
- `db.calls` and `db.callsTo("people", "getMyTaskFields")` record every repository call, with its arguments.
- To make a call fail: `vi.spyOn(db.repos.matches, "listForSeason").mockRejectedValue(new SupabaseError("Supabase 500", 500))`. Keep the assertion about what the user sees.
- Need it imperatively? `installFakeRepos(seed)` returns the same handle. Call `.restore()` afterwards.

How it works: it spies on each module's accessor (`people(env)`, `teams(env)`, ...), which is why the data modules keep those accessors. The repositories behave like the Supabase ones in `worker/src/data/supabase/*`: the same filters, the same rule that a blank counts as different for `!=`, and the same "No person <id>" error.

### 3. Seed records

Each table is a factory call keyed by domain names.

| Table | `db.state.` key | factory | notes |
| --- | --- | --- | --- |
| People | `people` | `person()` | Player fields at top level. The officer-section columns (`membershipNo`, `joinDate`, `commitmentEndDate`, `waiversSubmittedAt`, `sponsoredBySponsor`, attachment `photo`...) go under `crm: {...}`, named as in the field lists in `data/people.ts` and `MEMBERSHIP_FIELDS`/`CHAIRMAN_FIELDS` (`shared/schema/fieldMaps.ts`). A birthday is `birthday: "MM-DD"`, or `crm.dateOfBirth` for the row views. |
| Teams | `teams` | `team()` | `coach`, `teamCaptain` etc. are id arrays. |
| Matches | `matches` | `match()` | `matchDate`; `selectedPlayersHome` / `selectedPlayersAway`. |
| Match Cards | `matchCards` | `matchCard()` | |
| Availability Exceptions | `availabilityExceptions` | `exception()` | `player`/`match` are arrays; `season` must be set (`listForSeasons` filters on it); `updatedBy` is a plain id string. |
| Availability Rules | `availabilityRules` | `rule()` | |
| Ability groups | `abilityGroups` | `abilityGroup("A", 10)` | |
| Ranking events | `rankingEvents` | plain `RankingEventRow` | |
| Membership events | `membershipEvents` | (written only) | |
| Commitments | `commitments` | `commitment()` | Named as in `COMMITMENT_FIELDS`/`REVIEW_TASK_FIELDS`. Lookups may stay one-element arrays. |
| Sponsors, Section Chairs, Membership Officers, Section Captains (+ Kit Convenor, Hockey Convenor, Assistant Director, Umpire Coordinator) | `officers` | `office("sponsor", personId, { designation })` | Each row has one `member`. `status` defaults to `"Active"`. The row `id` is what applicants' `sponsoredBy*` links point to. |

What the repositories hand back:

- Domain objects come out as copies, shaped like the Supabase mappers' output. An empty string reads as "not set", and Player `teamRank`/`positionalRank` are never returned.
- Seed only what the test needs. The factories fill the rest with the mapper's defaults.

**Ids.** Anything that passes through `isRowId()` must be `rec` plus 14 characters, or a uuid. Use `recId("Alice")`, which gives `"recAlice000000000"`. Short ids like `"recA"` or `"p1"` are quietly refused (for example, `getMyTasks` returns `[]`). Ids the repositories create are uuids.

### 4. Assertions

- On state: `db.state.people[0].sectionRank`, `db.state.availabilityExceptions[0].updatedBy`.
- On reads: `db.callsTo("people", "listApplicantsAtStages")`, and `db.callsTo(repo, method)[0].args` for what was asked.
- The columns a read selects belong to the repositories; `tests/dataSupabase*.test.ts` checks them. In other tests, assert on the response instead (e.g. `expect(body).not.toContain("A123456")`).
- Cache invalidation after a write: call the module's own invalidation (`invalidatePeople`, `invalidateCommitments` in `worker/src/invalidation.ts`), or `invalidateAll()`.

### 5. Code that queries Supabase directly

Some modules call `db(env)` themselves: myTasks, events, umpiring, volunteerAccess, eventAccess, seasonPlan, joiners, applicationSigning, kit, and others. `getMyFixtures` reaches several of them. Add the PostgREST fake next to the repositories:

```ts
import { fakePostgrest, type FakePostgrest } from "./helpers/postgrest";
let pg: FakePostgrest;
beforeEach(() => {
  pg = fakePostgrest({
    tables: { people: [{ id: "u1", api_id: ALICE, active: true }], offices: [], team_people: [] },
    relations: { "team_people.teams": { table: "teams", from: "team_id", to: "id", kind: "one" } },
    rpc: { current_season: () => "2026-2027" },
    other: (url) => new Response(JSON.stringify({ email: "a@x.com" })),   // non-PostgREST fetches, e.g. /auth/v1/user
  });
});
```

- Rows use Postgres column names (snake_case), as the code selects them.
- `pg.tables`, `pg.calls`, `pg.reads(table)`, `pg.writes(table)` and `pg.rpcCalls(fn)` are for assertions.
- `handlers: { table: (req) => Response | body | undefined }` overrides one table. Use it to inject failures.
- `defaults: { table: (row) => ({ id: "f0", ...row }) }` controls the ids that inserts generate.

**Repos and PostgREST are separate stores.** If the code reads the same person both ways, seed both consistently. The repositories use the `api_id` (`recId(...)`). PostgREST rows have their own uuid `id` plus `api_id`.

**It fails loudly.** The fake treats each of these as a *problem*:

- an unknown table, operator, select syntax, embed or RPC;
- a filter or order on a column that no seeded row has.

The request gets a 400. The test also fails when it finishes, even if the code caught the error: `canManageEvents` and `umpiringAccess` swallow failures, for example. Read the message, then seed the table, the column (null is fine) or the relation. Don't loosen the fake. To make a test expect a problem, assert on `pg.problems` and then empty it.

Unlike hand-rolled fakes, filters apply. A row the real query would not return is not returned. Seed the columns the code filters on (`active: true`, `api_id`, `person_id`, ...).

`db(env).select()` always adds its paging key to `order=`. That key is `id`, or the `key` argument (e.g. `person_id,session_id`). So every seeded row of a table read with `select()` needs that column.

### 6. Check

1. Run the file: `npx vitest run tests/<file>.test.ts`.
2. Run `npm run verify`.

The worked examples:

| File | What it shows |
| --- | --- |
| `tests/coachAvailability.test.ts` | Repositories only. |
| `tests/displayTeam.test.ts` | Repositories plus direct PostgREST reads. |
| `tests/seasonPlan.test.ts`, `tests/apply.test.ts` | PostgREST fakes. |
