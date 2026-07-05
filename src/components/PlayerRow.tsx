import { CheckCircle2, Circle, Ban } from 'lucide-react';

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
  blocks: { rule: string; reason: string }[];
  warnings: { rule: string; reason: string }[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectionStatus: string;
  selectionId: string;
};

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

export default function PlayerRow({
  player, checked, onToggleCheck, onToggleSelection,
}: {
  player: Player; 
  checked: boolean;
  onToggleCheck: () => void; 
  onToggleSelection: () => void;
}) {
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isSelected = !!player.selectionStatus;
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const dimmed = isBlocked || isUnavailable;

  return (
    <div className={`flex items-center gap-3 py-3 border-b border-border ${dimmed ? 'opacity-50' : ''}`}>
      {/* Checkbox for bulk */}
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggleCheck}
        className="h-4 w-4 shrink-0 accent-primary"
        disabled={isBlocked}
      />

      {/* Status icon */}
      <button onClick={onToggleSelection} disabled={isBlocked} className="shrink-0">
        {isSelected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
         isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
         <Circle className="h-5 w-5 text-muted-foreground" />}
      </button>

      {/* Player info */}
      <div className="flex-1 min-w-0" onClick={onToggleSelection}>
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">{player.preferredName}</p>
          <span className="text-xs text-muted-foreground shrink-0">
            {POS_SHORT[player.playingPosition] || '—'} · {player.playingAbility || '—'}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {player.registeredTeam || '—'} · {player.playUpCount} play-up{player.playUpCount !== 1 ? 's' : ''} · {player.availabilityStatus}
        </p>

        {/* Player notes */}
        {player.playerNotes && (
          <p className="text-xs text-muted-foreground mt-0.5 italic truncate">"{player.playerNotes}"</p>
        )}

        {/* Conflicts */}
        {player.conflicts.map((c, i) => (
          <span key={i} className="text-xs bg-accent text-accent-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            {c.type === 'reserve' ? 'Reserve' : 'Selected'}: {c.team}
          </span>
        ))}

        {/* Warnings */}
        {player.warnings.map((w, i) => (
          <span key={i} className="text-xs bg-secondary text-secondary-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            ⚠ {w.reason}
          </span>
        ))}

        {/* Blocks */}
        {player.blocks.map((b, i) => (
          <span key={i} className="text-xs bg-destructive text-destructive-foreground rounded px-1 py-0.5 inline-block mt-1 mr-1">
            {b.reason}
          </span>
        ))}
      </div>

      {/* Selection badge */}
      {isSelected && (
        <span className={`text-xs px-2 py-0.5 rounded shrink-0 ${
          player.selectionStatus === 'Reserve'
            ? 'bg-muted text-muted-foreground'
            : 'bg-primary text-primary-foreground'
        }`}>
          {player.selectionStatus}
        </span>
      )}
    </div>
  );
}