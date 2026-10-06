import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { User } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import SignaturePad from '@/components/SignaturePad';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { differs } from '@/lib/drafts';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { safeFormat } from '@/lib/dateUtils';
import { getMyDeclarations, submitDeclarations } from '@/api/declarations';
import {
  CODE_OF_CONDUCT,
  DECLARATION_ITEMS,
  GUARDIAN_CONFIRM,
  guardianConsent,
  type DeclarationsView,
} from '@shared/declarations';

const input =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';

function Tick({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex gap-3 items-start py-2 cursor-pointer">
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
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

  const allTicked = DECLARATION_ITEMS.every((i) => ticked[i.key]);
  const guardianDone =
    !view.underEighteen ||
    (!!guardian.surname.trim() && !!guardian.givenNames.trim() && !!guardian.mobileNo.trim() && /^\S+@\S+\.\S+$/.test(guardian.email.trim()) &&
      !!ticked[GUARDIAN_CONFIRM.key] && !!signature);
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
            <Tick key={i.key} checked={!!ticked[i.key]} onChange={tick(i.key)}>{i.text}</Tick>
          ))}
        </div>
      </Section>

      <Section title={CODE_OF_CONDUCT.disclaimersTitle}>
        <div className="divide-y divide-border">
          {DECLARATION_ITEMS.filter((i) => i.section === 'disclaimers').map((i) => (
            <Tick key={i.key} checked={!!ticked[i.key]} onChange={tick(i.key)}>
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
            <label className="text-xs text-muted-foreground">Given name(s)
              <input className={input} value={guardian.givenNames} onChange={(e) => setGuardian({ ...guardian, givenNames: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">Surname
              <input className={input} value={guardian.surname} onChange={(e) => setGuardian({ ...guardian, surname: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">Mobile
              <input className={input} inputMode="tel" value={guardian.mobileNo} onChange={(e) => setGuardian({ ...guardian, mobileNo: e.target.value })} />
            </label>
            <label className="text-xs text-muted-foreground">Email
              <input className={input} type="email" value={guardian.email} onChange={(e) => setGuardian({ ...guardian, email: e.target.value })} />
            </label>
          </div>
          <div className="space-y-1 pt-1">
            {guardianConsent(guardianName).map((p) => (
              <p key={p} className={`text-sm text-muted-foreground ${/^[a-d]\. /.test(p) ? 'pl-4' : ''}`}>{p}</p>
            ))}
          </div>
          <Tick checked={!!ticked[GUARDIAN_CONFIRM.key]} onChange={tick(GUARDIAN_CONFIRM.key)}>{GUARDIAN_CONFIRM.text}</Tick>
          <p className="text-xs text-muted-foreground">Parent or guardian's signature</p>
          <SignaturePad onChange={setSignature} />
        </Section>
      )}

      {leave.prompt}
      {submit.error && (
        <p role="alert" className="text-xs text-destructive">
          {submit.error instanceof ApiError ? submit.error.message : 'Not submitted: the connection or the server failed. Please try again.'}
        </p>
      )}
      <button
        className="w-full h-10 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50"
        disabled={!allTicked || !guardianDone || submit.isPending}
        onClick={() => submit.mutate()}
      >
        {submit.isPending ? 'Submitting…' : 'Agree and submit'}
      </button>
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
      <AppHeader subtitle="Waivers & Declarations">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>
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
            <p className="text-sm text-foreground">You signed this season's waivers on {safeFormat(view.signedThisSeasonAt, 'd MMM yyyy')}.</p>
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
