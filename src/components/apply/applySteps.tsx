import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import FileUpload from '@/components/profile/FileUpload';
import PhoneInput from '@/components/profile/PhoneInput';
import SignaturePad from '@/components/SignaturePad';
import { ChoiceOrOther, fieldInput, HkidInput } from '@/components/profile/ProfileFields';
import { StepShell, errorText, type StepProps } from '@/components/profile/steps';
import { differs } from '@/lib/drafts';
import { saveClubs, saveFamily, saveTrials, submitApplication, uploadApplicantFile } from '@/api/apply';
import { hkDateKey } from '@shared/hkDateKey';
import { NATIONALITIES } from '@shared/profile';
import { guardianConsent } from '@shared/declarations';
import {
  AGREEMENTS,
  AGREEMENT_PDFS,
  APPLICATION_VERSION,
  GUARDIAN_CONSENT_KEY,
  MAX_CHILDREN,
  MAX_CLUBS,
  MAX_RELATIVES,
  MAX_TRIALS,
  PRIVATE_CLUBS,
  RELATIONSHIPS,
  TRIAL_DIVISIONS,
  TRIAL_TYPES,
  childNeedsHkid,
  childProblem,
  childSigns,
  relativeProblem,
  requiredTicks,
  spouseProblem,
  trialProblem,
  type ApplyView,
  type FamilyMemberDetails,
  type PrivateClub,
  type Relative,
  type TrialAttended,
} from '@shared/application';

export interface ApplyStepProps extends StepProps {
  view: ApplyView;
}

const today = () => hkDateKey(new Date().toISOString());

function Text({ label, value, onChange, type = 'text', required, list }: { label: string; value: string | null | undefined; onChange: (v: string) => void; type?: string; required?: boolean; list?: string }) {
  return (
    <label className="space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <input className={fieldInput} type={type} list={list} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Phone({ label, value, onChange, required }: { label: string; value: string | null | undefined; onChange: (v: string) => void; required?: boolean }) {
  return (
    <div className="space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <PhoneInput value={value ?? null} onChange={onChange} />
    </div>
  );
}

function Choose({ label, value, options, onChange, required }: { label: string; value: string | null | undefined; options: readonly string[]; onChange: (v: string) => void; required?: boolean }) {
  return (
    <label className="space-y-1 text-xs font-medium text-foreground">
      <span>
        {label}
        {required && <span className="text-destructive"> *</span>}
      </span>
      <select className={fieldInput} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function Count({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <Choose label={label} value={value === 0 ? 'None' : String(value)} options={['None', ...Array.from({ length: max }, (_, i) => String(i + 1))]} onChange={(v) => onChange(v === 'None' || !v ? 0 : Number(v))} required />
  );
}

/** Resizes a list to n entries, keeping what's there. */
function resize<T>(list: T[], n: number, make: () => T): T[] {
  return list.length >= n ? list.slice(0, n) : [...list, ...Array.from({ length: n - list.length }, make)];
}

export function ClubsStep({ view, ...nav }: ApplyStepProps) {
  const queryClient = useQueryClient();
  const [clubs, setClubs] = useState<PrivateClub[]>(view.clubs);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveClubs(clubs),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['apply'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const thisYear = new Date().getFullYear();
  const next = () => {
    const bad = clubs.some((c) => !c.club.trim())
      ? 'Give each club, or choose fewer clubs.'
      : clubs.some((c) => c.sinceYear !== null && (c.sinceYear < 1900 || c.sinceYear > thisYear))
        ? `Give each year as four digits, ${thisYear} or earlier.`
        : null;
    setProblem(bad);
    if (!bad) save.mutate();
  };
  const set = (i: number, patch: Partial<PrivateClub>) => setClubs(clubs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <StepShell title="Private clubs" {...nav} onNext={next} busy={save.isPending} problem={problem} dirty={!save.isSuccess && differs({ clubs }, { clubs: view.clubs })}>
      <Count label="Are you a member of a private club?" value={clubs.length} max={MAX_CLUBS} onChange={(n) => setClubs(resize(clubs, n, () => ({ club: '', sinceYear: thisYear })))} />
      {clubs.map((c, i) => (
        <div key={i} className="grid grid-cols-3 gap-3 items-end">
          <div className="col-span-2">
            <ClubChoice label={`Club ${i + 1}`} value={c.club} onChange={(v) => set(i, { club: v })} />
          </div>
          <Text label="Member since" type="number" value={c.sinceYear ? String(c.sinceYear) : ''} onChange={(v) => set(i, { sinceYear: v ? Number(v) : null })} />
        </div>
      ))}
    </StepShell>
  );
}

/** A private club from the list, or any other typed in. */
function ClubChoice({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const listed = !value || (PRIVATE_CLUBS as readonly string[]).includes(value);
  const [typing, setTyping] = useState(!listed);
  return (
    <div className="space-y-1.5">
      <label className="space-y-1 text-xs font-medium text-foreground block">
        <span>
          {label}
          <span className="text-destructive"> *</span>
        </span>
        <select
          className={fieldInput}
          value={typing ? '__other__' : value}
          onChange={(e) => {
            if (e.target.value === '__other__') {
              setTyping(true);
              onChange(listed ? '' : value);
            } else {
              setTyping(false);
              onChange(e.target.value);
            }
          }}
        >
          <option value="">Choose…</option>
          {PRIVATE_CLUBS.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__other__">Another club (type it)</option>
        </select>
      </label>
      {typing && <input className={fieldInput} aria-label={`${label} name`} placeholder="The club's name" value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

export function TrialsStep({ view, ...nav }: ApplyStepProps) {
  const queryClient = useQueryClient();
  const [trials, setTrials] = useState<TrialAttended[]>(view.trials);
  const [details, setDetails] = useState(view.participationDetails ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => saveTrials(trials, details),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['apply'] });
      nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad = trials.map((t, i) => trialProblem(t, i + 1)).find(Boolean) ?? (trials.length && !details.trim() ? 'Tell us how the trials went.' : null);
    setProblem(bad ?? null);
    if (!bad) save.mutate();
  };
  const set = (i: number, patch: Partial<TrialAttended>) => setTrials(trials.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <StepShell
      title="Trials with HKFC"
      {...nav}
      onNext={next}
      busy={save.isPending}
      problem={problem}
      dirty={!save.isSuccess && differs({ trials, details }, { trials: view.trials, details: view.participationDetails ?? '' })}
    >
      <Count label="Have you taken part in any trials?" value={trials.length} max={MAX_TRIALS} onChange={(n) => setTrials(resize(trials, n, () => ({ date: '', types: [], division: '' })))} />
      {trials.map((t, i) => (
        <fieldset key={i} className="rounded-md border border-border p-3 space-y-2">
          <legend className="text-xs font-semibold text-foreground px-1">Trial {i + 1}</legend>
          <div className="grid grid-cols-2 gap-3">
            <Text label="Date" type="date" value={t.date} onChange={(v) => set(i, { date: v })} required />
            <Choose label="Highest division" value={t.division} options={TRIAL_DIVISIONS} onChange={(v) => set(i, { division: v })} required />
          </div>
          <div className="flex flex-wrap gap-4">
            {TRIAL_TYPES.map((type) => (
              <label key={type} className="flex gap-2 items-center text-sm text-foreground">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                  checked={t.types.includes(type)}
                  onChange={(e) => set(i, { types: e.target.checked ? [...t.types, type] : t.types.filter((x) => x !== type) })}
                />
                {type}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {trials.length > 0 && (
        <label className="space-y-1 text-xs font-medium text-foreground block">
          <span>
            Participation details<span className="text-destructive"> *</span>
          </span>
          <textarea rows={3} className={`${fieldInput} h-auto py-1.5`} value={details} onChange={(e) => setDetails(e.target.value)} />
        </label>
      )}
    </StepShell>
  );
}

const EMPTY_MEMBER: FamilyMemberDetails = { surname: '', givenNames: '', dateOfBirth: '', gender: '' };

function MemberFields({ m, onChange, spouse }: { m: FamilyMemberDetails; onChange: (next: FamilyMemberDetails) => void; spouse: boolean }) {
  const set = (k: keyof FamilyMemberDetails) => (v: string) => onChange({ ...m, [k]: v });
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {spouse && <Choose label="Title" value={m.salutation} options={['Mrs', 'Mr', 'Ms', 'Miss', 'Dr', 'Professor']} onChange={set('salutation')} required />}
      <Text label="Surname" value={m.surname} onChange={set('surname')} required />
      <Text label="Given name(s)" value={m.givenNames} onChange={set('givenNames')} required />
      {spouse && <Text label="Chinese name" value={m.chineseName} onChange={set('chineseName')} />}
      <Text label="Date of birth" type="date" value={m.dateOfBirth} onChange={set('dateOfBirth')} required />
      <Choose label="Gender" value={m.gender} options={spouse ? ['Female', 'Male'] : ['M', 'F']} onChange={set('gender')} required />
      {spouse ? (
        <>
          <Text label="Wedding anniversary" type="date" value={m.weddingAnniversary} onChange={set('weddingAnniversary')} />
          <div className="space-y-1 text-xs font-medium text-foreground">
            <span>
              HKID no.<span className="text-destructive"> *</span>
            </span>
            <HkidInput id="spouse-hkid" value={m.hkidNo ?? ''} onChange={set('hkidNo')} />
          </div>
          <Text label="Passport no." value={m.passportNo} onChange={set('passportNo')} />
          <div className="space-y-1 text-xs font-medium text-foreground">
            <span>
              Nationality<span className="text-destructive"> *</span>
            </span>
            <ChoiceOrOther
              f={{ key: 'spouseNationality', column: 'nationality', label: 'Nationality', type: 'suggest', options: NATIONALITIES }}
              id="spouse-nationality"
              value={m.nationality ?? ''}
              required
              onChange={(v) => set('nationality')(v ?? '')}
            />
          </div>
          <Text label="Email" type="email" value={m.email} onChange={set('email')} required />
          <Phone label="Mobile no." value={m.mobileNo} onChange={set('mobileNo')} required />
          <Text label="Company" value={m.companyName} onChange={set('companyName')} />
          <Text label="Position" value={m.workPosition} onChange={set('workPosition')} />
          <Text label="Nature of business" value={m.natureOfBusiness} onChange={set('natureOfBusiness')} />
          <Text label="Office email" type="email" value={m.officeEmail} onChange={set('officeEmail')} />
          <Phone label="Office telephone no." value={m.officeTelephoneNo} onChange={set('officeTelephoneNo')} />
        </>
      ) : (
        <Text label="HKID or passport no." value={m.hkidNo} onChange={set('hkidNo')} />
      )}
    </div>
  );
}

/**
 * Spouse or partner, children under 26 and close relatives in the club (the
 * Fillout form's Family page, asked of every applicant), then their
 * documents once saved.
 */
export function FamilyStep({ view, details, ...nav }: ApplyStepProps) {
  const queryClient = useQueryClient();
  const [hasSpouse, setHasSpouse] = useState(!!view.spouse);
  const [spouse, setSpouse] = useState<FamilyMemberDetails>(view.spouse ?? EMPTY_MEMBER);
  const [children, setChildren] = useState<FamilyMemberDetails[]>(view.children);
  const [relatives, setRelatives] = useState<Relative[]>(view.relatives);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const married = details.values.maritalStatus === 'Married';

  const save = useMutation({
    mutationFn: () => saveFamily({ spouse: hasSpouse ? spouse : null, children, relatives }),
    onSuccess: async (ids) => {
      setSpouse((s) => ({ ...s, id: ids.spouseId ?? undefined }));
      setChildren((list) => list.map((c, i) => ({ ...c, id: ids.childIds[i] })));
      await queryClient.invalidateQueries({ queryKey: ['apply'] });
      setSaved(true);
      setProblem(null);
      if (!hasSpouse && children.length === 0 && !(married && !view.hasMarriageCertificate)) nav.onDone();
    },
    onError: (err) => setProblem(errorText(err)),
  });
  const check = () =>
    (hasSpouse && spouseProblem(spouse)) ||
    children.map((c, i) => childProblem(c, i + 1)).find(Boolean) ||
    relatives.map((r, i) => relativeProblem(r, i + 1)).find(Boolean) ||
    null;
  const filesFor = (id?: string) => (id ? (view.spouse?.id === id ? view.spouse.files : view.children.find((c) => c.id === id)?.files) : undefined);
  /** The documents still to upload, once the family is saved. */
  const missingDocs = () => {
    const missing: string[] = [];
    if (married && !view.hasMarriageCertificate) missing.push('your marriage certificate');
    if (hasSpouse) {
      const f = filesFor(spouse.id);
      if (!f?.photo) missing.push("your spouse or partner's photo");
      if (!f?.hkid) missing.push("your spouse or partner's HKID");
    }
    children.forEach((c, i) => {
      const f = filesFor(c.id);
      if (!f?.photo) missing.push(`child ${i + 1}'s photo`);
      if (!f?.birthCertificate) missing.push(`child ${i + 1}'s birth certificate`);
      if (c.dateOfBirth && childNeedsHkid(c.dateOfBirth, today()) && !f?.hkid) missing.push(`child ${i + 1}'s HKID`);
    });
    return missing;
  };
  const next = () => {
    const bad = check();
    setProblem(bad);
    if (bad) return;
    if (!saved) return save.mutate();
    const missing = missingDocs();
    if (missing.length) setProblem(`Upload ${missing.join(', ')}.`);
    else nav.onDone();
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['apply'] });
  const dirty = () => setSaved(false);

  return (
    <StepShell
      title="Family"
      {...nav}
      onNext={next}
      nextLabel={saved ? 'Next' : 'Save and next'}
      busy={save.isPending}
      problem={problem}
      dirty={!saved && differs({ hasSpouse, spouse, children, relatives }, { hasSpouse: !!view.spouse, spouse: view.spouse ?? EMPTY_MEMBER, children: view.children, relatives: view.relatives })}
    >
      {married && (
        <FileUpload
          kind="document"
          label="Marriage certificate"
          hasFile={view.hasMarriageCertificate}
          upload={(dataUrl) => uploadApplicantFile('marriage_certificate', dataUrl)}
          onUploaded={refresh}
        />
      )}
      <label className="flex gap-2 items-center text-sm font-medium text-foreground">
        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={hasSpouse} onChange={(e) => { setHasSpouse(e.target.checked); dirty(); }} />
        I have a spouse or partner
      </label>
      {hasSpouse && (
        <fieldset className="rounded-md border border-border p-3 space-y-3">
          <legend className="text-xs font-semibold text-foreground px-1">Spouse or partner</legend>
          <MemberFields m={spouse} spouse onChange={(m) => { setSpouse(m); dirty(); }} />
          {saved && spouse.id && (
            <div className="grid gap-3">
              <FileUpload kind="document" label="Their photo" hasFile={!!filesFor(spouse.id)?.photo} upload={(d) => uploadApplicantFile('photo', d, spouse.id)} onUploaded={refresh} />
              <FileUpload kind="document" label="Their HKID" hasFile={!!filesFor(spouse.id)?.hkid} upload={(d) => uploadApplicantFile('hkid', d, spouse.id)} onUploaded={refresh} />
            </div>
          )}
        </fieldset>
      )}
      <Count label="Children under 26" value={children.length} max={MAX_CHILDREN} onChange={(n) => { setChildren(resize(children, n, () => ({ ...EMPTY_MEMBER }))); dirty(); }} />
      {children.map((c, i) => (
        <fieldset key={i} className="rounded-md border border-border p-3 space-y-3">
          <legend className="text-xs font-semibold text-foreground px-1">Child {i + 1}</legend>
          <MemberFields m={c} spouse={false} onChange={(m) => { setChildren(children.map((x, j) => (j === i ? m : x))); dirty(); }} />
          {saved && c.id && (
            <div className="grid gap-3">
              <FileUpload kind="document" label="Their photo" hasFile={!!filesFor(c.id)?.photo} upload={(d) => uploadApplicantFile('photo', d, c.id)} onUploaded={refresh} />
              <FileUpload kind="document" label="Birth certificate" hasFile={!!filesFor(c.id)?.birthCertificate} upload={(d) => uploadApplicantFile('birth_certificate', d, c.id)} onUploaded={refresh} />
              {c.dateOfBirth && childNeedsHkid(c.dateOfBirth, today()) && (
                <FileUpload kind="document" label="Their HKID" hasFile={!!filesFor(c.id)?.hkid} upload={(d) => uploadApplicantFile('hkid', d, c.id)} onUploaded={refresh} />
              )}
            </div>
          )}
        </fieldset>
      ))}
      <Count label="Close relatives who are HKFC members" value={relatives.length} max={MAX_RELATIVES} onChange={(n) => { setRelatives(resize(relatives, n, () => ({ name: '', membershipNo: '', relationship: '' }))); dirty(); }} />
      {relatives.map((r, i) => (
        <div key={i} className="grid grid-cols-3 gap-3">
          <Text label={`Relative ${i + 1}`} value={r.name} onChange={(v) => { setRelatives(relatives.map((x, j) => (j === i ? { ...x, name: v } : x))); dirty(); }} required />
          <Text label="Membership no." value={r.membershipNo} onChange={(v) => { setRelatives(relatives.map((x, j) => (j === i ? { ...x, membershipNo: v } : x))); dirty(); }} required />
          <Choose label="Relationship" value={r.relationship} options={RELATIONSHIPS} onChange={(v) => { setRelatives(relatives.map((x, j) => (j === i ? { ...x, relationship: v } : x))); dirty(); }} required />
        </div>
      ))}
      {saved && (hasSpouse || children.length > 0) && <p className="text-xs text-muted-foreground">Saved. Add their documents above, then go on.</p>}
    </StepShell>
  );
}

function Tick({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <label className="flex gap-2 items-start text-sm text-foreground py-1">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

/** A labelled signature box. Top level, so redrawing the step doesn't clear it. */
function Sign({ label, onChange }: { label: string; onChange: (png: string | null) => void }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <SignaturePad onChange={onChange} />
    </div>
  );
}

/**
 * The agreements for this applicant (the Fillout form's wording), the
 * under-18's parent or guardian consent, and every signature the form asked
 * for, in one place; then submit.
 */
export function AgreeStep({ view, details, onFinished, ...nav }: ApplyStepProps & { onFinished: () => void }) {
  const who = details.audience;
  const under18 = details.underEighteen;
  const name = [details.values.givenNames, details.values.surname].filter((v) => typeof v === 'string' && v).join(' ');
  const guardianName = [details.values.guardianGivenNames, details.values.guardianSurname].filter((v) => typeof v === 'string' && v).join(' ');
  const items = AGREEMENTS.filter((a) => a.audiences.includes(who));
  const [ticked, setTicked] = useState<string[]>([]);
  const [sigs, setSigs] = useState<{ applicant?: string; spouse?: string; guardian?: string; guardianAccount?: string; children: Record<string, string> }>({ children: {} });
  const [problem, setProblem] = useState<string | null>(null);
  const signingChildren = view.children.filter((c) => c.id && c.dateOfBirth && childSigns(c.dateOfBirth, today()));
  const guardianPays = who === 'new' && details.values.billPayer === 'Guardian / Parent';

  const submit = useMutation({
    mutationFn: () =>
      submitApplication({
        version: APPLICATION_VERSION,
        accepted: ticked,
        signatures: { applicant: sigs.applicant, spouse: sigs.spouse, guardian: sigs.guardian, guardianAccount: sigs.guardianAccount, children: sigs.children },
      }),
    onSuccess: onFinished,
    onError: (err) => setProblem(errorText(err)),
  });
  const next = () => {
    const bad =
      requiredTicks(who, under18).some((k) => !ticked.includes(k))
        ? 'Tick every box to agree.'
        : !sigs.applicant
          ? 'Sign the application.'
          : view.spouse && !sigs.spouse
            ? 'Your spouse or partner needs to sign.'
            : under18 && !sigs.guardian
              ? 'Your parent or guardian needs to sign.'
              : guardianPays && !sigs.guardianAccount
                ? 'The parent or guardian paying needs to sign for the bank account.'
                : signingChildren.some((c) => !sigs.children[c.id!])
                  ? 'Each child over 10 needs to sign.'
                  : null;
    setProblem(bad);
    if (!bad) submit.mutate();
  };
  const tick = (key: string) => (on: boolean) => setTicked((t) => (on ? [...t, key] : t.filter((k) => k !== key)));

  return (
    <StepShell
      title="Agree and sign"
      {...nav}
      onNext={next}
      nextLabel="Submit application"
      busy={submit.isPending}
      problem={problem}
      dirty={!submit.isSuccess && (ticked.length > 0 || Object.keys(sigs).length > 1 || Object.keys(sigs.children).length > 0)}
    >
      {items.map((a) => (
        <section key={a.key} className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">{a.title}</h3>
          {a.text.map((t) => (
            <p key={t.slice(0, 40)} className="text-sm text-muted-foreground">
              {t.replace('{name}', name || '…')}
            </p>
          ))}
          {a.pdf && (
            <a href={AGREEMENT_PDFS[a.pdf]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary underline">
              Read the document <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Tick checked={ticked.includes(a.key)} onChange={tick(a.key)} label={a.tick} />
        </section>
      ))}
      {under18 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Parent or guardian's consent</h3>
          {guardianConsent(guardianName).map((p) => (
            <p key={p.slice(0, 40)} className={`text-sm text-muted-foreground ${/^[a-d]\. /.test(p) ? 'pl-4' : ''}`}>
              {p}
            </p>
          ))}
          <Tick checked={ticked.includes(GUARDIAN_CONSENT_KEY)} onChange={tick(GUARDIAN_CONSENT_KEY)} label="As Guardian/Parent, I confirm that I have read, understood and consent to the above." />
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Signatures</h3>
        <Sign label="Your signature" onChange={(png) => setSigs((s) => ({ ...s, applicant: png ?? undefined }))} />
        {view.spouse && <Sign label="Your spouse or partner's signature" onChange={(png) => setSigs((s) => ({ ...s, spouse: png ?? undefined }))} />}
        {under18 && <Sign label="Your parent or guardian's signature" onChange={(png) => setSigs((s) => ({ ...s, guardian: png ?? undefined }))} />}
        {guardianPays && (
          <Sign label="The parent or guardian's signature for the bank account" onChange={(png) => setSigs((s) => ({ ...s, guardianAccount: png ?? undefined }))} />
        )}
        {signingChildren.map((c) => (
          <Sign
            key={c.id}
            label={`${c.givenNames}'s signature`}
            onChange={(png) => setSigs((s) => ({ ...s, children: { ...s.children, ...(png ? { [c.id!]: png } : {}) } }))}
          />
        ))}
      </section>
    </StepShell>
  );
}
