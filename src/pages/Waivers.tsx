import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import SignaturePad from '@/components/SignaturePad';
import { Skeleton } from '@/components/ui/skeleton';
import { ActionButton } from '@/components/ui/action-button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/apiClient';
import { errorMessage } from '@/lib/errorMessages';
import { formGaps } from '@/lib/formGaps';
import { useFormGaps } from '@/lib/useFormGaps';
import { differs } from '@/lib/drafts';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { LONG_DATE, safeFormat } from '@/lib/dateUtils';
import { getMyDeclarations, submitDeclarations } from '@/api/declarations';
import {
  CODE_OF_CONDUCT,
  DECLARATION_ITEMS,
  GUARDIAN_CONFIRM,
  guardianConsent,
  type DeclarationsView,
} from '@shared/declarations';

function Tick({ id, checked, onChange, children }: { id?: string; checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex gap-3 items-start py-2 cursor-pointer">
      <input id={id} type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-foreground">{children}</span>
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {children}
    </section>
  );
}

function Form({ view, onDone }: { view: DeclarationsView; onDone: () => void }) {
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [guardian, setGuardian] = useState(view.guardian);
  const [signature, setSignature] = useState<string | null>(null);
  const tick = (key: string) => (v: boolean) => setTicked((t) => ({ ...t, [key]: v }));
  const guardianName = [guardian.givenNames, guardian.surname].filter(Boolean).join(' ');

  const submit = useMutation({
    mutationFn: () =>
      submitDeclarations({
        version: view.version,
        accepted: Object.keys(ticked).filter((k) => ticked[k]),
        ...(view.underEighteen ? { guardian, signature: signature ?? undefined } : {}),
      }),
    onSuccess: () => {
      // Saved: going home next isn't leaving anything behind.
      leave.allowNavigation();
      onDone();
    },
  });

  const firstUnticked = DECLARATION_ITEMS.find((i) => !ticked[i.key]);
  const validEmail = /^\S+@\S+\.\S+$/.test(guardian.email.trim());
  const gaps = useFormGaps(
    formGaps([
      [!!firstUnticked, { id: `tick-${firstUnticked?.key}`, label: 'Tick every box' }],
      ...(view.underEighteen
        ? ([
            [!guardian.givenNames.trim(), { id: 'guardian-given', label: "Parent or guardian's given name(s)" }],
            [!guardian.surname.trim(), { id: 'guardian-surname', label: "Parent or guardian's surname" }],
            [!guardian.mobileNo.trim(), { id: 'guardian-mobile', label: "Parent or guardian's mobile" }],
            [!validEmail, { id: 'guardian-email', label: "Parent or guardian's email" }],
            [!ticked[GUARDIAN_CONFIRM.key], { id: `tick-${GUARDIAN_CONFIRM.key}`, label: "Parent or guardian's consent" }],
            [!signature, { id: 'guardian-signature', label: "Parent or guardian's signature" }],
          ] as const)
        : []),
    ]),
  );
  const leave = useUnsavedChanges(
    !submit.isSuccess && (Object.values(ticked).some(Boolean) || !!signature || differs(guardian, view.guardian)),
  );

  return (
    <>
      <Section title={CODE_OF_CONDUCT.title}>
        {CODE_OF_CONDUCT.intro.map((p) => <p key={p} className="text-sm text-muted-foreground">{p}</p>)}
        <p className="text-sm font-medium text-foreground pt-1">{CODE_OF_CONDUCT.examplesIntro}</p>
        {CODE_OF_CONDUCT.examples.map((group) => (
          <div key={group.heading}>
            <p className="text-xs font-semibold text-foreground mt-2">{group.heading}</p>
            <ul className="list-disc pl-5 space-y-0.5">
              {group.items.map((e) => <li key={e} className="text-sm text-muted-foreground">{e}</li>)}
            </ul>
          </div>
        ))}
        <h3 className="text-sm font-medium text-foreground pt-3">{CODE_OF_CONDUCT.codeTitle}</h3>
        {CODE_OF_CONDUCT.code.map((p) => <p key={p} className="text-sm text-muted-foreground">{p}</p>)}
        <div className="divide-y divide-border">
          {DECLARATION_ITEMS.filter((i) => i.section === 'code').map((i) => (
            <Tick key={i.key} id={`tick-${i.key}`} checked={!!ticked[i.key]} onChange={tick(i.key)}>{i.text}</Tick>
          ))}
        </div>
      </Section>

      <Section title={CODE_OF_CONDUCT.disclaimersTitle}>
        <div className="divide-y divide-border">
          {DECLARATION_ITEMS.filter((i) => i.section === 'disclaimers').map((i) => (
            <Tick key={i.key} id={`tick-${i.key}`} checked={!!ticked[i.key]} onChange={tick(i.key)}>
              <strong>{'label' in i ? i.label : ''}:</strong> {i.text}
            </Tick>
          ))}
        </div>
      </Section>

      {view.underEighteen && (
        <Section title="Parent or Guardian's Consent">
          <p className="text-xs text-muted-foreground">
            {view.playerName} is under 18, so a parent or guardian completes this part.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Given name(s)" id="guardian-given" required>
              <Input value={guardian.givenNames} onChange={(e) => setGuardian({ ...guardian, givenNames: e.target.value })} />
            </Field>
            <Field label="Surname" id="guardian-surname" required>
              <Input value={guardian.surname} onChange={(e) => setGuardian({ ...guardian, surname: e.target.value })} />
            </Field>
            <Field label="Mobile" id="guardian-mobile" required>
              <Input inputMode="tel" value={guardian.mobileNo} onChange={(e) => setGuardian({ ...guardian, mobileNo: e.target.value })} />
            </Field>
            <Field label="Email" id="guardian-email" required>
              <Input type="email" value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} />
            </Field>
          </div>
          <div className="space-y-1 pt-1">
            {guardianConsent(guardianName).map((p) => (
              <p key={p} className={`text-sm text-muted-foreground ${/^[a-d]\. /.test(p) ? 'pl-4' : ''}`}>{p}</p>
            ))}
          </div>
          <Tick id={`tick-${GUARDIAN_CONFIRM.key}`} checked={!!ticked[GUARDIAN_CONFIRM.key]} onChange={tick(GUARDIAN_CONFIRM.key)}>{GUARDIAN_CONFIRM.text}</Tick>
          <p className="text-xs text-muted-foreground">Parent or guardian's signature</p>
          <div id="guardian-signature" tabIndex={-1} className="focus:outline-none">
            <SignaturePad onChange={setSignature} />
          </div>
        </Section>
      )}

      {leave.prompt}
      {(gaps.summary || submit.error) && (
        <p role="alert" className="text-xs font-medium text-danger-soft-foreground">
          {gaps.summary || errorMessage(submit.error, 'submit')}
        </p>
      )}
      <ActionButton fullWidth loading={submit.isPending} onClick={() => gaps.check() && submit.mutate()}>
        Agree and submit
      </ActionButton>
    </>
  );
}

/** This season's waivers & declarations (Supabase backend). Opened from My Tasks. */
export default function Waivers() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: view, isLoading, error, refetch } = useQuery({ queryKey: ['declarations'], queryFn: getMyDeclarations });

  const done = () => {
    toast.success("This season's waivers are signed");
    void queryClient.invalidateQueries({ queryKey: ['declarations'] });
    void queryClient.invalidateQueries({ queryKey: ['myTasks'] });
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Waivers & declarations" />
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error || !view ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">
              {error instanceof ApiError && error.status < 500 ? error.message : 'Could not load the waivers.'}
            </p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">Try again</button>
          </div>
        ) : view.signedThisSeasonAt ? (
          <Section title={`Waivers & Declarations ${view.season.replace('-', '–')}`}>
            <p className="text-sm text-foreground">You signed this season's waivers on {safeFormat(view.signedThisSeasonAt, LONG_DATE)}.</p>
          </Section>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Season {view.season.replace('-', '–')}. Please read and tick each box to agree.</p>
            <Form view={view} onDone={done} />
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
