import { Button } from '@/components/ui/button';

export default function BulkActionBar({
  count,
  onDone,
  onBulkReserve,
}: {
  count: number;
  playerIds: string[];
  matchId: string;
  onDone: () => void;
  onBulkReserve?: () => void;
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-foreground font-medium">{count} checked</p>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => { onBulkReserve?.(); onDone(); }}
          >
            Mark Reserve
          </Button>
          <Button variant="destructive" size="sm" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}