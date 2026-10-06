import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input, inputClass } from '@/components/ui/input';
import { AdminBlock, RefusalNote } from '@/components/admin/AdminBlock';
import {
  MEMBERSHIP_FIELDS,
  membershipChange,
  membershipDraft,
  membershipProblem,
  removedPeriodsNote,
  saveRefusal,
  type MembershipDraft,
  type SaveRefusal,
} from '@/lib/peopleAdmin';
import { saveMembership, type PersonMembership } from '@/api/adminPeople';

/**
 * Member type, category, membership number, join date and commitment end.
 * Sends only what changed, with what the screen read (`expect`); a 409 says
 * someone saved first, or that the number is already someone else's.
 */
export default function MembershipBlock({
  personId,
  membership,
  onSaved,
  onReload,
}: {
  personId: string;
  membership: PersonMembership;
  onSaved: () => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState<MembershipDraft>(() => membershipDraft(membership));
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const savedKey = JSON.stringify(membership);
  // A reload or another save brings new values: start again from them.
  useEffect(() => {
    setDraft(membershipDraft(membership));
    setRefusal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const change = membershipChange(membership, draft);
  const problem = membershipProblem(draft);

  const save = useMutation({
    mutationFn: (acknowledged: boolean) =>
      saveMembership(personId, acknowledged ? { ...change!, sharedNumberAcknowledged: true } : change!),
    onSuccess: (r) => {
      setRefusal(null);
      const note = removedPeriodsNote(r.removedPeriods);
      toast.success(note ? `Saved · ${note}` : 'Saved', { duration: note ? 6000 : 3000 });
      onSaved();
    },
    onError: (err) => setRefusal(saveRefusal(err)),
  });

  const set = (key: keyof MembershipDraft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (refusal?.kind !== 'changed') setRefusal(null);
  };

  return (
    <AdminBlock title="Membership">
      <div className="grid gap-3 sm:grid-cols-2">
        {MEMBERSHIP_FIELDS.map((f) => (
          <Field key={f.key} label={f.label} error={f.key === 'commitmentEndDate' ? problem : undefined}>
            {f.type === 'select' ? (
              <select className={inputClass} value={draft[f.key]} onChange={(e) => set(f.key, e.target.value)}>
                <option value="">–</option>
                {/* A stored value the list no longer offers stays choosable. */}
                {draft[f.key] && !f.options?.includes(draft[f.key]) && <option value={draft[f.key]}>{draft[f.key]}</option>}
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                type={f.type}
                value={draft[f.key]}
                maxLength={f.type === 'text' ? 40 : undefined}
                autoComplete="off"
                onChange={(e) => set(f.key, e.target.value)}
              />
            )}
          </Field>
        ))}
      </div>
      {refusal && (
        <RefusalNote refusal={refusal} onReload={onReload} onAcknowledge={() => save.mutate(true)} busy={save.isPending} />
      )}
      {change && (
        <div className="flex gap-2">
          {(!refusal || refusal.kind === 'other') && (
            <ActionButton loading={save.isPending} disabled={!!problem} onClick={() => save.mutate(false)}>
              Save
            </ActionButton>
          )}
          <ActionButton
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setDraft(membershipDraft(membership));
              setRefusal(null);
            }}
          >
            Undo
          </ActionButton>
        </div>
      )}
    </AdminBlock>
  );
}
