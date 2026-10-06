import { useState } from 'react';
import { toast } from 'sonner';
import ConfirmDialog from '@/components/ConfirmDialog';
import PersonPicker from '@/components/admin/PersonPicker';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { clubRefusal, handoverFrom, newPersonProblem, type OfficeGroup } from '@/lib/club';
import { addOffice, createPerson, type Holder, type NewPerson } from '@/api/club';

const EMPTY: NewPerson = { preferredName: '', givenNames: '', surname: '', email: '' };

/**
 * Add a holder to an office, or hand a one-holder office over (the current
 * holder's row goes as `replaces` and is retired in the same save). Someone
 * not in People can be added on the spot.
 */
export default function OfficeSheet({
  group,
  onClose,
  onSaved,
  onStale,
}: {
  group: OfficeGroup;
  onClose: () => void;
  onSaved: () => void;
  /** The office list is out of date (409 ONE_HOLDER): reload it. */
  onStale: () => void;
}) {
  const from = handoverFrom(group);
  const [picked, setPicked] = useState<Holder | null>(null);
  const [creating, setCreating] = useState(false);
  const [person, setPerson] = useState<NewPerson>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const dirty = !!picked || Object.values(person).some((v) => (v ?? '').trim() !== '');
  const problem = creating ? newPersonProblem(person) : picked ? null : 'Choose who.';
  const close = () => (dirty && !busy ? setAsking(true) : onClose());
  const setField = (k: keyof NewPerson, v: string) => {
    setPerson((p) => ({ ...p, [k]: v }));
    setError(null);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    let who = picked;
    try {
      if (creating) {
        const r = await createPerson({
          preferredName: person.preferredName?.trim() || null,
          givenNames: person.givenNames?.trim() || null,
          surname: person.surname.trim(),
          email: person.email.trim(),
        });
        who = { id: r.id, name: [person.preferredName || person.givenNames, person.surname].filter((s) => s && s.trim()).join(' ') };
        // Added to People now: a retry must not add them twice.
        setPicked(who);
        setCreating(false);
        setPerson(EMPTY);
      }
      await addOffice({ office: group.office, personId: who!.id, ...(from ? { replaces: from.id } : {}) });
      toast.success(from ? 'Handed over' : 'Added');
      onSaved();
    } catch (err) {
      const r = clubRefusal(err);
      setError(r.message);
      if (r.code === 'ONE_HOLDER') onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent side="bottom" className="sm:max-w-lg sm:mx-auto sm:left-0 sm:right-0 p-4 space-y-4">
        <SheetHeader onClose={close}>
          <SheetTitle>{from ? `Hand over ${group.label}` : `Add ${group.label}`}</SheetTitle>
        </SheetHeader>
        {from && <p className="text-sm text-muted-foreground">From {from.holder?.name ?? 'the current holder'}</p>}
        {creating ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Preferred name">
                <Input value={person.preferredName ?? ''} maxLength={60} onChange={(e) => setField('preferredName', e.target.value)} />
              </Field>
              <Field label="Given names">
                <Input value={person.givenNames ?? ''} maxLength={80} onChange={(e) => setField('givenNames', e.target.value)} />
              </Field>
            </div>
            <Field label="Surname" required>
              <Input value={person.surname} maxLength={60} onChange={(e) => setField('surname', e.target.value)} />
            </Field>
            <Field label="Email" required>
              <Input type="email" inputMode="email" autoComplete="off" value={person.email} maxLength={200} onChange={(e) => setField('email', e.target.value)} />
            </Field>
            <ActionButton variant="ghost" onClick={() => setCreating(false)}>
              Find in People instead
            </ActionButton>
          </div>
        ) : (
          <Field label="Who" required>
            {(control) => (
              <div className="space-y-1">
                <PersonPicker id={control.id} value={picked} onChange={(p) => { setPicked(p ? { id: p.id, name: p.name } : null); setError(null); }} />
                {!picked && (
                  <ActionButton variant="ghost" onClick={() => setCreating(true)}>
                    Not in People? Add them
                  </ActionButton>
                )}
              </div>
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger-soft-foreground">
            {error}
          </p>
        )}
        <ActionButton fullWidth size="md" loading={busy} disabled={!!problem} onClick={() => void save()}>
          {from ? `Hand over from ${from.holder?.name ?? 'the current holder'}` : 'Add'}
        </ActionButton>
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
