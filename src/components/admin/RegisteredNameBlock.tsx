import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRegisteredNameSuggestions, saveRegisteredName } from '@/api/adminPeople';
import EddyWordmark from '@/components/brand/EddyWordmark';
import { AdminBlock, RefusalNote } from './AdminBlock';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input, inputClass } from '@/components/ui/input';
import { saveRefusal, type SaveRefusal } from '@/lib/peopleAdmin';
import { toast } from '@/lib/toast';
import { registeredNameProblem, tidyRegisteredName } from '@shared/registration';

/** The stored name stays authoritative; suggestions fill a draft, then Save confirms it. */
export default function RegisteredNameBlock({ personId, registeredName, editable, onSaved, onReload }: {
  personId: string;
  registeredName: string | null;
  editable: boolean;
  onSaved: () => void;
  onReload: () => void;
}) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(registeredName ?? '');
  const [refusal, setRefusal] = useState<SaveRefusal | null>(null);
  const suggestions = useQuery({
    queryKey: ['registeredNameSuggestions', personId],
    queryFn: () => getRegisteredNameSuggestions(personId),
    enabled: editable && !registeredName,
    staleTime: 30_000,
  });
  const value = tidyRegisteredName(draft) || null;
  const problem = registeredNameProblem(value ?? '');
  const changed = value !== registeredName;
  const save = useMutation({
    mutationFn: () => saveRegisteredName(personId, value, registeredName),
    onSuccess: (result) => {
      setRefusal(null);
      toast.success(result.linked ? `Saved · ${result.linked} match card${result.linked === 1 ? '' : 's'} linked` : 'Saved');
      // Name/link changes are visible across officer, coaching and player screens.
      void client.invalidateQueries();
      onSaved();
    },
    onError: (err) => setRefusal(saveRefusal(err)),
  });
  const edit = (name: string) => {
    setDraft(name);
    if (refusal?.kind !== 'changed') setRefusal(null);
  };
  if (!editable) return (
    <AdminBlock title="HockeyHK registration">
      <dl><dt className="text-xs text-muted-foreground">Registered name</dt>
        <dd className="text-sm break-words">{registeredName ?? 'Not set'}</dd></dl>
      <p className="text-xs text-muted-foreground">The Men’s Convenor can update this name.</p>
    </AdminBlock>
  );
  return (
    <AdminBlock title="HockeyHK registration">
      <Field label="HockeyHK registered name" hint={<>Use the name exactly as HockeyHK records it. This updates <EddyWordmark />’s match-card matching.</>} error={problem}>
        <Input value={draft} maxLength={80} disabled={save.isPending} onChange={(e) => edit(e.target.value)} autoComplete="off" />
      </Field>
      {!registeredName && (
        suggestions.isPending ? <p role="status" className="text-xs text-muted-foreground">Finding suggested names…</p> :
        suggestions.isError ? (
          <div className="text-xs text-muted-foreground">
            <p>Suggested names didn’t load. You can still enter the name.</p>
            <ActionButton variant="ghost" loading={suggestions.isFetching} onClick={() => void suggestions.refetch()}>Retry suggestions</ActionButton>
          </div>
        ) : suggestions.data?.suggestions.length ? (
          <Field label="Suggested names" hint="Best matches first, from this season’s match cards. Check the name before saving.">
            <select className={inputClass} value="" disabled={save.isPending} onChange={(e) => e.target.value && edit(e.target.value)}>
              <option value="">Choose a suggested name</option>
              {suggestions.data.suggestions.map((s) => (
                <option key={s.name} value={s.name}>
                  {s.name} · {s.source === 'format' ? 'Suggested format — check with HockeyHK' : `${s.cards} match card${s.cards === 1 ? '' : 's'}${s.teams.length ? ` · ${s.teams.join(', ')}` : ''}`}
                </option>
              ))}
            </select>
          </Field>
        ) : <p className="text-xs text-muted-foreground">No suggested names found. Enter the name from HockeyHK.</p>
      )}
      {refusal && <RefusalNote refusal={refusal} onReload={onReload} />}
      {changed && (
        <div className="flex gap-2">
          {refusal?.kind !== 'changed' && <ActionButton loading={save.isPending} disabled={!!problem} onClick={() => save.mutate()}>Save registered name</ActionButton>}
          <ActionButton variant="ghost" disabled={save.isPending} onClick={() => { setDraft(registeredName ?? ''); setRefusal(null); }}>Undo</ActionButton>
        </div>
      )}
    </AdminBlock>
  );
}
