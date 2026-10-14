import { describe, expect, it, vi } from 'vitest';
import { applyAndTestEvents, pendingEventMigrations, verifyEventTap, MIGRATIONS,
  // @ts-expect-error - plain JavaScript workflow script
} from '../scripts/preview-event-dates.mjs';
import { readdirSync, readFileSync } from 'node:fs';

const url = 'postgresql://postgres:fictional-password@db.zlqzpzmqjqnrppmtevbv.supabase.co:5432/postgres';
const versions = readdirSync('supabase/migrations').map((f) => f.slice(0, 14)).sort();
const tap = (n: number) => ['1..' + n, ...Array.from({ length: n }, (_, i) => `ok ${i + 1} - assertion`)].join('\n');
const recorded = versions.join('\n');

describe('approved Events preview migration workflow', () => {
  it('rejects production before making any database call', () => {
    const run = vi.fn();
    expect(() => applyAndTestEvents({ connection: url.replace('zlqzpzmqjqnrppmtevbv', 'biipqddulsbjpbmxuoss'), run })).toThrow(/Refusing/);
    expect(run).not.toHaveBeenCalled();
  });
  it('applies only the two reviewed migrations and refuses other pending or unknown history', () => {
    const allowed = MIGRATIONS.map((m: { version: string }) => m.version);
    expect(pendingEventMigrations(versions, versions.filter((v) => !allowed.includes(v)))).toEqual(allowed);
    expect(pendingEventMigrations(versions, versions.filter((v) => v !== allowed[1]))).toEqual([allowed[1]]);
    expect(pendingEventMigrations(versions, versions)).toEqual([]);
    expect(() => pendingEventMigrations(versions, [])).toThrow(/Other preview migrations/);
    expect(() => pendingEventMigrations(versions, [...versions, '20261012000000'])).toThrow(/absent from this branch/);
    expect(() => pendingEventMigrations(versions.filter((v) => v !== allowed[0]), [])).toThrow(/missing/);
  });
  it('runs a dry run before applying, verifies both migrations and rolls back both test files', () => {
    const run = vi.fn().mockReturnValueOnce(versions.filter((v) => !MIGRATIONS.some((m: { version: string }) => m.version === v)).join('\n'))
      .mockReturnValueOnce('').mockReturnValueOnce('').mockReturnValueOnce('2').mockReturnValueOnce(tap(6)).mockReturnValueOnce(tap(40));
    const log = vi.fn();
    applyAndTestEvents({ connection: url, run, log });
    expect(run.mock.calls.map((c) => c[0])).toEqual(['psql', 'supabase', 'supabase', 'psql', 'psql', 'psql']);
    expect(run.mock.calls[1][1]).toContain('--dry-run');
    expect(run.mock.calls[2][1]).toContain('--yes');
    for (const call of run.mock.calls.slice(4)) {
      expect(call[2].input).toMatch(/^begin;/);
      expect(call[2].input).toMatch(/rollback;\s*$/);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('fictional-password');
  });
  it('reruns only the rolled-back tests when both migrations are already present', () => {
    const run = vi.fn().mockReturnValueOnce(recorded).mockReturnValueOnce('2').mockReturnValueOnce(tap(6)).mockReturnValueOnce(tap(40));
    applyAndTestEvents({ connection: url, run, log: vi.fn() });
    expect(run.mock.calls.every((c) => c[0] === 'psql')).toBe(true);
  });
  it('stops before testing if migration history is incomplete', () => {
    const run = vi.fn().mockReturnValueOnce(recorded).mockReturnValueOnce('1');
    expect(() => applyAndTestEvents({ connection: url, run, log: vi.fn() })).toThrow(/both Events migrations/);
    expect(run).toHaveBeenCalledTimes(2);
  });
  it('stops on failed, missing or out-of-order database assertions', () => {
    for (const count of [6, 40]) {
      expect(() => verifyEventTap(tap(count), count)).not.toThrow();
      for (const bad of [tap(count).replace('ok 2 ', 'not ok 2 '), tap(count).replace('1..' + count, ''), tap(count).replace(`ok ${count} `, `ok ${count - 1} `), tap(count) + '\nBail out!']) {
        expect(() => verifyEventTap(bad, count)).toThrow(/tests failed/);
      }
    }
    const run = vi.fn().mockReturnValueOnce(recorded).mockReturnValueOnce('2').mockReturnValueOnce('1..6\nnot ok 1');
    expect(() => applyAndTestEvents({ connection: url, run, log: vi.fn() })).toThrow(/tests failed/);
    expect(run).toHaveBeenCalledTimes(3);
  });
  it('keeps test counts consistent with the SQL plans and restricts the workflow to the reviewed branch', () => {
    for (const m of MIGRATIONS) expect(readFileSync('supabase/tests/' + m.test, 'utf8')).toContain(`select plan(${m.count});`);
    const workflow = readFileSync('.github/workflows/preview.yml', 'utf8').replace(/\r\n/g, '\n');
    expect(workflow).toMatch(/Apply and test Events migrations on eddy-preview\n\s+if: github.ref == 'refs\/heads\/feat\/event-date-polls'/);
    expect(workflow.indexOf('node scripts/preview-event-dates.mjs')).toBeLessThan(workflow.indexOf('name: Deploy API Worker'));
  });
});
