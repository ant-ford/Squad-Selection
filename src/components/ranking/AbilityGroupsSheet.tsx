import { useEffect, useState } from 'react';
import type { AbilityGroupConfigMap } from '@shared/schema/domainTypes';
import { ActionButton } from '@/components/ui/action-button';
import { inputClass } from '@/components/ui/input';
import { ABILITY_GROUPS } from '@/lib/rankingModel';
import { abilityFill } from '@/lib/abilityColour';

/** Section Captains: how many players each ability group A-G holds. H takes the rest. */
export function AbilityGroupsSheet({ config, activeCount, saving, onClose, onSave }: {
  config: AbilityGroupConfigMap;
  activeCount: number;
  saving: boolean;
  onClose: () => void;
  onSave: (config: AbilityGroupConfigMap) => void;
}) {
  const [local, setLocal] = useState<AbilityGroupConfigMap>({ ...config });
  useEffect(() => { setLocal({ ...config }); }, [config]);
  const total = ABILITY_GROUPS.reduce((acc, g) => acc + (local[g] ?? 0), 0);
  const overCapacity = total > activeCount;
  const rest = Math.max(0, activeCount - total);

  return (
    <>
      <div className="space-y-2">
        {ABILITY_GROUPS.map((g) => (
          <label key={g} className="flex items-center gap-3">
            <span className="w-6 text-base font-bold text-foreground">{g}</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              disabled={saving}
              value={local[g] ?? 0}
              aria-label={`Players in group ${g}`}
              onChange={(e) => setLocal((s) => ({ ...s, [g]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              className={`${inputClass} flex-1`}
            />
          </label>
        ))}
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <span className="w-6 text-base font-bold text-foreground">H</span>
          <span className="flex-1 text-sm text-muted-foreground">The rest ({rest})</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex h-5 rounded-full overflow-hidden border border-border" aria-hidden="true">
          {ABILITY_GROUPS.map((g) => {
            const cap = local[g] ?? 0;
            if (cap === 0 || activeCount === 0) return null;
            const pct = (cap / activeCount) * 100;
            return (
              <div
                key={g}
                className="h-full flex items-center justify-center text-xs font-bold text-white transition-all duration-200"
                style={{ width: `${pct}%`, backgroundColor: abilityFill(g) }}
              >
                {pct > 6 ? g : ''}
              </div>
            );
          })}
          {rest > 0 && (
            <div
              className="h-full flex items-center justify-center text-xs font-bold text-white transition-all duration-200"
              style={{ width: `${(rest / activeCount) * 100}%`, backgroundColor: abilityFill('H') }}
            >
              {(rest / activeCount) * 100 > 6 ? 'H' : ''}
            </div>
          )}
        </div>
        <p className={`text-xs text-right ${overCapacity ? 'text-danger-soft-foreground font-medium' : 'text-muted-foreground'}`}>
          A–G: {total} of {activeCount} active{overCapacity ? ' (too many)' : ''}
        </p>
      </div>

      <div className="flex gap-2 mt-4">
        <ActionButton variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</ActionButton>
        <ActionButton className="flex-1" disabled={overCapacity} loading={saving} onClick={() => onSave(local)}>
          Save
        </ActionButton>
      </div>
    </>
  );
}
