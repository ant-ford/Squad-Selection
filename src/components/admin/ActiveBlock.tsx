import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import ConfirmDialog from '@/components/ConfirmDialog';
import { ActionButton } from '@/components/ui/action-button';
import { StatusChip } from '@/components/ui/status-chip';
import { AdminBlock, RefusalNote } from '@/components/admin/AdminBlock';
import { saveRefusal, type SaveRefusal } from '@/lib/peopleAdmin';
import { setPlayerActive } from '@/api/adminPeople';

/** Make inactive / active again (Section Captains; the ranking endpoints). */
export default function ActiveBlock({
  personId,
  name,
  active,
  onSaved,
}: {
  personId: string;
  name: string;
  active: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);

  const change = useMutation({
    mutationFn: () => setPlayerActive(personId, !active),
    onSuccess: () => {
      toast.success(active ? 'Made inactive' : 'Made active');
      setRefusal(null);
      for (const key of ['ranking', 'rankingInactive', 'recentChanges']) void queryClient.invalidateQueries({ queryKey: [key] });
      onSaved();
    },
    onError: (err) => setRefusal(saveRefusal(err)),
  });

  return (
    <AdminBlock title="Active">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          <StatusChip tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</StatusChip>
        </span>
        <ActionButton variant={active ? 'outline' : 'primary'} loading={change.isPending} onClick={() => setConfirming(true)}>
          {active ? 'Make inactive' : 'Make active again'}
        </ActionButton>
      </div>
      {refusal && <RefusalNote refusal={refusal} />}
      {confirming && (
        <ConfirmDialog
          title={active ? `Make ${name} inactive?` : `Make ${name} active again?`}
          message={active ? 'They leave the ranking and squad lists.' : 'They go back on the ranking and squad lists.'}
          confirmLabel={active ? 'Make inactive' : 'Make active'}
          destructive={active}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            change.mutate();
          }}
        />
      )}
    </AdminBlock>
  );
}
