import { ActionButton } from '@/components/ui/action-button';

const NOTE_MAX = 280;

/**
 * Pinned to the bottom while a reorder is unsaved: an optional note, Discard
 * and Save. The bottom padding keeps the buttons above the iPhone home bar.
 */
export function RankingSaveBar({ count, note, onNote, saving, onDiscard, onSave }: {
  count: number;
  note: string;
  onNote: (v: string) => void;
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-2">
        <label className="flex-1 min-w-[200px] flex items-center gap-2">
          <span className="sr-only">Note for this change</span>
          <input
            value={note}
            onChange={(e) => onNote(e.target.value)}
            maxLength={NOTE_MAX}
            placeholder="Note (optional)"
            className="flex-1 min-w-0 h-10 text-base sm:text-sm border border-border rounded-md px-3 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {note.length > 0 && <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{note.length}/{NOTE_MAX}</span>}
        </label>
        <div className="flex gap-2 flex-1 min-w-[200px]">
          <ActionButton variant="outline" className="flex-1" onClick={onDiscard} disabled={saving}>
            Discard
          </ActionButton>
          <ActionButton className="flex-1" onClick={onSave} loading={saving}>
            {saving ? 'Saving' : `Save (${count})`}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
