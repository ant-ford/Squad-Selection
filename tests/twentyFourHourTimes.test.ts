import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// The glossary's Times rule: every on-screen time is 24-hour ("14:30"), through
// safeFormat(d, 'HH:mm') or formatHkTime(). Until Oct 2026 eight screens used
// date-fns' 12-hour 'h:mm a' ("2:30 PM").
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const root = path.resolve(__dirname, '..');
const TWELVE_HOUR = [
  /(?<![hH])h{1,2}:mm/, // date-fns 12-hour hour token: 'h:mm' or 'hh:mm'
  /hour12:\s*true/,
  /hourCycle:\s*["']h(11|12)["']/,
];

describe('24-hour times', () => {
  it('no 12-hour time formats in src/, shared/ or worker/src/', () => {
    const offenders = ['src', 'shared', 'worker/src']
      .flatMap((d) => files(path.join(root, d)))
      .filter((f) => {
        const text = readFileSync(f, 'utf8');
        return TWELVE_HOUR.some((re) => re.test(text));
      })
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
