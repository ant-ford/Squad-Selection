import { initials } from '@/lib/format';
import type { MatchPlayer } from '@/api/getPlayersForMatch';

/** The squad screen's bottom bar while there are unsaved changes: who changed, Discard and Save. */
export default function SquadSaveBar({
  pendingPlayers,
  changeCount,
  saving,
  onDiscard,
  onSave,
}: {
  pendingPlayers: MatchPlayer[];
  changeCount: number;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-3 sm:p-4 flex gap-3 z-bar items-center" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
      <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
        {pendingPlayers.slice(0, 4).map(p => (
          <span key={p.id} className="text-xs px-2 py-1 rounded-full bg-primary-tint/10 text-primary shrink-0 font-medium">
            {initials(p.preferredName)}
          </span>
        ))}
        {pendingPlayers.length > 4 && (
          <span className="text-xs text-muted-foreground shrink-0">+{pendingPlayers.length - 4} more</span>
        )}
      </div>
      <button onClick={onDiscard} className="flex-1 min-h-11 border rounded text-sm font-medium">Discard</button>
      <button onClick={onSave} disabled={saving} className="flex-1 min-h-11 bg-primary text-primary-foreground rounded text-sm font-medium disabled:opacity-60">
        {saving ? 'Saving...' : `Save (${changeCount})`}
      </button>
    </div>
  );
}
