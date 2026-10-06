import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkMigrations,
  findDuplicateVersions,
  findOutOfOrderAdditions,
  findUnapplied,
  // @ts-expect-error - plain JavaScript CI script
} from "../scripts/check-migrations.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway repo whose supabase/migrations holds the given files. */
function repo(files: string[]) {
  const root = mkdtempSync(path.join(tmpdir(), "check-migrations-"));
  dirs.push(root);
  mkdirSync(path.join(root, "supabase", "migrations"), { recursive: true });
  for (const f of files) add(root, f);
  return root;
}

function add(root: string, file: string) {
  writeFileSync(path.join(root, "supabase", "migrations", file), "select 1;\n");
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** A repo with `baseFiles` committed on main, then a branch adding `added`. */
function branchRepo(baseFiles: string[], added: string[]) {
  const root = repo(baseFiles);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  git(root, "checkout", "-qb", "feature");
  for (const f of added) add(root, f);
  git(root, "add", ".");
  git(root, "commit", "-qm", "feature");
  return root;
}

describe("duplicate migration versions", () => {
  it("finds two files sharing a version", () => {
    expect(
      findDuplicateVersions(["20261006120000_hkha_registrations.sql", "20261006120000_event_register.sql", "20261006200000_umpiring.sql"]),
    ).toEqual([{ version: "20261006120000", files: ["20261006120000_event_register.sql", "20261006120000_hkha_registrations.sql"] }]);
  });

  it("fails the check and names both files", () => {
    const root = repo(["20261006120000_hkha_registrations.sql", "20261006120000_event_register.sql"]);
    const problems = checkMigrations({ root });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("20261006120000_event_register.sql, 20261006120000_hkha_registrations.sql");
  });

  it("fails a .sql file with no 14-digit version", () => {
    const root = repo(["20261006120000_ok.sql", "2026100612_short.sql", "notes.sql"]);
    expect(checkMigrations({ root })).toHaveLength(2);
  });

  it("ignores files that are not migrations", () => {
    const root = repo(["20261006120000_ok.sql", ".gitkeep", "README.md"]);
    expect(checkMigrations({ root })).toEqual([]);
  });
});

// Real git repos: each test spawns a dozen git processes, which is slow on
// Windows while the rest of the suite runs alongside.
describe("migrations added out of order", { timeout: 60_000 }, () => {
  const base = ["20261004120000_assistant_director.sql", "20261006150000_event_register.sql"];

  it("flags an added version older than, or equal to, the newest on the base branch", () => {
    expect(findOutOfOrderAdditions(["supabase/migrations/20261005090000_late.sql"], base)).toEqual([
      { file: "supabase/migrations/20261005090000_late.sql", newest: "20261006150000" },
    ]);
    expect(findOutOfOrderAdditions(["supabase/migrations/20261006150000_same.sql"], base)).toHaveLength(1);
  });

  it("allows a newer version, and a file the base branch already has", () => {
    expect(findOutOfOrderAdditions(["supabase/migrations/20261006200000_umpiring.sql"], base)).toEqual([]);
    expect(findOutOfOrderAdditions(["supabase/migrations/20261006150000_event_register.sql"], base)).toEqual([]);
  });

  it("fails a branch that adds an older migration, judged against the base branch in git", () => {
    const root = branchRepo(base, ["20261005090000_late.sql"]);
    const problems = checkMigrations({ root, base: "main" });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("supabase/migrations/20261005090000_late.sql is not newer than 20261006150000");
  });

  it("judges against the base branch's tip, not where the branch started", () => {
    const root = branchRepo(base, ["20261006200000_mine.sql"]);
    git(root, "checkout", "-q", "main");
    add(root, "20261007090000_theirs.sql");
    git(root, "add", ".");
    git(root, "commit", "-qm", "newer on main");
    git(root, "checkout", "-q", "feature");
    expect(checkMigrations({ root, base: "main" })[0]).toContain("20261006200000_mine.sql is not newer than 20261007090000");
  });

  it("passes a branch that adds a newer migration", () => {
    const root = branchRepo(base, ["20261006200000_umpiring.sql"]);
    expect(checkMigrations({ root, base: "main" })).toEqual([]);
  });
});

describe("migrations production has not recorded", () => {
  const files = ["20261004120000_assistant_director.sql", "20261006150000_event_register.sql", "20261006200000_umpiring.sql"];

  it("lists repo versions missing from the applied list", () => {
    expect(findUnapplied(files, ["20261004120000", "20261006150000"])).toEqual(["20261006200000"]);
    expect(findUnapplied(files, [...files.map((f) => f.slice(0, 14)), "20250101000000"])).toEqual([]);
  });

  it("names the missing files", () => {
    const root = repo(files);
    expect(checkMigrations({ root, applied: ["20261004120000"] })).toEqual([
      "Production has not recorded these migrations: 20261006150000_event_register.sql, 20261006200000_umpiring.sql.",
    ]);
    expect(checkMigrations({ root, applied: ["20261004120000", "20261006150000", "20261006200000"] })).toEqual([]);
  });
});
