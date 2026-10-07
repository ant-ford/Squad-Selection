import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { ChevronDown, Plus, X } from 'lucide-react';
import PersonPicker from '@/components/admin/PersonPicker';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clubRefusal, squadSize, teamChange, teamDraft, teamSummary, withHolder, type TeamDraft } from '@/lib/club';
import { saveTeam, type Holder, type TeamAdminView } from '@/api/club';

function PeopleList({
  label,
  list,
  onChange,
}: {
  label: string;
  list: Holder[];
  onChange: (list: Holder[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium text-foreground">{label}</p>
      {list.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {list.map((h) => (
            <li key={h.id} className="inline-flex items-center gap-1 rounded-full bg-muted pl-3 text-sm text-foreground">
              {h.name}
              <button
                type="button"
                onClick={() => onChange(list.filter((x) => x.id !== h.id))}
                aria-label={`Remove ${h.name}`}
                className="h-10 w-10 inline-flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <PersonPicker
          value={null}
          onChange={(p) => {
            if (p) onChange(withHolder(list, { id: p.id, name: p.name }));
            setAdding(false);
          }}
        />
      ) : (
        <ActionButton variant="ghost" icon={<Plus />} aria-label={`Add to ${label}`} onClick={() => setAdding(true)}>
          Add
        </ActionButton>
      )}
    </div>
  );
}

/** One team: a summary line, opening to coaches, captains and target squad size. */
export default function TeamCard({ team, onSaved }: { team: TeamAdminView; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TeamDraft>(() => teamDraft(team));
  const [error, setError] = useState<string | null>(null);
  const savedKey = JSON.stringify([team.coaches, team.captains, team.targetSquadSize]);
  useEffect(() => {
    setDraft(teamDraft(team));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const change = teamChange(team, draft);
  const sizeBad = draft.targetSquadSize.trim() !== '' && squadSize(draft.targetSquadSize) === null;
  const set = (patch: Partial<TeamDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const save = useMutation({
    mutationFn: () => saveTeam(team.id, change!),
    onSuccess: () => {
      toast.success(`${team.name} saved`);
      onSaved();
    },
    onError: (err) => setError(clubRefusal(err).message),
  });

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 min-h-12 px-3 py-2 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-foreground">{team.name}</span>
          <span className="block text-xs text-muted-foreground truncate">{teamSummary(team)}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <PeopleList label="Coaches" list={draft.coaches} onChange={(coaches) => set({ coaches })} />
          <PeopleList label="Captains" list={draft.captains} onChange={(captains) => set({ captains })} />
          <Field label="Target squad size" error={sizeBad ? '1 to 40' : undefined} className="max-w-40">
            <Input inputMode="numeric" maxLength={2} value={draft.targetSquadSize} onChange={(e) => set({ targetSquadSize: e.target.value })} />
          </Field>
          {team.sectionCaptains.length > 0 && (
            <p className="text-xs text-muted-foreground">Section Captains: {team.sectionCaptains.map((h) => h.name).join(', ')}</p>
          )}
          {error && (
            <p role="alert" className="text-sm text-danger-soft-foreground">
              {error}
            </p>
          )}
          {change && (
            <div className="flex gap-2">
              <ActionButton loading={save.isPending} onClick={() => save.mutate()}>
                Save
              </ActionButton>
              <ActionButton variant="ghost" disabled={save.isPending} onClick={() => set(teamDraft(team))}>
                Undo
              </ActionButton>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
