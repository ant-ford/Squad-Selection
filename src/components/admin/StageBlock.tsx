import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ActionButton } from '@/components/ui/action-button';
import { inputClass } from '@/components/ui/input';
import { AdminBlock, RefusalNote } from '@/components/admin/AdminBlock';
import { saveRefusal, stageGroups, stageMoveNeedsConfirm, type SaveRefusal } from '@/lib/peopleAdmin';
import { moveStage } from '@/api/adminPeople';

/** Moves the applicant stage by hand, to any stage the API offers. */
export default function StageBlock({
  personId,
  stage,
  targets,
  onSaved,
  onReload,
}: {
  personId: string;
  stage: string | null;
  targets: string[];
  onSaved: () => void;
  onReload: () => void;
}) {
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const groups = stageGroups(targets);

  const move = useMutation({
    mutationFn: () => moveStage(personId, target, stage),
    onSuccess: () => {
      toast.success(`Moved to ${target}`);
      setTarget('');
      setRefusal(null);
      onSaved();
    },
    onError: (err) => setRefusal(saveRefusal(err)),
  });

  const go = () => (stageMoveNeedsConfirm(target) ? setConfirming(true) : move.mutate());

  return (
    <AdminBlock title="Stage">
      <p className="text-sm text-foreground">{stage ?? 'No stage'}</p>
      <div className="flex gap-2">
        <select
          className={`${inputClass} flex-1 min-w-0`}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setRefusal(null);
          }}
          aria-label="Move to"
        >
          <option value="">Move to…</option>
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ActionButton disabled={!target} loading={move.isPending} onClick={go}>
          Move
        </ActionButton>
      </div>
      {refusal && <RefusalNote refusal={refusal} onReload={onReload} />}
      {confirming && (
        <ConfirmDialog
          title={`Move to ${target}?`}
          message="Their application stops here."
          confirmLabel="Move"
          destructive
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            move.mutate();
          }}
        />
      )}
    </AdminBlock>
  );
}
