import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Every foreign key to public.people, read from the migrations, must be
 * classified here: "erased" when erase_personal_data (the 13-month removal
 * and "Delete my profile") clears that personal data, or "kept" with the
 * reason it stays. A new table that refers to a person fails this test
 * until someone decides, so the removal can't quietly miss it.
 * docs/DATA_RETENTION.md.
 */
type Classification = "erased" | { kept: string };

const PEOPLE_FKS: Record<string, Classification> = {
  // ── Personal data: deleted or blanked by erase_personal_data ──
  "family_members.person_id": "erased",
  "relatives.person_id": "erased",
  "previous_clubs.person_id": "erased",
  "applicant_trials.person_id": "erased",
  "quiz_scores.person_id": "erased",
  "kit_sizes.person_id": "erased",
  "season_plans.person_id": "erased",
  "course_signups.person_id": "erased",
  "team_people.person_id": "erased",
  "availability_exceptions.person_id": "erased",
  "availability_rules.person_id": "erased",
  "ranking_events.person_id": "erased",
  "commitments.person_id": "erased",
  "message_log.person_id": "erased",
  "files.person_id": "erased",
  "signatures.signer_person_id": "erased",
  "signatures.subject_person_id": "erased",
  "steps.person_id": "erased",
  "declarations.person_id": "erased",
  "applications.person_id": "erased",
  "trial_availability.person_id": "erased",
  "event_responses.person_id": "erased",
  "event_payments.payer_id": "erased",
  "suspensions.person_id": "erased",

  // ── The playing record ──
  "match_selections.person_id": { kept: "playing record: who was picked for which match" },
  "match_cards.person_id": { kept: "playing record: appearances, cards and goals" },
  "registration_events.person_id": { kept: "playing record: team moves after play-ups" },
  "hkha_registrations.person_id": { kept: "playing record: the team they were registered with HKHA for" },
  "umpire_assignments.person_id": { kept: "umpiring record, like match cards; holds no contact details" },
  "umpire_pool.person_id": { kept: "who sees the umpiring screen, rebuilt daily from Active people; holds nothing else" },
  "season_rollover_people.person_id": { kept: "playing record: their teams before a season rollover, for its undo" },
  "offices.person_id": { kept: "who held which office stays on record; delete_own_profile retires their offices" },

  // ── Someone acting on another person's record: no personal data about them ──
  "availability_exceptions.updated_by_id": { kept: "who changed another player's availability" },
  "ranking_events.actor_id": { kept: "who ranked another player" },
  "match_selection_changes.actor_person_id": { kept: "which coach changed a squad; the added/removed ids are playing record like match_selections" },
  "activity_log.actor_person_id": { kept: "audit trail of field names only, never values" },
  "email_log.to_person_id": { kept: "delivery log by record id: no address or content" },
  "steps.waiting_on_person_id": { kept: "an officer's step on someone else's process (open ones keep them off the due list)" },
  "steps.done_by_person_id": { kept: "who completed a step on someone else's process" },
  "applications.sponsor_signed_by": { kept: "an officer's signature step on someone else's application" },
  "applications.chair_signed_by": { kept: "an officer's signature step on someone else's application" },
  "applications.officer_signed_by": { kept: "an officer's signature step on someone else's application" },
  "applications.sent_by": { kept: "who sent someone else's application on" },
  "trial_sessions.created_by": { kept: "who set up a trial session" },
  "people.referred_by_id": { kept: "on the referred person's row: only who referred them" },
  "events.created_by": { kept: "who created an event" },
  "event_responses.signed_up_by_id": { kept: "who signed someone else up, and so pays for them" },
  "event_payments.confirmed_by": { kept: "the social secretary who confirmed a payment" },
  "hkha_registrations.registered_by_person_id": { kept: "the Convenor who ticked off a registration" },
  "registration_events.resolved_by": { kept: "the officer who moved or kept a player after play-ups" },
  "umpire_assignments.created_by": { kept: "who put an umpire down for a duty" },
  "suspensions.created_by": { kept: "the Convenor who recorded someone else's suspension" },
  "suspensions.cleared_by": { kept: "the Convenor who cleared someone else's suspension" },

  // ── Club kit inventory ──
  "kit_sets.ordered_for_id": { kept: "club kit inventory: who a set was ordered for" },
  "kit_sets.holder_id": { kept: "club kit inventory: who holds a club set" },
  "kit_sets.pending_to_id": { kept: "club kit inventory: a hand-over in progress" },
  "kit_moves.from_id": { kept: "club kit hand-over history" },
  "kit_moves.to_id": { kept: "club kit hand-over history" },
  "kit_moves.by_id": { kept: "club kit hand-over history" },
};

// ── A small static reader for the migrations ─────────────────────────────

/** Comments removed, dollar-quoted bodies and string literals emptied: what's left is DDL. */
export function stripSql(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
    } else if (c === "'") {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === "'" && sql[j + 1] !== "'")) j += sql[j] === "'" ? 2 : 1;
      out += "''";
      i = j + 1;
    } else if (c === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i))?.[0];
      if (tag) {
        const end = sql.indexOf(tag, i + tag.length);
        out += "$$$$";
        i = end === -1 ? sql.length : end + tag.length;
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Splits on commas outside parentheses. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === "," && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const tableName = (name: string) => name.replace(/"/g, "").replace(/^public\./i, "");
const isPublic = (name: string) => !name.includes(".") || /^"?public"?\./i.test(name);
const REFS_PEOPLE = /\breferences\s+(?:"?public"?\.)?"?people"?(?![\w.])/i;
const TABLE_FK = /^(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(?:"?public"?\.)?"?people"?(?![\w.])/i;
const NOT_A_COLUMN = /^(?:constraint|primary|unique|check|exclude|foreign|like)\b/i;
const cols = (list: string) => list.split(",").map((c) => c.trim().replace(/"/g, "")).join(",");

/** The foreign keys to public.people the migrations leave, as "table.column" (or "table.a,b"). */
export function peopleForeignKeys(migrations: string[]): Set<string> {
  const fks = new Set<string>();
  for (const raw of migrations) {
    for (const stmt of stripSql(raw).split(";").map((s) => s.replace(/\s+/g, " ").trim())) {
      const create = /^create (?:unlogged )?table (?:if not exists )?(\S+?) ?\(/i.exec(stmt);
      if (create) {
        if (!isPublic(create[1])) continue;
        const table = tableName(create[1]);
        const open = create[0].length - 1;
        let depth = 0;
        let close = open;
        for (; close < stmt.length; close++) {
          if (stmt[close] === "(") depth++;
          else if (stmt[close] === ")" && --depth === 0) break;
        }
        for (const item of splitTopLevel(stmt.slice(open + 1, close))) {
          const tableFk = TABLE_FK.exec(item);
          if (tableFk) fks.add(`${table}.${cols(tableFk[1])}`);
          else if (!NOT_A_COLUMN.test(item) && REFS_PEOPLE.test(item)) fks.add(`${table}.${item.split(" ")[0].replace(/"/g, "")}`);
        }
        continue;
      }
      const alter = /^alter table (?:if exists )?(?:only )?(\S+) (.*)$/i.exec(stmt);
      if (alter) {
        if (!isPublic(alter[1])) continue;
        const table = tableName(alter[1]);
        const rename = /^rename column (\S+) to (\S+)$/i.exec(alter[2]);
        if (rename) {
          const [from, to] = [rename[1], rename[2]].map((c) => c.replace(/"/g, ""));
          if (fks.delete(`${table}.${from}`)) fks.add(`${table}.${to}`);
          continue;
        }
        for (const action of splitTopLevel(alter[2])) {
          const addFk = /^add (.*)$/i.exec(action);
          const dropCol = /^drop (?:column )?(?:if exists )?(\S+)/i.exec(action);
          if (addFk) {
            const tableFk = TABLE_FK.exec(addFk[1]);
            if (tableFk) {
              fks.add(`${table}.${cols(tableFk[1])}`);
            } else {
              const col = /^(?:column )?(?:if not exists )?(\S+) /i.exec(addFk[1]);
              if (col && !NOT_A_COLUMN.test(addFk[1].replace(/^column /i, "")) && REFS_PEOPLE.test(addFk[1])) {
                fks.add(`${table}.${col[1].replace(/"/g, "")}`);
              }
            }
          } else if (dropCol && !/^drop (?:constraint|default|not null|index)\b/i.test(action)) {
            fks.delete(`${table}.${dropCol[1].replace(/"/g, "")}`);
          }
        }
        continue;
      }
      const drop = /^drop table (?:if exists )?(.+?)(?: cascade| restrict)?$/i.exec(stmt);
      if (drop) {
        for (const name of drop[1].split(",").map((n) => tableName(n.trim()))) {
          for (const fk of [...fks]) if (fk.startsWith(`${name}.`)) fks.delete(fk);
        }
      }
    }
  }
  return fks;
}

/** The body of the newest definition of a function, comments removed. */
function latestFunctionBody(migrations: string[], name: string): string {
  const def = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)([\\s\\S]*?)\\1`, "gi");
  let body: string | null = null;
  for (const sql of migrations) for (const m of sql.matchAll(def)) body = m[2];
  if (body === null) throw new Error(`No definition of public.${name}`);
  return body.replace(/--[^\n]*/g, "");
}

const DIR = new URL("../supabase/migrations/", import.meta.url);
const MIGRATIONS = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, DIR), "utf8"));

describe("the migration reader", () => {
  it("finds column-level and table-level foreign keys, in create and alter table", () => {
    const fks = peopleForeignKeys([
      `create table public.a (
         id uuid primary key,
         person_id uuid not null references public.people (id) on delete cascade, -- a comment, with a comma
         other_id uuid references public.people_v (id),
         note text default 'x; references public.people',
         by_id uuid,
         constraint a_by_fkey foreign key (by_id) references public.people(id),
         check (num_nonnulls(person_id, by_id) >= 1)
       );
       create function f() returns void language sql as $$ select 'references public.people' $$;
       alter table public.b add column x_id uuid references people (id), add constraint b_y foreign key (y_id) references public.people (id);
       alter table public.c add column z_id uuid references public.people (id);
       alter table public.c drop column z_id;
       create table archive.d (person_id uuid references public.people (id));`,
    ]);
    expect([...fks].sort()).toEqual(["a.by_id", "a.person_id", "b.x_id", "b.y_id"]);
  });

  it("reads a plausible number from the real migrations", () => {
    const fks = peopleForeignKeys(MIGRATIONS);
    expect(fks.size).toBeGreaterThan(40);
    expect(fks.has("event_responses.person_id")).toBe(true);
    expect(fks.has("people.referred_by_id")).toBe(true);
  });
});

describe("personal data removal covers every reference to a person", () => {
  const found = peopleForeignKeys(MIGRATIONS);

  it("every foreign key to public.people is classified as erased or kept", () => {
    const unclassified = [...found].filter((fk) => !(fk in PEOPLE_FKS)).sort();
    expect(unclassified, "Classify these in PEOPLE_FKS and, if erased, handle them in erase_personal_data").toEqual([]);
  });

  it("every classification is still a foreign key in the migrations", () => {
    expect(Object.keys(PEOPLE_FKS).filter((fk) => !found.has(fk)).sort()).toEqual([]);
  });

  it("every kept one says why", () => {
    for (const [fk, c] of Object.entries(PEOPLE_FKS)) {
      if (c !== "erased") expect(c.kept.trim(), fk).not.toBe("");
    }
  });

  it("the newest erase_personal_data touches every erased table", () => {
    const body = latestFunctionBody(MIGRATIONS, "erase_personal_data");
    const missing = Object.entries(PEOPLE_FKS)
      .filter(([, c]) => c === "erased")
      .map(([fk]) => fk.split(".")[0])
      .filter((table) => !new RegExp(`\\bpublic\\.${table}\\b`).test(body));
    expect([...new Set(missing)]).toEqual([]);
  });

  it("neither retention function depends on the Airtable archive", () => {
    // Dropping the archive schema must not break them: erase may clear a raw
    // copy only through dynamic SQL, guarded by to_regclass.
    for (const name of ["retention_stamp", "erase_personal_data"]) {
      const body = latestFunctionBody(MIGRATIONS, name).replace(/'(?:[^']|'')*'/g, "''");
      expect(body, name).not.toMatch(/\barchive\./i);
    }
  });
});
