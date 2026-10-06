// Guards on supabase/migrations, run by CI (.github/workflows/ci.yml) and
// runnable locally:
//
//   node scripts/check-migrations.mjs
//       Every .sql file has a 14-digit version prefix and no two share one.
//       `supabase db push` keys its history on the version alone, so a second
//       file with the same version is skipped as "already applied" without a
//       word (it happened on 6 Oct 2026 with 20261006120000).
//
//   node scripts/check-migrations.mjs --base origin/main
//       Also: every migration this branch ADDS (against its merge base with
//       the base branch) is newer than the newest one already on the base
//       branch. `db push` refuses to apply a version older than the last one
//       applied, so an out-of-order file would block production's next push.
//
//   node scripts/check-migrations.mjs --applied <file>
//       Also: every version in the repo is listed in <file> (one version per
//       line: the output of a SELECT on supabase_migrations.schema_migrations).
//       The deploy job uses this to refuse to deploy an API that expects
//       schema production does not have yet.
//
// Exits 1 with one line per problem; prints nothing else that could matter.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const MIGRATIONS_DIR = "supabase/migrations";
const NAME = /^(\d{14})_.+\.sql$/;

/** The 14-digit version of a migration file name, or null if it has none. */
export function migrationVersion(file) {
  const match = NAME.exec(path.basename(file));
  return match ? match[1] : null;
}

/** .sql files whose names `db push` would not read as `<version>_<name>.sql`. */
export function findMalformed(files) {
  return files.filter((f) => f.endsWith(".sql") && !migrationVersion(f));
}

/** Versions used by more than one file: [{ version, files }]. */
export function findDuplicateVersions(files) {
  const byVersion = new Map();
  for (const file of files) {
    const version = migrationVersion(file);
    if (!version) continue;
    byVersion.set(version, [...(byVersion.get(version) ?? []), file]);
  }
  return [...byVersion]
    .filter(([, list]) => list.length > 1)
    .map(([version, list]) => ({ version, files: list.sort() }));
}

/** The highest version among the files, or null if there are none. */
export function newestVersion(files) {
  const versions = files.map(migrationVersion).filter(Boolean).sort();
  return versions.length ? versions[versions.length - 1] : null;
}

/**
 * Added files whose version is not newer than the newest on the base branch.
 * A file that is already on the base branch under the same name is not an
 * addition (a branch that merged the base can report one).
 */
export function findOutOfOrderAdditions(added, baseFiles) {
  const newest = newestVersion(baseFiles);
  if (!newest) return [];
  const onBase = new Set(baseFiles.map((f) => path.basename(f)));
  return added
    .filter((f) => !onBase.has(path.basename(f)))
    .filter((f) => {
      const version = migrationVersion(f);
      return version !== null && version <= newest;
    })
    .map((file) => ({ file, newest }));
}

/** Repo versions not among the applied ones, sorted. */
export function findUnapplied(files, applied) {
  const done = new Set(applied.map((v) => v.trim()).filter(Boolean));
  const versions = [...new Set(files.map(migrationVersion).filter(Boolean))];
  return versions.filter((v) => !done.has(v)).sort();
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function lines(text) {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Runs the checks for a checkout at `root`. `base` is a git ref for the
 * ordering check; `applied` a list of versions for the production check.
 * Returns the problems as messages; an empty list means all is well.
 */
export function checkMigrations({ root, base, applied } = {}) {
  const dir = path.join(root, MIGRATIONS_DIR);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const problems = [];

  for (const file of findMalformed(files)) {
    problems.push(`${MIGRATIONS_DIR}/${file} has no 14-digit version prefix (<YYYYMMDDHHMMSS>_<name>.sql), so supabase db push would skip it.`);
  }
  for (const { version, files: clash } of findDuplicateVersions(files)) {
    problems.push(`Version ${version} is used by more than one migration (${clash.join(", ")}). supabase db push would apply only one of them: renumber the newer file.`);
  }

  if (base) {
    const mergeBase = git(root, "merge-base", base, "HEAD").trim();
    const added = lines(git(root, "diff", "--name-only", "--diff-filter=A", mergeBase, "HEAD", "--", MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"));
    const baseFiles = lines(git(root, "ls-tree", "--name-only", `${base}:${MIGRATIONS_DIR}`));
    for (const { file, newest } of findOutOfOrderAdditions(added, baseFiles)) {
      problems.push(`${file} is not newer than ${newest}, the newest migration on ${base}. supabase db push will not apply an older version once a newer one is applied: rename it with a version after ${newest}.`);
    }
  }

  if (applied) {
    const missing = findUnapplied(files, applied);
    if (missing.length) {
      problems.push(`Production has not recorded ${missing.length === 1 ? "this migration" : "these migrations"}: ${missing.map((v) => files.find((f) => f.startsWith(v))).join(", ")}.`);
    }
  }

  return problems;
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") options.base = argv[++i];
    else if (argv[i] === "--applied") options.appliedFile = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { base, appliedFile } = parseArgs(process.argv.slice(2));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const applied = appliedFile ? lines(readFileSync(appliedFile, "utf8")) : undefined;
  const problems = checkMigrations({ root, base, applied });
  for (const p of problems) console.log(process.env.GITHUB_ACTIONS ? `::error::${p}` : p);
  if (problems.length) process.exit(1);
  console.log("Migrations OK.");
}
