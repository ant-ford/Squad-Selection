import { hkDateKey } from '@shared/hkDateKey';
import type { MyFixture } from '@/api/getMyFixtures';

/**
 * The other fixtures on the same Hong Kong day as `fixture`, from every list
 * the player sees (My Team, play-ups, support).
 *
 * Opt-out means a player is Available for everything they have not answered,
 * so marking "No" for their own team's game leaves every play-up and support
 * game that day still reading Available to those coaches. This is the list
 * the dashboard offers them to answer as well.
 */
export function otherGamesThatDay(fixture: MyFixture, all: MyFixture[]): MyFixture[] {
  const day = hkDateKey(fixture.date);
  const seen = new Set<string>([fixture.id]);
  const out: MyFixture[] = [];
  for (const f of all) {
    if (seen.has(f.id) || hkDateKey(f.date) !== day) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/** Fixtures by Hong Kong day, built once so each card only scans its own day. */
export function groupByHkDay(all: MyFixture[]): Map<string, MyFixture[]> {
  const map = new Map<string, MyFixture[]>();
  for (const f of all) {
    const key = hkDateKey(f.date);
    const list = map.get(key);
    if (list) list.push(f);
    else map.set(key, [f]);
  }
  return map;
}

/**
 * Whether to ask about the rest of the day: the player is out for this game
 * but still counted in (Available or Maybe) for another one that day.
 */
export function needsSameDayPrompt(fixture: MyFixture, others: MyFixture[]): boolean {
  return fixture.availabilityStatus === 'Unavailable' && others.some((f) => f.availabilityStatus !== 'Unavailable');
}

/**
 * Days with more than one fixture for the player to answer, across every
 * list (My Team, play-ups, support). A D-team player can have three games on
 * a Saturday once play-ups and support are counted; these days get one
 * whole-day control ("All available / All maybe / All no").
 */
export function multiFixtureDays(byDay: Map<string, MyFixture[]>): Map<string, MyFixture[]> {
  const out = new Map<string, MyFixture[]>();
  for (const [day, list] of byDay) {
    // One entry per fixture, even if it is listed twice.
    const unique = [...new Map(list.map((f) => [f.id, f])).values()];
    if (unique.length > 1) out.set(day, unique);
  }
  return out;
}

/**
 * Where each day's control goes: in front of the first card of that day in
 * the order the page shows them. Cards in a collapsed list are not passed in,
 * so a day whose games are all tucked away shows its control once opened.
 */
export function firstCardOfEachDay(shown: MyFixture[], days: Map<string, MyFixture[]>): Set<MyFixture> {
  const seen = new Set<string>();
  const out = new Set<MyFixture>();
  for (const f of shown) {
    const day = hkDateKey(f.date);
    if (!days.has(day) || seen.has(day)) continue;
    seen.add(day);
    out.add(f);
  }
  return out;
}

/** The answer every fixture that day shares, or null when they differ. */
export function commonDayAnswer(list: MyFixture[]): string | null {
  if (list.length === 0) return null;
  const first = list[0].availabilityStatus;
  return list.every((f) => f.availabilityStatus === first) ? first : null;
}
