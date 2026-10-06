import { Trophy } from 'lucide-react';
import type { PastFixture } from '@/api/getMyFixtures';
import { MetaLine } from '@/components/shared/MetaLine';

/**
 * A fixture that has already been played. Read-only by design: availability
 * is a statement about the future, and offering the buttons here would let a
 * player "change their mind" about a game that has happened.
 *
 * What replaces them is the record of what actually happened - the result,
 * who scored, who was carded, and whether this player was on the match card.
 * Kept to three short rows (owner, 6 Oct 2026) so more results fit on screen:
 * teams and score, date and venue, then the player's own line followed by
 * the scorers and cards.
 */

const OUTCOME_STYLE: Record<'win' | 'draw' | 'loss', string> = {
  win: 'bg-success-soft text-success-soft-foreground border-success/30',
  draw: 'bg-muted text-muted-foreground border-border',
  loss: 'bg-danger-soft text-danger-soft-foreground border-danger/30',
};

const OUTCOME_LABEL: Record<'win' | 'draw' | 'loss', string> = {
  win: 'Won',
  draw: 'Drew',
  loss: 'Lost',
};

const CHIP = 'inline-flex items-center gap-1 text-xs font-medium px-1.5 py-px rounded-full border';

/** "Y" / "R" and the like, kept short so a row of them stays readable. */
function cardTone(card: string): string {
  const c = card.toUpperCase();
  if (c.startsWith('R')) return 'bg-danger-soft text-danger-soft-foreground border-danger/30';
  return 'bg-warning-soft text-warning-soft-foreground border-warning/40';
}

/**
 * The score in the same order as the title: home team's goals first, the way
 * HKHA lists results. goalsFor/goalsAgainst are HKFC's side; the Won / Drew /
 * Lost badge next to it keeps that perspective.
 */
export function scoreInFixtureOrder(f: Pick<PastFixture, 'goalsFor' | 'goalsAgainst' | 'isHome'>): [number, number] | null {
  if (f.goalsFor === null || f.goalsAgainst === null) return null;
  return f.isHome ? [f.goalsFor, f.goalsAgainst] : [f.goalsAgainst, f.goalsFor];
}

/** "Sam Lee, Raj Patel (2)". */
export function scorerList(scorers: PastFixture['scorers']): string {
  return scorers.map((s) => (s.goals && s.goals > 1 ? `${s.name} (${s.goals})` : s.name)).join(', ');
}

export default function PastFixtureCard({ fixture }: { fixture: PastFixture }) {
  const score = scoreInFixtureOrder(fixture);

  return (
    <div className="bg-card border border-border rounded-xl px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        {/* Home team first, as on the upcoming fixture cards. */}
        <p className="min-w-0 flex-1 font-semibold text-sm text-foreground truncate">
          {fixture.isHome ? fixture.hkfcTeam : fixture.opponent}
          <span className="text-muted-foreground font-normal"> vs </span>
          {fixture.isHome ? fixture.opponent : fixture.hkfcTeam}
        </p>
        <div className="flex items-center gap-1.5 shrink-0">
          {score ? (
            <span className="text-base font-semibold tabular-nums leading-none text-foreground">
              {score[0]}&ndash;{score[1]}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No score</span>
          )}
          {fixture.outcome && (
            <span className={`${CHIP} ${OUTCOME_STYLE[fixture.outcome]}`}>{OUTCOME_LABEL[fixture.outcome]}</span>
          )}
        </div>
      </div>

      <div className="mt-0.5">
        <MetaLine date={fixture.date} venue={fixture.venue} />
      </div>

      {/* Whether this player was actually there, then the match's scorers
          and cards on the same line. A Match Card is the appearance record,
          so its absence is not "did not play" in any disciplinary sense - it
          just means no card was recorded. */}
      <div className="mt-1 flex items-center gap-x-1.5 gap-y-1 flex-wrap text-xs">
        {fixture.played ? (
          <span className={`${CHIP} border-primary/30 bg-primary-tint/10 text-primary`}>Played</span>
        ) : (
          <span className="text-muted-foreground">Not on the match card</span>
        )}
        {fixture.myGoals > 0 && (
          <span className={`${CHIP} bg-success-soft text-success-soft-foreground border-success/30`}>
            <Trophy className="h-3 w-3" />
            {fixture.myGoals === 1 ? '1 goal' : `${fixture.myGoals} goals`}
          </span>
        )}
        {fixture.myCards.map((c, i) => (
          <span key={`${c}-${i}`} className={`${CHIP} ${cardTone(c)}`}>
            {c}
          </span>
        ))}
        {fixture.scorers.length > 0 && (
          <span className="text-foreground">
            <span className="text-muted-foreground">Scorers</span> {scorerList(fixture.scorers)}
          </span>
        )}
        {fixture.cards.length > 0 && (
          <span className="text-foreground">
            <span className="text-muted-foreground">Cards</span>{' '}
            {fixture.cards.map((c) => `${c.name} (${(c.cards ?? []).join(', ')})`).join(', ')}
          </span>
        )}
      </div>
    </div>
  );
}
