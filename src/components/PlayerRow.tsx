import { useState } from 'react';
import { CheckCircle2, Circle, Ban, AlertTriangle, Loader2 } from 'lucide-react';
import {  selectPlayer } from '@/api/selectPlayer';
import { removeSelection } from '@/api/removeSelection';
import { toast } from 'sonner';

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
  player, matchId, checked, onToggleCheck, onRefresh,
}: {
  player: Player; matchId: string; checked: boolean;
  onToggleCheck: () => void; onRefresh: () => void;
}) {
  const [acting, setActing] = useState(false);
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isSelected = !!player.selectionStatus;
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const dimmed = isBlocked || isUnavailable;

  const handleTap = async () => {
    if (isBlocked || acting) return;
    setActing(true);
    try {
      if (isSelected) {
        await removeSelection(player.selectionId);
        toast.success(`${player.preferredName} removed`);
      } else {
        await selectPlayer(matchId, player.id, 'Selected');
        toast.success(`${player.preferredName} selected`);
      }
      onRefresh();
    } catch (e: any) {
      toast.error(e?.message || 'Action failed');
    } finally {
      setActing(false);
    }
  };

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
      <button onClick={handleTap} disabled={isBlocked || acting} className="shrink-0">
        {acting ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
         isSelected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
         isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
         <Circle className="h-5 w-5 text-muted-foreground" />}
      </button>

      {/* Player info */}
      <div className="flex-1 min-w-0" onClick={handleTap}>
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
