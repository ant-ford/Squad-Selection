import { toast } from 'sonner';
import type { KitMoveResult } from '@shared/kit';

/** "Handed 20 to Ben. Not moved: #12 already with Sam, #40 still on order." */
export function reportMove(result: KitMoveResult, toName: string) {
  const n = result.moved.length;
  if (n > 0) toast.success(`${n} kit${n === 1 ? '' : 's'} now with ${toName}`);
  const o = result.offered?.length ?? 0;
  if (o > 0) toast.success(`${toName} will be asked to confirm they've got ${o === 1 ? 'it' : `all ${o}`}`);
  if (result.conflicts.length > 0) {
    toast.warning(
      `Not moved: ${result.conflicts.map((c) => `${c.shirtNo !== null ? `#${c.shirtNo}` : 'a set'} ${c.reason}`).join(', ')}`,
      { duration: 10_000 },
    );
  }
}
