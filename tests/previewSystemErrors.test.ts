import { describe, expect, it, vi } from 'vitest';
import { applyAndTest, pendingMigration, previewConnection, quietCommand, rollbackTests, verifyTap, VERSION,
  // @ts-expect-error - plain JavaScript workflow script
} from '../scripts/preview-system-errors.mjs';
import { readdirSync } from 'node:fs';

const url = 'postgresql://postgres:fictional-password@db.zlqzpzmqjqnrppmtevbv.supabase.co:5432/postgres';
const tap = ['1..24', ...Array.from({ length: 24 }, (_, i) => `ok ${i + 1} - assertion`)].join('\n');
const versions = readdirSync('supabase/migrations').map((f) => f.slice(0, 14)).sort();

describe('preview database workflow', () => {
  it('accepts only preview direct and session pooler connections and requires encryption', () => {
    expect(previewConnection(url)).toContain('sslmode=require');
    expect(previewConnection('postgres://postgres.zlqzpzmqjqnrppmtevbv:fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres')).toContain('sslmode=require');
    for (const bad of [undefined, 'not-a-url', url.replace('zlqzpzmqjqnrppmtevbv', 'biipqddulsbjpbmxuoss'),
      'postgres://postgres.biipqddulsbjpbmxuoss:fake@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
      'postgres://postgres:fake@example.com/postgres', url.replace(/\/postgres$/, '/other'),
      url + '?host=db.biipqddulsbjpbmxuoss.supabase.co', url + '?service=production',
      url.replace(':5432/', ':6543/')]) {
      expect(() => previewConnection(bad)).toThrow();
    }
  });

  it('rejects a production connection before invoking any database tool', () => {
    const run = vi.fn();
    expect(() => applyAndTest({ connection: url.replace('zlqzpzmqjqnrppmtevbv', 'biipqddulsbjpbmxuoss'), run })).toThrow(/Refusing/);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses unexpected pending migrations and unknown remote history', () => {
    expect(() => pendingMigration(['20261007000202', VERSION], [])).toThrow(/Other preview migrations/);
    expect(() => pendingMigration([VERSION], ['20261010120000'])).toThrow(/absent from this branch/);
    expect(pendingMigration([VERSION], [VERSION])).toBe(false);
  });

  it('runs a dry run before applying and verifies recorded history before testing', () => {
    const run = vi.fn()
      .mockReturnValueOnce(versions.filter((v) => v !== VERSION).join('\n'))
      .mockReturnValueOnce('dry-run output')
      .mockReturnValueOnce('applied')
      .mockReturnValueOnce('1\n')
      .mockReturnValueOnce(tap);
    const log = vi.fn();
    applyAndTest({ connection: url, run, log });
    expect(run.mock.calls.map((call) => call[0])).toEqual(['psql', 'supabase', 'supabase', 'psql', 'psql']);
    expect(run.mock.calls[1][1]).toContain('--dry-run');
    expect(run.mock.calls[2][1]).toContain('--yes');
    expect(run.mock.calls[4][2].input).toMatch(/^begin;/);
    expect(run.mock.calls[4][2].input).toMatch(/rollback;\s*$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain('fictional-password');
  });

  it('reruns only tests when the migration is already recorded', () => {
    const run = vi.fn().mockReturnValueOnce(versions.join('\n')).mockReturnValueOnce('1').mockReturnValueOnce(tap);
    applyAndTest({ connection: url, run, log: vi.fn() });
    expect(run.mock.calls.every((call) => call[0] === 'psql')).toBe(true);
  });

  it('does not test or deploy if applying did not record the migration', () => {
    const run = vi.fn().mockReturnValueOnce(versions.join('\n')).mockReturnValueOnce('0');
    expect(() => applyAndTest({ connection: url, run, log: vi.fn() })).toThrow(/has not recorded/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('keeps extension installation and synthetic data inside a rolled-back transaction', () => {
    const sql = rollbackTests('begin;\nselect plan(24);\nrollback;\n');
    expect(sql.indexOf('create extension')).toBeGreaterThan(sql.indexOf('begin;'));
    expect(sql).toContain("set local lock_timeout = '5s'");
    expect(() => rollbackTests('delete from public.error_log;')).toThrow(/ROLLBACK/);
  });

  it('fails on TAP assertion failures, missing assertions, missing plan and diagnostic failures', () => {
    expect(verifyTap(tap)).toHaveLength(24);
    for (const bad of [tap.replace('ok 2 ', 'not ok 2 '), tap.replace('ok 24 - assertion', ''), tap.replace('1..24', ''), tap.replace('ok 24 ', 'ok 23 '), tap + '\n# Looks like you failed 1 test']) {
      expect(() => verifyTap(bad)).toThrow(/tests failed/);
    }
  });

  it('does not expose command failure text containing connection credentials', () => {
    expect(() => quietCommand(process.execPath, ['-e', "console.error('postgres://secret-user:secret-password@example.com');process.exit(1)"], { label: 'Preview command' }))
      .toThrow('Preview command failed. Check the preview connection and migration history; database output is withheld.');
  });
});
