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

/**
 * Whether to ask about the rest of the day: the player is out for this game
 * but still counted in (Available or Maybe) for another one that day.
 */
export function needsSameDayPrompt(fixture: MyFixture, others: MyFixture[]): boolean {
  return fixture.availabilityStatus === 'Unavailable' && others.some((f) => f.availabilityStatus !== 'Unavailable');
}
