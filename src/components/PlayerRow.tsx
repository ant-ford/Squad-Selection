import React from 'react';
import { CheckCircle2, Circle, Ban, AlertCircle, BarChart3 } from 'lucide-react';
import type { MatchPlayer } from '@/api/getPlayersForMatch';
import { POS_SHORT, shortTeam } from '@/lib/format';

/**
 * The eligibility engine's warning reads "Available for HKFC X, HKFC Y on
 * same day". That exact string is pinned by the golden tests and must not
 * change, so the trim happens here, at the point of display. On a screen that
 * is already about one specific HKFC fixture, "on same day" and the club
 * prefix are both things a coach can take as read.
 */
const SAME_DAY_SUFFIX = ' on same day';

export function displayWarning(warning: string): string {
  const trimmed = warning.endsWith(SAME_DAY_SUFFIX)
    ? warning.slice(0, -SAME_DAY_SUFFIX.length)
    : warning;
  return shortTeam(trimmed);
}

/**
 * Drops the per-team "Available: X" chips when the same-day warning below
 * already names those teams. Both were saying the same thing, one team per
 * chip and then all of them again in a sentence, which is what made the row
 * look cluttered. "Selected: X" chips always stay - being picked elsewhere
 * is a different fact from merely being free.
 */
export function conflictsWorthShowing(
  conflicts: { type: string; team: string }[] | undefined,
  warnings: string[] | undefined,
): { type: string; team: string }[] {
  const list = conflicts ?? [];
  const sameDayWarning = (warnings ?? []).find((w) => w.startsWith('Available for '));
  if (!sameDayWarning) return list;
  return list.filter((c) => c.type === 'selected' || !sameDayWarning.includes(c.team));
}

interface PlayerRowProps {
  player: MatchPlayer;
  selected: boolean;
  onToggleSelection: () => void;
  /** Optional drill-in to this player's season stats (coach screens). */
  onShowStats?: () => void;
}

const PlayerRow = React.memo(function PlayerRow({ player, selected, onToggleSelection, onShowStats }: PlayerRowProps) {
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const isMaybe = player.availabilityStatus === 'Maybe';

  // A tint alone was not carrying outdoors on a phone, so each state also
  // gets a solid edge. The bar is on every row, transparent when there is
  // nothing to say, so names stay on one vertical line down the list.
  let bgClass = 'border-l-transparent';
  if (isMaybe) bgClass = 'bg-amber-200 border-l-amber-600';
  else if (isUnavailable) bgClass = 'bg-red-200 border-l-red-600';

  // Blocked rows still recede - they are there to be understood, not picked.
  // Unavailable ones no longer do: dimming a pale tint was most of why these
  // were hard to read in daylight, and the colour already says enough.
  const dimmed = isBlocked;
  const visibleConflicts = conflictsWorthShowing(player.conflicts, player.warnings);
  const isDoubleBooked = player.selectionStatus === 'Selected'
    && (player.conflicts ?? []).some(c => c.type === 'selected');

  return (
    <div
      className={`flex items-center gap-2 sm:gap-3 py-1.5 pl-2 border-b border-border border-l-4 ${dimmed ? 'opacity-70' : ''} ${bgClass} cursor-pointer hover:bg-muted/50 transition-colors`}
      onClick={!isBlocked ? onToggleSelection : undefined}
    >
      <div className="shrink-0">
        {selected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
         isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
         <Circle className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate">{player.preferredName}</p>
          {player.isU21 && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded-sm shrink-0">U21</span>}
          {player.isVisitingPlayer && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded-sm shrink-0">VP</span>}
          <span className="text-[11px] text-muted-foreground shrink-0">{POS_SHORT[player.playingPosition] || '–'} · {player.playingAbility || '–'}</span>
        </div>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <span>
            {player.registeredTeam || '–'} · {player.playUpCount} play-up{player.playUpCount !== 1 ? 's' : ''} · {player.availabilityStatus}
          </span>
          {onShowStats && (
            // Drill-in to this player's season stats. stopPropagation because
            // the whole row toggles selection.
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onShowStats();
              }}
              title={`Season stats for ${player.preferredName}`}
              aria-label={`Season stats for ${player.preferredName}`}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              <BarChart3 className="h-3.5 w-3.5" />
            </button>
          )}
        </p>
        {player.supportUnavailable && player.supportUnavailable.length > 0 && (
          <p className='text-[11px] text-amber-900 bg-amber-50 border border-amber-400 rounded px-1.5 py-0.5 mt-1 inline-flex items-center gap-1'>
            <AlertCircle className='h-3 w-3 shrink-0' />
            Available here - unavailable for {player.supportUnavailable.map(shortTeam).join(', ')}
          </p>
        )}
        {player.playerNotes && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">“{player.playerNotes}”</p>}

        {visibleConflicts.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {visibleConflicts.map((c, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded border ${
                c.type === 'selected' && isDoubleBooked ? 'text-red-900 bg-red-100 border-red-500 font-medium'
                : c.type === 'selected' ? 'text-blue-900 bg-blue-50 border-blue-400'
                : 'text-amber-900 bg-amber-50 border-amber-400'
                }`}>
                {c.type === 'selected' && isDoubleBooked && <AlertCircle className="h-3 w-3" />}
                {c.type === 'selected' ? `Selected: ${shortTeam(c.team)}` : `Available: ${shortTeam(c.team)}`}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-1.5">
          {(player.blocks ?? []).map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-red-900 bg-red-50 border border-red-400 px-1.5 py-0.5 rounded">
              <Ban className="h-3 w-3 shrink-0" /> {b.reason}
            </span>
          ))}
          {(player.warnings ?? []).map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-amber-900 bg-amber-50 border border-amber-400 px-1.5 py-0.5 rounded">
              <AlertCircle className="h-3 w-3 shrink-0" /> {displayWarning(w)}
            </span>
          ))}
        </div>
      </div>
      {selected && <span className="text-xs px-2 py-0.5 rounded shrink-0 bg-primary text-primary-foreground">Selected</span>}
    </div>
  );
});

export default PlayerRow;