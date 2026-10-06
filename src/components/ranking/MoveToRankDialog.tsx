import { useState } from 'react';
import { Info } from 'lucide-react';
import type { Player } from '@shared/schema/domainTypes';
import type { RankingChange } from '@/lib/queries';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { getReversalAdvisory, formatAge, formatAbsolute } from '@/lib/rankingHistory';
import { nameOf, parseRank } from '@/lib/rankingModel';
import { toneClasses } from '@/lib/statusTone';
import { RankingSheet } from './RankingSheet';

/** A small dialog: type the new rank, Move. The change is staged until Save. */
export function MoveToRankDialog({ player, activeCount, onClose, onSubmit, history }: {
  player: Player;
  activeCount: number;
  onClose: () => void;
  onSubmit: (rank: number) => void;
  history?: RankingChange[];
}) {
  const [value, setValue] = useState(String(player.sectionRank ?? 1));
  const [error, setError] = useState('');

  // Non-blocking: if someone recently moved this player, say so. The coach
  // is always free to go ahead.
  const advisory = history ? getReversalAdvisory(history, player.id) : null;

  const submit = () => {
    const rank = parseRank(value, activeCount);
    if (rank === null) setError(`Enter a whole number from 1 to ${activeCount}.`);
    else onSubmit(rank);
  };

  return (
    <RankingSheet title={`Move ${nameOf(player)}`} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {advisory && (
          <div className={`p-3 rounded-lg border text-xs flex items-start gap-2 ${toneClasses('warning', 'chip')}`}>
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">
                Recently moved {advisory.oldRank != null && advisory.newRank != null && advisory.newRank < advisory.oldRank ? 'up' : 'down'} by{' '}
                {advisory.actorName}
              </p>
              <p>
                {formatAge(advisory.at)} · {formatAbsolute(advisory.at)}
                {advisory.note ? ` · "${advisory.note}"` : ''}
              </p>
            </div>
          </div>
        )}
        <Field label="New rank" hint={`Now #${player.sectionRank || '–'} · 1 to ${activeCount}`} error={error || undefined}>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={activeCount}
            autoFocus
            value={value}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setValue(e.target.value);
              setError('');
            }}
          />
        </Field>
        <div className="flex gap-2">
          <ActionButton variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </ActionButton>
          <ActionButton type="submit" className="flex-1">
            Move
          </ActionButton>
        </div>
      </form>
    </RankingSheet>
  );
}
