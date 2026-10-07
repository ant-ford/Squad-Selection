// The SQL half of the availability rule cases (tests/availabilityRuleCases.test.ts
// is the TypeScript half). Prints SQL that runs every case in
// tests/fixtures/availabilityRuleCases.json through availability_rule_status()
// and set_availability() and reports any case where the database disagrees.
// Two forms:
//
//   node scripts/availability-rule-checks.mjs > checks.sql
//
// for a real database (preview): run checks.sql after the migration INSIDE A
// TRANSACTION THAT IS ROLLED BACK (it rewrites one real player's rules and
// Opt-In Only and adds matches). Output: one row of totals, then one row per
// case that disagrees (none expected).
//
//   node scripts/availability-rule-checks.mjs --tap supabase/tests/availability_rule_cases.test.sql
//
// writes a pgTAP test for the empty CI database (.github/workflows/sql-tests.yml,
// `npm run test:sql`): it adds teams HKFC A-H (ranks 1-8) and one Active HKFC D
// player first, then runs the same checks, one test per case. The file is
// generated, never committed, so the cases have one home: the JSON.
//
// Either way it picks an Active player of HKFC D (rank 4) and, per case, a
// Scheduled match against HKFC A (a play-up), HKFC H (a support game) or HKFC
// D, at noon Hong Kong time on the case's day, as the TypeScript test does. A
// case that is both a play-up and a support game cannot be built from ranks,
// so only its rule status is checked.
//
// The DO block is a single line so that tools splitting a checks file on ";"
// + newline keep it whole.

import { readFileSync, writeFileSync } from "node:fs";

const { cases } = JSON.parse(readFileSync(new URL("../tests/fixtures/availabilityRuleCases.json", import.meta.url), "utf8"));
/** The TypeScript test uses the same default. */
const DEFAULT_LAST_MODIFIED = "2026-09-01T00:00:00.000Z";

const withDefaults = cases.map((c) => ({
  ...c,
  rules: c.rules.map((r) => ({ ...r, lastModified: r.lastModified ?? DEFAULT_LAST_MODIFIED })),
}));
const json = JSON.stringify(withDefaults).replace(/'/g, "''");

const body = `
do $chk$
declare
  c jsonb; i integer := 0; v_player uuid; v_api text; v_match text; v_date date; v_status text; v_stored boolean;
  v_up boolean; v_sup boolean;
begin
  select id, api_id into v_player, v_api from public.people where active and registered_team = 'HKFC D' order by api_id limit 1;
  if v_player is null then raise exception 'no Active HKFC D player on this database'; end if;
  create temp table rule_case_results (n integer, name text, want_status text, got_status text, want_store boolean, got_store boolean) on commit drop;
  for c in select * from jsonb_array_elements('${json}'::jsonb) loop
    i := i + 1;
    v_up := coalesce((c -> 'fixture' ->> 'isPlayUp')::boolean, false);
    v_sup := coalesce((c -> 'fixture' ->> 'isSupport')::boolean, false);
    v_date := nullif(c -> 'fixture' ->> 'date', '')::date;
    update public.people set opt_in_only = coalesce((c ->> 'optInOnly')::boolean, false) where id = v_player;
    delete from public.availability_rules where person_id = v_player;
    insert into public.availability_rules (airtable_id, person_id, rule_type, availability, active, start_date, end_date, updated_at)
      select format('recCase%sRule%s', lpad(i::text, 3, '0'), lpad((o - 1)::text, 2, '0')), v_player,
             nullif(r ->> 'ruleType', ''), nullif(r ->> 'availability', ''), coalesce((r ->> 'active')::boolean, true),
             nullif(r ->> 'startDate', '')::date, nullif(r ->> 'endDate', '')::date, (r ->> 'lastModified')::timestamptz
      from jsonb_array_elements(c -> 'rules') with ordinality as x(r, o);
    v_status := public.availability_rule_status(v_player, v_date, v_up, v_sup);
    v_stored := null;
    if not (v_up and v_sup) then
      v_match := format('recCaseMatch%s', lpad(i::text, 5, '0'));
      insert into public.matches (airtable_id, match_date, home_team, away_team, match_status)
      values (v_match, (v_date + time '12:00') at time zone 'Asia/Hong_Kong',
              case when v_up then 'HKFC A' when v_sup then 'HKFC H' else 'HKFC D' end, 'Case Opponent', 'Scheduled');
      perform public.set_availability(v_api, array[v_match], 'Available');
      v_stored := exists (select 1 from public.availability_exceptions e join public.matches m on m.id = e.match_id
                          where m.api_id = v_match and e.person_id = v_player);
    end if;
    insert into rule_case_results values (i, c ->> 'name', c ->> 'ruleStatus', v_status, (c ->> 'storeAvailable')::boolean, v_stored);
  end loop;
end
$chk$`;

const oneLine = body.trim().split("\n").map((l) => l.trim()).join(" ");

const tapIndex = process.argv.indexOf("--tap");
if (tapIndex === -1) {
  process.stdout.write(
    [
      "-- availability rule cases (scripts/availability-rule-checks.mjs); run rolled back",
      `${oneLine};`,
      "select count(*) as cases,\n" +
        "       count(*) filter (where want_status is not distinct from got_status) as rule_status_agree,\n" +
        "       count(*) filter (where got_store is not null) as writes_checked,\n" +
        "       count(*) filter (where got_store = want_store) as writes_agree\n" +
        "from rule_case_results;",
      "select n, name, want_status, got_status, want_store, got_store from rule_case_results\n" +
        "where want_status is distinct from got_status or (got_store is not null and got_store <> want_store)\n" +
        "order by n;",
      "",
    ].join("\n"),
  );
} else {
  const out = process.argv[tapIndex + 1];
  if (!out) throw new Error("--tap needs the file to write");
  const writes = withDefaults.filter((c) => !(c.fixture.isPlayUp && c.fixture.isSupport)).length;
  writeFileSync(
    out,
    [
      "-- GENERATED by scripts/availability-rule-checks.mjs --tap from",
      "-- tests/fixtures/availabilityRuleCases.json. Don't edit or commit: change the JSON.",
      "begin;",
      `select plan(${2 + withDefaults.length + writes});`,
      "",
      "-- The empty test database: the eight HKFC teams and one Active HKFC D player.",
      "insert into public.teams (airtable_id, team_name, team_rank, active)",
      "select 'recCaseTeam' || l, 'HKFC ' || l, o, true",
      "from unnest(array['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) with ordinality as x(l, o);",
      "insert into public.people (airtable_id, given_names, surname, active, registered_team)",
      "values ('recCasePlayer', 'Case', 'Player', true, 'HKFC D');",
      "",
      `${oneLine};`,
      "",
      `select is((select count(*)::int from rule_case_results), ${withDefaults.length}, 'every case ran');`,
      `select is((select count(*)::int from rule_case_results where got_store is not null), ${writes}, 'every buildable case wrote');`,
      "select is(got_status, want_status, format('case %s, %s: availability_rule_status', n, name))",
      "from rule_case_results order by n;",
      "select is(got_store, want_store, format('case %s, %s: set_availability stores Available', n, name))",
      "from rule_case_results where got_store is not null order by n;",
      "",
      "select * from finish();",
      "rollback;",
      "",
    ].join("\n"),
  );
}
