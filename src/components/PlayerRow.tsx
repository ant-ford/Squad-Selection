import React from 'react';
import { CheckCircle2, Circle, Ban, AlertCircle } from 'lucide-react';

type Player = {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  availabilityStatus: string;
  playerNotes: string;
  playUpCount: number;
  eligibilityStatus: string;
  reason: string | null;
  blocks: { rule: string; reason: string }[];
  warnings: string[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectionStatus: string;
  selectionId: string;
  isU21?: boolean;
  isVisitingPlayer?: boolean;
};

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

interface PlayerRowProps {
  player: Player;
  selected: boolean;
  onToggleSelection: () => void;
}

const PlayerRow = React.memo(function PlayerRow({ player, selected, onToggleSelection }: PlayerRowProps) {
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const isMaybe = player.availabilityStatus === 'Maybe';

  let bgClass = '';
  if (isMaybe) bgClass = 'bg-amber-50/70';
  else if (isUnavailable) bgClass = 'bg-red-50/70';

  const dimmed = isBlocked || isUnavailable;

  return (
    <div
      className={`flex items-center gap-3 py-1.5 border-b border-border ${dimmed ? 'opacity-60' : ''} ${bgClass} cursor-pointer hover:bg-muted/50 transition-colors`}
      onClick={!isBlocked ? onToggleSelection : undefined}
    >
      <div className="shrink-0">
        {selected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
          isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
          <Circle className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{player.preferredName}</p>
          {player.isU21 && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-sm shrink-0">U21</span>}
          {player.isVisitingPlayer && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-sm shrink-0">VP</span>}
          <span className="text-xs text-muted-foreground shrink-0">{POS_SHORT[player.playingPosition] || '–'} · Ability {player.playingAbility || '–'}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          {player.registeredTeam || '–'} · {player.playUpCount} play-up{player.playUpCount !== 1 ? 's' : ''} · {player.availabilityStatus}
        </p>
        {player.playerNotes && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">“{player.playerNotes}”</p>}

        {/* Cross-team conflict badges */}
        {player.conflicts?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {player.conflicts.map((c, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${c.type === 'selected' ? 'text-blue-600 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
                {c.type === 'selected' ? `Selected: ${c.team}` : `Available: ${c.team}`}
              </span>
            ))}
          </div>
        )}

        {/* Blocks (reason) + warnings with icons */}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(player.blocks ?? []).map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              <Ban className="h-3 w-3 shrink-0" /> {b.reason}
            </span>
          ))}
          {(player.warnings ?? []).map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              <AlertCircle className="h-3 w-3 shrink-0" /> {w}
            </span>
          ))}
        </div>
      </div>
      {selected && <span className="text-xs px-2 py-0.5 rounded shrink-0 bg-primary text-primary-foreground">Selected</span>}
    </div>
  );
});

export default PlayerRow;