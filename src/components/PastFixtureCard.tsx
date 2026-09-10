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
 */

const OUTCOME_STYLE: Record<'win' | 'draw' | 'loss', string> = {
  win: 'bg-green-100 text-green-800 border-green-200',
  draw: 'bg-muted text-muted-foreground border-border',
  loss: 'bg-red-100 text-red-800 border-red-200',
};

const OUTCOME_LABEL: Record<'win' | 'draw' | 'loss', string> = {
  win: 'Won',
  draw: 'Drew',
  loss: 'Lost',
};

/** "Y" / "R" and the like, kept short so a row of them stays readable. */
function cardTone(card: string): string {
  const c = card.toUpperCase();
  if (c.startsWith('R')) return 'bg-red-100 text-red-800 border-red-200';
  return 'bg-amber-100 text-amber-800 border-amber-200';
}

export default function PastFixtureCard({ fixture }: { fixture: PastFixture }) {
  const hasScore = fixture.goalsFor !== null && fixture.goalsAgainst !== null;

  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground truncate">
            {fixture.hkfcTeam} <span className="text-muted-foreground">v</span> {fixture.opponent}
          </p>
          <div className="mt-1">
            <MetaLine date={fixture.date} venue={fixture.venue} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          {hasScore ? (
            <span className="text-lg font-semibold tabular-nums leading-none text-foreground">
              {fixture.goalsFor}&ndash;{fixture.goalsAgainst}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">No score</span>
          )}
          {fixture.outcome && (
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${OUTCOME_STYLE[fixture.outcome]}`}
            >
              {OUTCOME_LABEL[fixture.outcome]}
            </span>
          )}
        </div>
      </div>

      {/* Whether this player was actually there. A Match Card is the
          appearance record, so its absence is not "did not play" in any
          disciplinary sense - it just means no card was recorded. */}
      <div className="mt-2.5 flex items-center gap-2 flex-wrap">
        {fixture.played ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
            Played
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Not on the match card</span>
        )}
        {fixture.myGoals > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-green-200 bg-green-100 text-green-800">
            <Trophy className="h-3 w-3" />
            {fixture.myGoals === 1 ? '1 goal' : `${fixture.myGoals} goals`}
          </span>
        )}
        {fixture.myCards.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${cardTone(c)}`}
          >
            {c}
          </span>
        ))}
      </div>

      {(fixture.scorers.length > 0 || fixture.cards.length > 0) && (
        <div className="mt-2.5 pt-2.5 border-t border-border space-y-1">
          {fixture.scorers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Scorers</span>{' '}
              {fixture.scorers
                .map((s) => (s.goals && s.goals > 1 ? `${s.name} (${s.goals})` : s.name))
                .join(', ')}
            </p>
          )}
          {fixture.cards.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Cards</span>{' '}
              {fixture.cards.map((c) => `${c.name} (${(c.cards ?? []).join(', ')})`).join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
