import { Wand2, X, Settings2, MessageCircle, History, EyeOff } from 'lucide-react';

/**
 * The squad screen's bar, pinned while the list scrolls under it: select
 * all, start from the last squad, auto-select and its priority list, Notify
 * and the "not seen" WhatsApp list.
 */
export default function SquadToolbar({
  allVisibleSelected,
  onToggleAll,
  lastSquadCount,
  onStartFromLast,
  autoSelectEnabled,
  autoSelectPending,
  onToggleAutoSelect,
  canNotify,
  selectedCount,
  onNotify,
  notSeenCount,
  onNotSeen,
  autoSelectedCount,
  priorityCount,
  showPriorityManager,
  onTogglePriorityManager,
  suppressedCount,
  onRescan,
}: {
  allVisibleSelected: boolean;
  onToggleAll: () => void;
  /** Players in the team's last squad, when the screen can start from it; null otherwise. */
  lastSquadCount: number | null;
  onStartFromLast: () => void;
  autoSelectEnabled: boolean;
  autoSelectPending: boolean;
  onToggleAutoSelect: (enabled: boolean) => void;
  canNotify: boolean;
  selectedCount: number;
  onNotify: () => void;
  notSeenCount: number;
  onNotSeen: () => void;
  autoSelectedCount: number | null;
  priorityCount: number;
  showPriorityManager: boolean;
  onTogglePriorityManager: () => void;
  suppressedCount: number;
  onRescan: () => void;
}) {
  return (
    <div className="sticky top-0 z-sticky bg-background border-b border-border/50">
    <div className="container mx-auto px-4 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex items-center gap-2 min-h-10">
        <input
          type="checkbox"
          id="toggle-all"
          className="h-4 w-4 accent-primary"
          checked={allVisibleSelected}
          onChange={onToggleAll}
        />
        <label htmlFor="toggle-all" className="text-sm font-medium text-muted-foreground cursor-pointer select-none">Select all</label>
      </div>
      {lastSquadCount !== null && (
        <button
          onClick={onStartFromLast}
          className="inline-flex items-center gap-1.5 px-3 min-h-10 rounded-full text-xs sm:text-sm font-medium border border-border bg-muted text-muted-foreground hover:bg-muted/80"
        >
          <History className="h-3.5 w-3.5" />
          Last squad ({lastSquadCount})
        </button>
      )}
      <div className="w-px h-5 bg-border/50 hidden sm:block" />

      <button
        onClick={() => onToggleAutoSelect(!autoSelectEnabled)}
        disabled={autoSelectPending}
        aria-pressed={autoSelectEnabled}
        className={`
          inline-flex items-center gap-2 px-3 min-h-10 rounded-full text-xs sm:text-sm font-medium
          transition-all duration-150 border select-none
          ${autoSelectEnabled
            ? 'bg-primary-tint/10 text-primary border-primary/30 hover:bg-primary-tint/15'
            : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
          }
          ${autoSelectPending ? 'opacity-60' : ''}
        `}
      >
        <Wand2 className={`h-3.5 w-3.5 ${autoSelectEnabled ? 'text-primary' : ''}`} />
        <span>Auto-select</span>
        <span className={`
          inline-flex items-center justify-center w-7 h-4 rounded-full transition-colors duration-150
          ${autoSelectEnabled ? 'bg-primary' : 'bg-border'}
        `}>
          <span className={`
            inline-block w-3 h-3 rounded-full bg-white transition-transform duration-150
            ${autoSelectEnabled ? 'translate-x-1.5' : '-translate-x-1.5'}
          `} />
        </span>
      </button>

      {/* Shown with nobody selected too: the sheet then asks for availability. */}
      {canNotify && (
        <button
          onClick={onNotify}
          className="inline-flex items-center gap-1 min-h-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
          title={
            selectedCount > 0
              ? 'Message the selected squad on WhatsApp'
              : 'Ask the team group for availability on WhatsApp'
          }
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {selectedCount > 0 ? `Notify (${selectedCount})` : 'Notify'}
        </button>
      )}

      {canNotify && notSeenCount > 0 && (
        <button
          onClick={onNotSeen}
          className="inline-flex items-center gap-1 min-h-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
          title="WhatsApp the players who haven't opened Eddy for 6+ weeks"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Not seen ({notSeenCount})
        </button>
      )}

      {autoSelectEnabled && (
        <>
          {autoSelectedCount !== null && (
            <span className="text-xs text-muted-foreground hidden sm:inline">
              {autoSelectedCount}/{priorityCount} auto-selected
            </span>
          )}
          <button
            onClick={onTogglePriorityManager}
            aria-expanded={showPriorityManager}
            className="inline-flex items-center gap-1 min-h-10 text-sm text-muted-foreground hover:text-foreground transition-colors"
            title="Edit priority player list"
          >
            <Settings2 className="h-3 w-3" />
            {priorityCount === 0 ? 'Add priority players' : `${priorityCount} priority`}
          </button>
        </>
      )}

      {autoSelectEnabled && suppressedCount > 0 && (
        <button
          onClick={onRescan}
          className="min-h-10 text-sm text-muted-foreground underline hover:text-foreground"
        >
          <X className="inline h-3 w-3 mr-0.5" />
          {suppressedCount} excluded — rescan
        </button>
      )}
    </div>
    </div>
  );
}
