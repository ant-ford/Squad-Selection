// Run from the owner-approved Preview API workflow. Reuse its preview-only
// connection and quiet commands; no database values or credentials are logged.
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { previewConnection, quietCommand, rollbackTests } from './preview-system-errors.mjs';

export const MIGRATIONS = [
  { version: '20261011204704', test: 'admin_meeting_events.test.sql', count: 6 },
  { version: '20261011205957', test: 'event_date_polls.test.sql', count: 40 },
];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function pendingEventMigrations(versions, applied) {
  const known = new Set(versions);
  if (applied.some((v) => !known.has(v))) throw new Error('Preview has migration versions absent from this branch. Update the branch before retrying.');
  if (MIGRATIONS.some((m) => !known.has(m.version))) throw new Error('This branch is missing an Events migration.');
  const missing = versions.filter((v) => !applied.includes(v));
  if (missing.some((v) => !MIGRATIONS.some((m) => m.version === v))) throw new Error('Other preview migrations are pending. Apply those separately before the Events preview.');
  return missing;
}

export function verifyEventTap(output, count) {
  const lines = output.split(/\r?\n/);
  const passed = lines.filter((line) => /^ok \d+\b/.test(line));
  if (!lines.includes(`1..${count}`) || passed.length !== count
      || passed.some((line, index) => !line.startsWith(`ok ${index + 1} `))
      || lines.some((line) => /^not ok\b|^Bail out!|^# Looks like/.test(line))) {
    throw new Error(`Preview Events database tests failed or returned fewer than ${count} passing assertions. Database output is withheld.`);
  }
}

export function applyAndTestEvents({ connection, run = quietCommand, log = console.log, repo = root } = {}) {
  const url = previewConnection(connection);
  const args = ['--dbname', url, '-X', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1'];
  const env = { PGCONNECT_TIMEOUT: '20', PGAPPNAME: 'eddy-preview-event-dates' };
  const versions = readdirSync(path.join(repo, 'supabase/migrations')).map((f) => /^(\d{14})_.+\.sql$/.exec(f)?.[1]).filter(Boolean).sort();
  const history = run('psql', [...args, '-c', 'select version from supabase_migrations.schema_migrations order by version'], { env, label: 'Read preview migration history' });
  const applied = history.trim().split(/\r?\n/).filter(Boolean);
  if (applied.some((v) => !/^\d{14}$/.test(v))) throw new Error('Unexpected preview migration history format.');
  const pending = pendingEventMigrations(versions, applied);
  if (pending.length) {
    log(`Preview Events migrations pending: ${pending.join(', ')}.`);
    const push = ['db', 'push', '--db-url', url, '--skip-vault'];
    run('supabase', [...push, '--dry-run'], { label: 'Preview Events migration dry run' });
    run('supabase', [...push, '--yes'], { label: 'Apply preview Events migrations' });
  }
  const recorded = run('psql', [...args, '-c', `select count(*) from supabase_migrations.schema_migrations where version in (${MIGRATIONS.map((m) => `'${m.version}'`).join(',')})`], { env, label: 'Verify preview Events migrations' });
  if (recorded.trim() !== String(MIGRATIONS.length)) throw new Error('Preview has not recorded both Events migrations.');
  for (const m of MIGRATIONS) {
    const sql = readFileSync(path.join(repo, 'supabase/tests', m.test), 'utf8').replace(/^(?:[ \t]*--[^\r\n]*\r?\n|[ \t]*\r?\n)*/, '');
    const input = rollbackTests(sql);
    const output = run('psql', [...args, '-f', '-'], { env, input, label: 'Preview Events database tests' });
    verifyEventTap(output, m.count);
    log(`eddy-preview: ${m.test} passed ${m.count}/${m.count} assertions. Test data rolled back.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { applyAndTestEvents({ connection: process.env.PREVIEW_DB_URL }); }
  catch (error) { console.error(`::error::${error.message}`); process.exit(1); }
}
