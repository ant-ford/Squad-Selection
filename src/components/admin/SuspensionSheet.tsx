import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Minus, Plus } from 'lucide-react';
import ConfirmDialog from '@/components/ConfirmDialog';
import PersonPicker from '@/components/admin/PersonPicker';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input, inputClass } from '@/components/ui/input';
import { saveRefusal } from '@/lib/peopleAdmin';
import {
  MAX_MATCHES,
  MIN_MATCHES,
  draftFrom,
  draftFromFlag,
  draftProblem,
  emptyDraft,
  isDirty,
  newSuspension,
  stepMatches,
  suspensionChange,
  type SuspensionDraft,
} from '@/lib/suspensions';
import { createSuspension, updateSuspension, type LegacySuspensionRow, type SuspensionRow } from '@/api/suspensions';

/**
 * Add or edit a suspension: player (add only), matches 1-10 or until
 * cleared, from date, reason. Making an old flag a suspension also asks
 * the serving team (the save clears the flag). Closing with something
 * typed asks first.
 */
export default function SuspensionSheet({
  row,
  person,
  flag,
  teams = [],
  today,
  onClose,
  onSaved,
}: {
  /** The suspension to edit; absent to add one. */
  row?: SuspensionRow;
  /** Who to add it for, when opened from the person page. */
  person?: { id: string; name: string } | null;
  /** The old flag to make a suspension. */
  flag?: LegacySuspensionRow;
  /** The serving teams to choose from, with a flag. */
  teams?: string[];
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [start] = useState<SuspensionDraft>(() =>
    row ? draftFrom(row) : flag ? draftFromFlag(flag, today, teams) : emptyDraft(today, person?.id ?? null),
  );
  const [draft, setDraft] = useState<SuspensionDraft>(start);
  const [picked, setPicked] = useState<{ id: string; name: string } | null>(row ? { id: row.player, name: row.name } : person ?? null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = draftProblem(draft);
  const change = row ? suspensionChange(row, draft) : null;
  const set = (patch: Partial<SuspensionDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const save = useMutation({
    mutationFn: () => (row ? updateSuspension(row.id, change!) : createSuspension(newSuspension(draft))),
    onSuccess: () => {
      toast.success(row ? 'Saved' : 'Suspended');
      onSaved();
    },
    onError: (err) => setError(saveRefusal(err).message),
  });

  const close = () => (isDirty(start, draft) && !save.isPending ? setAsking(true) : onClose());
  const until = draft.matches === null;

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0">
        <SheetHeader onClose={close}>
          <SheetTitle>{row ? 'Edit suspension' : 'Add a suspension'}</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-4">
          {row || flag ? (
            <p className="text-sm font-medium text-foreground">{row?.name ?? flag?.name}</p>
          ) : (
            <Field label="Player" required>
              {(control) => (
                <PersonPicker
                  id={control.id}
                  value={picked}
                  onChange={(p) => {
                    setPicked(p ? { id: p.id, name: p.name } : null);
                    set({ playerId: p?.id ?? null });
                  }}
                />
              )}
            </Field>
          )}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground" id="susp-matches">
              Matches
            </span>
            <div className="flex items-center gap-2" role="group" aria-labelledby="susp-matches">
              <ActionButton
                iconOnly
                variant="outline"
                icon={<Minus />}
                aria-label="Decrease"
                disabled={!until && (draft.matches ?? 0) <= MIN_MATCHES}
                onClick={() => set({ matches: stepMatches(draft.matches, -1) })}
              />
              <span className="w-10 text-center text-lg font-semibold tabular-nums text-foreground" aria-live="polite">
                {until ? '–' : draft.matches}
              </span>
              <ActionButton
                iconOnly
                variant="outline"
                icon={<Plus />}
                aria-label="Increase"
                disabled={!until && (draft.matches ?? 0) >= MAX_MATCHES}
                onClick={() => set({ matches: stepMatches(draft.matches, 1) })}
              />
              <ActionButton
                variant={until ? 'primary' : 'outline'}
                aria-pressed={until}
                className="ml-auto"
                onClick={() => set({ matches: until ? 1 : null })}
              >
                Until cleared
              </ActionButton>
            </div>
          </div>
          {draft.servingTeam !== undefined && (
            <Field label="Serving team" required>
              <select className={inputClass} value={draft.servingTeam} onChange={(e) => set({ servingTeam: e.target.value })}>
                <option value="">–</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="From" required>
            <Input type="date" value={draft.fromDate} onChange={(e) => set({ fromDate: e.target.value })} />
          </Field>
          <Field label="Reason" required>
            <textarea
              className={`${inputClass} h-auto min-h-20 py-2`}
              rows={3}
              maxLength={280}
              value={draft.reason}
              onChange={(e) => set({ reason: e.target.value })}
            />
          </Field>
          {error && (
            <p role="alert" className="text-sm text-danger-soft-foreground">
              {error}
            </p>
          )}
          <ActionButton
            fullWidth
            size="md"
            loading={save.isPending}
            disabled={!!problem || (!!row && !change)}
            onClick={() => save.mutate()}
          >
            {row ? 'Save' : 'Suspend'}
          </ActionButton>
        </SheetBody>
      </SheetContent>
      {asking && (
        <ConfirmDialog
          title="Discard changes?"
          message="What you typed here is lost."
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onCancel={() => setAsking(false)}
          onConfirm={onClose}
        />
      )}
    </Sheet>
  );
}
