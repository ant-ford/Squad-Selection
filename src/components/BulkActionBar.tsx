import { useState } from 'react';
import { selectPlayer, removeSelection } from 'zite-endpoints-sdk';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

export default function BulkActionBar({
  count, playerIds, matchId, onDone,
}: {
  count: number; playerIds: string[]; matchId: string; onDone: () => void;
}) {
  const [acting, setActing] = useState(false);

  const handleBulkReserve = async () => {
    setActing(true);
    let ok = 0;
    for (const pid of playerIds) {
      try {
        await selectPlayer({ matchId, playerId: pid, selectionStatus: 'Reserve' });
        ok++;
      } catch { /* skip failures */ }
    }
    toast.success(`${ok} player${ok !== 1 ? 's' : ''} marked as reserve`);
    setActing(false);
    onDone();
  };

  const handleBulkRemove = async () => {
    // This would need selection IDs — for now show a message
    toast.info('To bulk remove, deselect players individually');
    onDone();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-card z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-foreground font-medium">{count} checked</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleBulkReserve} disabled={acting}>
            {acting && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Mark Reserve
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBulkRemove} disabled={acting}>
            Remove
          </Button>
        </div>
      </div>
    </div>
  );
}
