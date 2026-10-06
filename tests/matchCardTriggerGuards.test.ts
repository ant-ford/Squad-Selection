import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// supabase/migrations/20261007150103_match_card_trigger_guards.sql lists
// match_cards' columns by hand in match_cards_updated_at's WHEN, because a
// BEFORE trigger's WHEN can't name the generated api_id. This test fails
// when a migration adds a column to match_cards and the list isn't updated
// (a new migration that recreates the trigger), so a change to only that
// column would not move updated_at.
// (The triggers' behaviour was checked on preview in a rolled-back dry run;
// see the PR.)
// ---------------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "supabase", "migrations");
const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => readFileSync(path.join(DIR, f), "utf8").replace(/\r\n/g, "\n");
const GUARDS = "20261007150103_match_card_trigger_guards.sql";

/** match_cards' stored columns, from its create table and any later add column. */
function matchCardColumns(): string[] {
  const cols: string[] = [];
  for (const f of files) {
    const text = sql(f);
    const create = /create table public\.match_cards \(\n([\s\S]*?)\n\);/.exec(text);
    if (create) {
      for (const line of create[1].split("\n")) {
        const m = /^\s+([a-z_][a-z0-9_]*)\s+(?!key\b)/.exec(line);
        if (m && !line.trim().startsWith("--") && !["primary", "unique", "constraint", "foreign", "check"].includes(m[1])) cols.push(m[1]);
      }
    }
    for (const m of text.matchAll(/alter table (?:only )?public\.match_cards\s+add column (?:if not exists )?([a-z_][a-z0-9_]*)/g)) cols.push(m[1]);
    for (const m of text.matchAll(/alter table (?:only )?public\.match_cards\s+drop column (?:if exists )?([a-z_][a-z0-9_]*)/g)) {
      cols.splice(cols.indexOf(m[1]), 1);
    }
  }
  return cols;
}

/** The newest migration's text for one trigger's create statement. */
function newestTrigger(name: string): string {
  let found = "";
  for (const f of files) {
    const m = new RegExp(`create trigger ${name}\\n[\\s\\S]*?;`).exec(sql(f));
    if (m) found = m[0];
  }
  return found;
}

describe("match card trigger guards", () => {
  it("compares every stored column except updated_at before stamping updated_at", () => {
    const cols = matchCardColumns();
    expect(cols).toContain("goalkeeper");
    const when = newestTrigger("match_cards_updated_at");
    expect(when, `${GUARDS} (or a later migration) defines it`).toMatch(/when \(/);
    const olds = [...when.matchAll(/old\.([a-z0-9_]+)/g)].map((m) => m[1]);
    const news = [...when.matchAll(/new\.([a-z0-9_]+)/g)].map((m) => m[1]);
    expect(news).toEqual(olds);
    expect([...olds].sort()).toEqual(cols.filter((c) => c !== "updated_at").sort());
  });

  it("re-registers on update only when a column it depends on changed", () => {
    const update = newestTrigger("match_cards_auto_reregister_update");
    const of = /after update of ([a-z_, ]+) on/.exec(update)![1].split(",").map((c) => c.trim());
    const changed = [...update.matchAll(/old\.([a-z0-9_]+) is distinct from new\.([a-z0-9_]+)/g)].map((m) => {
      expect(m[1]).toBe(m[2]);
      return m[1];
    });
    expect(changed.sort()).toEqual([...of].sort());
    // Inserts still always run it.
    expect(newestTrigger("match_cards_auto_reregister")).toMatch(/after insert on public\.match_cards\n\s+for each row execute/);
  });

  it("looks up a person for a card only when it has a name and no person", () => {
    expect(newestTrigger("match_cards_link_person")).toMatch(/when \(new\.person_id is null and new\.raw_player_name is not null\)/);
  });
});
