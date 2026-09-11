import React from 'react';
import { CheckCircle2, Circle, Ban, AlertCircle, BarChart3 } from 'lucide-react';
import type { MatchPlayer } from '@/api/getPlayersForMatch';
import { POS_SHORT } from '@/lib/format';

/**
 * The eligibility engine's warning reads "Available for X, Y on same day".
 * That exact string is pinned by the golden tests and must not change, so
 * the trim happens here, at the point of display. On a screen that is
 * already about one specific fixture, "on same day" is the only part a
 * coach can take as read.
 */
const SAME_DAY_SUFFIX = ' on same day';

export function displayWarning(warning: string): string {
  return warning.endsWith(SAME_DAY_SUFFIX)
    ? warning.slice(0, -SAME_DAY_SUFFIX.length)
    : warning;
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

  let bgClass = '';
  if (isMaybe) bgClass = 'bg-amber-50/70';
  else if (isUnavailable) bgClass = 'bg-red-50/70';

  const dimmed = isBlocked || isUnavailable;
  const visibleConflicts = conflictsWorthShowing(player.conflicts, player.warnings);
  const isDoubleBooked = player.selectionStatus === 'Selected'
    && (player.conflicts ?? []).some(c => c.type === 'selected');

  return (
    <div
      className={`flex items-center gap-2 sm:gap-3 py-1.5 border-b border-border ${dimmed ? 'opacity-60' : ''} ${bgClass} cursor-pointer hover:bg-muted/50 transition-colors`}
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
          <p className='text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 mt-1 inline-flex items-center gap-1'>
            <AlertCircle className='h-3 w-3 shrink-0' />
            Available here - unavailable for {player.supportUnavailable.join(', ')}
          </p>
        )}
        {player.playerNotes && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">“{player.playerNotes}”</p>}

        {visibleConflicts.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {visibleConflicts.map((c, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
                c.type === 'selected' && isDoubleBooked ? 'text-red-700 bg-red-100 font-medium'
                : c.type === 'selected' ? 'text-blue-600 bg-blue-50'
                : 'text-amber-600 bg-amber-50'
                }`}>
                {c.type === 'selected' && isDoubleBooked && <AlertCircle className="h-3 w-3" />}
                {c.type === 'selected' ? `Selected: ${c.team}` : `Available: ${c.team}`}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap gap-1.5">
          {(player.blocks ?? []).map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              <Ban className="h-3 w-3 shrink-0" /> {b.reason}
            </span>
          ))}
          {(player.warnings ?? []).map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
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