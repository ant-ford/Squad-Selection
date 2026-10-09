// Run only from the owner-approved Preview API workflow. Database output
// stays private: even a libpq failure can quote fragments of a connection URL.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PREVIEW_REF = 'zlqzpzmqjqnrppmtevbv';
export const VERSION = '20261009231003';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function previewConnection(value) {
  if (!value) throw new Error('Add PREVIEW_DB_URL to the GitHub preview environment.');
  let url;
  try { url = new URL(value); } catch { throw new Error('PREVIEW_DB_URL must be a PostgreSQL connection URL.'); }
  let user;
  try { user = decodeURIComponent(url.username); } catch { throw new Error('Invalid username encoding in PREVIEW_DB_URL.'); }
  const direct = url.hostname === `db.${PREVIEW_REF}.supabase.co`;
  const pooler = /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname)
    && user === `postgres.${PREVIEW_REF}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.pathname !== '/postgres'
      || !url.password || (!direct && !pooler) || (url.port && url.port !== '5432')
      || url.hash || [...url.searchParams.keys()].some((key) => key !== 'sslmode')) {
    throw new Error('Refusing PREVIEW_DB_URL: it must identify the eddy-preview Supabase project.');
  }
  url.searchParams.set('sslmode', 'require');
  return url.toString();
}

export function pendingMigration(versions, applied) {
  const known = new Set(versions);
  if (applied.some((v) => !known.has(v))) {
    throw new Error('Preview has migration versions absent from this branch. Update the branch before retrying.');
  }
  const recorded = new Set(applied);
  const missing = versions.filter((v) => !recorded.has(v));
  if (missing.some((v) => v !== VERSION)) {
    throw new Error(`Other preview migrations are pending: ${missing.filter((v) => v !== VERSION).join(', ')}. This workflow applies only ${VERSION}.`);
  }
  if (!known.has(VERSION)) throw new Error('This branch does not contain the System error grouping migration.');
  return missing.length > 0;
}

export function rollbackTests(sql) {
  if (!/^begin;\r?\n/.test(sql) || !/rollback;\s*$/.test(sql)) {
    throw new Error('Preview tests must start a transaction and end with ROLLBACK.');
  }
  // pgTAP is created inside the same transaction, so tests leave no rows or
  // extension behind even when it was not previously installed in preview.
  return sql.replace(/^begin;\r?\n/, `begin;
set local statement_timeout = '30s';
set local lock_timeout = '5s';
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
`);
}

export function verifyTap(output) {
  const lines = output.split(/\r?\n/);
  const passed = lines.filter((line) => /^ok \d+\b/.test(line));
  if (!lines.includes('1..24') || passed.length !== 24
      || passed.some((line, index) => !line.startsWith(`ok ${index + 1} `))
      || lines.some((line) => /^not ok\b|^Bail out!|^# Looks like/.test(line))) {
    throw new Error('Preview database tests failed or returned fewer than 24 passing assertions. Database output is withheld.');
  }
  return passed;
}

export function quietCommand(command, args, { input, env, label } = {}) {
  const result = spawnSync(command, args, {
    input, env: { ...process.env, ...env }, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'], timeout: 120_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    // Never include result.error/message/stdout/stderr: these can contain
    // passwords, project URLs, or database data on a public runner.
    throw new Error(`${label ?? 'Database command'} failed. Check the preview connection and migration history; database output is withheld.`);
  }
  return result.stdout;
}

export function applyAndTest({ connection, run = quietCommand, log = console.log, repo = root } = {}) {
  const url = previewConnection(connection);
  const psqlArgs = ['--dbname', url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
  const databaseEnv = { PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'eddy-preview-system-errors' };
  const files = readdirSync(path.join(repo, 'supabase/migrations'));
  const versions = files.map((file) => /^(\d{14})_.+\.sql$/.exec(file)?.[1]).filter(Boolean).sort();
  const history = run('psql', [...psqlArgs, '-c',
    'select version from supabase_migrations.schema_migrations order by version'],
    { env: databaseEnv, label: 'Read preview migration history' });
  const applied = history.trim().split(/\r?\n/).filter(Boolean);
  if (applied.some((v) => !/^\d{14}$/.test(v))) throw new Error('Unexpected preview migration history format.');
  if (pendingMigration(versions, applied)) {
    log(`Preview dry run: only ${VERSION}_system_error_groups.sql is pending.`);
    const args = ['db', 'push', '--db-url', url, '--skip-vault'];
    run('supabase', [...args, '--dry-run'], { label: 'Preview migration dry run' });
    run('supabase', [...args, '--yes'], { label: 'Apply preview migration' });
  } else {
    log(`Preview has already recorded ${VERSION}; running its tests again.`);
  }
  const recorded = run('psql', [...psqlArgs, '-c',
    `select count(*) from supabase_migrations.schema_migrations where version = '${VERSION}'`],
    { env: databaseEnv, label: 'Verify preview migration history' });
  if (recorded.trim() !== '1') throw new Error('Preview has not recorded the System error grouping migration.');
  const sql = rollbackTests(readFileSync(path.join(repo, 'supabase/tests/system_error_groups.test.sql'), 'utf8'));
  const output = run('psql', [...psqlArgs, '-f', '-'], {
    env: databaseEnv, input: sql, label: 'Preview System database tests',
  });
  // Log only the summary; raw TAP diagnostics can contain database values.
  verifyTap(output);
  log(`eddy-preview: migration ${VERSION} recorded; 24/24 database tests passed. All test data rolled back.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    applyAndTest({ connection: process.env.PREVIEW_DB_URL });
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
