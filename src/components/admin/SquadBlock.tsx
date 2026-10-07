import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { inputClass } from '@/components/ui/input';
import { AdminBlock, RefusalNote } from '@/components/admin/AdminBlock';
import { saveRefusal, squadChange, squadDraft, squadFields, withCurrent, type SaveRefusal, type SquadDraft } from '@/lib/peopleAdmin';
import { saveSquad, type PersonAdminCan, type PersonSquad } from '@/api/adminPeople';

/**
 * Registered team (the Men's Convenor only), selected teams at the start
 * and end of season, and position. Sends only what changed, with what the
 * screen read (`expect`); a 409 says someone saved first.
 */
export default function SquadBlock({
  personId,
  squad,
  teamOptions,
  can,
  onSaved,
  onReload,
}: {
  personId: string;
  squad: PersonSquad;
  teamOptions: string[];
  can: Pick<PersonAdminCan, 'squad' | 'registeredTeam'>;
  onSaved: () => void;
  onReload: () => void;
}) {
  const fields = squadFields(can, teamOptions);
  const [draft, setDraft] = useState<SquadDraft>(() => squadDraft(squad));
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const savedKey = JSON.stringify(squad);
  // A reload or another save brings new values: start again from them.
  useEffect(() => {
    setDraft(squadDraft(squad));
    setRefusal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const change = squadChange(
    squad,
    draft,
    fields.map((f) => f.key),
  );
  const save = useMutation({
    mutationFn: () => saveSquad(personId, change!),
    onSuccess: () => {
      setRefusal(null);
      toast.success('Saved');
      onSaved();
    },
    onError: (err) => setRefusal(saveRefusal(err)),
  });

  if (fields.length === 0) return null;
  return (
    <AdminBlock title="Squad">
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            <select
              className={inputClass}
              value={draft[f.key]}
              onChange={(e) => {
                const value = e.target.value;
                setDraft((d) => ({ ...d, [f.key]: value }));
                if (refusal?.kind !== 'changed') setRefusal(null);
              }}
            >
              <option value="">–</option>
              {withCurrent(f.options, draft[f.key]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {refusal && <RefusalNote refusal={refusal} onReload={onReload} />}
      {change && (
        <div className="flex gap-2">
          {refusal?.kind !== 'changed' && (
            <ActionButton loading={save.isPending} onClick={() => save.mutate()}>
              Save
            </ActionButton>
          )}
          <ActionButton
            variant="ghost"
            disabled={save.isPending}
            onClick={() => {
              setDraft(squadDraft(squad));
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
