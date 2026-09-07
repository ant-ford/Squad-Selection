import { useState } from 'react';
import { safeFormat } from '@/lib/dateUtils';
import { setMatchKit, type KitColour, type MatchInfo } from '@/api/getPlayersForMatch';
import { toast } from 'sonner';

const KIT_SWATCH: Record<Exclude<KitColour, ''>, string> = {
  Blue: 'bg-blue-600 border-blue-700',
  White: 'bg-white border-neutral-400',
};

/**
 * Kit picker. Home and Away are stored separately, so in a derby each side
 * keeps its own colour and this writes only the side currently being
 * selected. Tapping the active colour again clears it back to undecided.
 */
function KitToggle({ matchId, side, kit }: { matchId: string; side: 'home' | 'away'; kit: KitColour }) {
  const [current, setCurrent] = useState<KitColour>(kit);
  const [saving, setSaving] = useState(false);

  const choose = async (colour: Exclude<KitColour, ''>) => {
    const next: KitColour = current === colour ? '' : colour;
    const previous = current;
    setCurrent(next); // optimistic
    setSaving(true);
    try {
      await setMatchKit(matchId, side, next);
      toast.success(next ? `${next} kit` : 'Kit cleared');
    } catch {
      setCurrent(previous);
      toast.error('Failed to set kit');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0" aria-label="Kit colour">
      <span className="text-[11px] text-muted-foreground hidden sm:inline">Kit</span>
      {(['Blue', 'White'] as const).map((colour) => {
        const active = current === colour;
        return (
          <button
            key={colour}
            type="button"
            disabled={saving}
            onClick={() => choose(colour)}
            title={active ? `${colour} kit (tap to clear)` : `Set ${colour} kit`}
            aria-pressed={active}
            className={`h-5 w-5 rounded-full border-2 transition-shadow disabled:opacity-50 ${KIT_SWATCH[colour]} ${
              active ? 'ring-2 ring-offset-1 ring-primary' : 'opacity-40 hover:opacity-80'
            }`}
          />
        );
      })}
    </div>
  );
}

/**
 * Compact match header: one title line + one meta line + a small count chip.
 * The large stat boxes and progress bar were removed for space.
 */
export default function MatchHeader({ match, matchId }: { match: MatchInfo; matchId?: string }) {
  return (
    <div className="border-b border-border bg-card">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            <span className={match.hkfcTeam === match.homeTeam ? 'font-bold' : ''}>{match.homeTeam}</span>
            {' vs '}
            <span className={match.hkfcTeam === match.awayTeam ? 'font-bold' : ''}>{match.awayTeam}</span>
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {safeFormat(match.date, 'EEE d MMM')} · {safeFormat(match.date, 'HH:mm')} · {match.venue} · Division: {match.division}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {matchId && match.side && (
            <KitToggle matchId={matchId} side={match.side} kit={match.kit ?? ''} />
          )}
          <span
            className="inline-flex items-center px-2 py-1 rounded-md text-sm font-medium bg-muted text-muted-foreground"
            title={`${match.selectedCount} of ${match.targetSquadSize} selected`}
          >
            {match.selectedCount}/{match.targetSquadSize}
          </span>
        </div>
      </div>
    </div>
  );
}