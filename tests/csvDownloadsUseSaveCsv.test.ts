import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Every CSV download goes through src/lib/saveCsv.ts, which writes the UTF-8
// byte-order mark Excel needs to show non-English names correctly. A
// hand-rolled Blob download skips it (the event downloads did until Oct 2026).
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

describe('CSV downloads', () => {
  it('only saveCsv builds a text/csv Blob in the frontend', () => {
    const offenders = files(path.resolve(__dirname, '../src'))
      .filter((f) => !f.endsWith(path.join('lib', 'saveCsv.ts')))
      .filter((f) => /new Blob\([^)]*text\/csv/s.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(path.resolve(__dirname, '..'), f));
    expect(offenders).toEqual([]);
  });
});
