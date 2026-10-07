import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { AlertTriangle, Check, ChevronDown, Copy, Download, FileText, Search } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import ConfirmDialog from '@/components/ConfirmDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { inputClass, primaryButton, secondaryButton } from '@/components/kit/kitUi';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { useMyProfile } from '@/lib/queries';
import { downloadRegistration, getRegistrationBoard, markRegistered, saveRegistrationDetails, unmarkRegistered } from '@/api/registration';
import { hkDateKey } from '@shared/hkDateKey';
import { REASON_LABEL, isVisiting, missingDetails, suggestRegisteredName, tidyRegisteredName, type RegistrationPlayer } from '@shared/registration';
import { errorMessage } from '@/lib/errorMessages';

type View = 'todo' | 'all' | 'missing';
const VIEWS: { key: View; label: string }[] = [
  { key: 'todo', label: 'To register' },
  { key: 'all', label: 'All players' },
  { key: 'missing', label: 'Missing details' },
];
const NO_TEAM = 'No registered team';
const selectClass = inputClass.replace('w-full', 'w-auto');

const chip = 'inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full';
const failed = (err: unknown) => toast.error(errorMessage(err, 'save'));

async function copy(label: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Couldn't copy. Try again.");
  }
}

/** One detail, with a copy button for pasting into HockeyHK's forms. */
function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 text-sm text-foreground">
        {value ? (
          <>
            <span className="truncate select-all">{value}</span>
            <button className="shrink-0 p-1 text-muted-foreground hover:text-primary" onClick={() => copy(label, value)} aria-label={`Copy ${label}`} title="Copy">
              <Copy className="h-3 w-3" />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">–</span>
        )}
      </dd>
    </div>
  );
}

/**
 * The Registered Name, editable: match cards link to the player by it. The
 * suggestion (SURNAME Given Names) only fills the box; nothing saves until
 * the Convenor taps Save.
 */
function RegisteredName({ p, busy, onSave }: { p: RegistrationPlayer; busy: boolean; onSave: (name: string | null) => void }) {
  const [draft, setDraft] = useState(p.registeredName ?? '');
  const suggestion = suggestRegisteredName(p.surname, p.givenNames);
  const value = tidyRegisteredName(draft) || null;
  return (
    <div className="space-y-1">
      <label htmlFor={`rn-${p.id}`} className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Registered name
      </label>
      <div className="flex items-center gap-2">
        <input id={`rn-${p.id}`} className={inputClass} value={draft} placeholder={suggestion ?? ''} maxLength={80} onChange={(e) => setDraft(e.target.value)} />
        {p.registeredName && (
          <button className="shrink-0 p-1 text-muted-foreground hover:text-primary" onClick={() => copy('Registered name', p.registeredName!)} aria-label="Copy Registered name" title="Copy">
            <Copy className="h-3 w-3" />
          </button>
        )}
        <button className={`${secondaryButton} shrink-0`} disabled={busy || value === (p.registeredName ?? null)} onClick={() => onSave(value)}>
          Save
        </button>
      </div>
      {!draft && suggestion && (
        <button className="text-xs text-primary" onClick={() => setDraft(suggestion)}>
          Use {suggestion}
        </button>
      )}
    </div>
  );
}

function PlayerItem({
  p,
  today,
  open,
  busy,
  onToggle,
  onRegistered,
  onUndo,
  onSaveName,
  onVisiting,
}: {
  p: RegistrationPlayer;
  today: string;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRegistered: () => void;
  onUndo: () => void;
  onSaveName: (name: string | null) => void;
  onVisiting: (on: boolean) => void;
}) {
  const missing = missingDetails(p, today);
  const docs = [
    ['Photo', p.files.photo],
    ['HKID', p.files.hkid],
    ['Passport', p.files.passport],
    ['U18 registration form', p.files.u18Form],
  ].filter((d): d is [string, string] => !!d[1]);
  return (
    <li>
      <button className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-muted/50" onClick={onToggle} aria-expanded={open}>
        <span className="w-9 shrink-0 text-right font-mono text-sm font-semibold text-foreground">{p.shirtNo ?? '–'}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm text-foreground">
            {p.name} <span className="text-xs text-muted-foreground">{p.registeredName ?? ''}</span>
          </span>
          <span className="flex flex-wrap gap-1 mt-0.5">
            {p.reason ? (
              <span className={`${chip} bg-amber-500/15 text-amber-700`} title={p.reasonDetail ?? undefined}>
                {REASON_LABEL[p.reason]}
                {p.reasonDetail ? ` · ${p.reasonDetail}` : ''}
              </span>
            ) : (
              <span className={`${chip} bg-emerald-500/15 text-emerald-700`}>
                <Check className="h-3 w-3" /> Registered {safeFormat(p.registeredAt, 'd MMM')}
              </span>
            )}
            {missing.length > 0 && (
              <span className={`${chip} bg-destructive/10 text-destructive`}>
                <AlertTriangle className="h-3 w-3" /> Missing: {missing.join(', ')}
              </span>
            )}
            {p.visiting ? (
              <span className={`${chip} bg-primary-tint/10 text-primary`}>Visiting player</span>
            ) : (
              isVisiting(p) && <span className={`${chip} bg-amber-500/15 text-amber-700`}>No HKID: visiting?</span>
            )}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 mt-1 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 sm:pl-14 space-y-3">
          <div className="flex gap-3">
            {p.files.photo && (
              <a href={p.files.photo} target="_blank" rel="noopener noreferrer" className="shrink-0">
                <img src={p.files.photo} alt={`${p.name}'s photo`} className="h-24 w-20 rounded-md object-cover border border-border" />
              </a>
            )}
            <dl className="flex-1 min-w-0 grid grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-2">
              <Field label="Surname" value={p.surname} />
              <Field label="Given names" value={p.givenNames} />
              <Field label="Chinese name" value={p.chineseName} />
              <Field label="Date of birth" value={p.dateOfBirth} />
              <Field label="Nationality" value={p.nationality} />
              <Field label="HKID No." value={p.hkidNo} />
              <Field label="Passport no." value={p.passportNo} />
              <Field label="Shirt no." value={p.shirtNo?.toString() ?? null} />
              <Field label="Mobile" value={p.mobileNo} />
              <Field label="Email" value={p.email} />
              <Field label="Previous EOS" value={p.previousEos} />
            </dl>
          </div>
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="flex-1 min-w-[16rem]">
              <RegisteredName key={p.registeredName ?? ''} p={p} busy={busy} onSave={onSaveName} />
            </div>
            <label className="flex h-9 items-center gap-2 text-sm text-foreground">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={!!p.visiting} disabled={busy} onChange={(e) => onVisiting(e.target.checked)} />
              Visiting player
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {docs.length > 0 ? (
              docs.map(([label, url]) => (
                <a key={label} href={url} target="_blank" rel="noopener noreferrer" className={`${secondaryButton} h-8 text-xs`}>
                  <FileText className="h-3.5 w-3.5" /> {label}
                </a>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No documents held.</span>
            )}
            <span className="flex-1" />
            {p.reason ? (
              <button className={`${primaryButton} h-8 text-xs`} disabled={busy || !p.team} onClick={onRegistered}>
                <Check className="h-3.5 w-3.5" /> Registered with HockeyHK
              </button>
            ) : (
              <button className="text-xs text-muted-foreground underline" disabled={busy} onClick={onUndo}>
                Not registered after all
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * HKHA registration (the Hockey Convenor only): every Active player's
 * registration details by registered team, who still needs registering
 * with HockeyHK this season and why, what's missing before they can be,
 * and a CSV for HockeyHK's spreadsheet.
 */
export default function Registration() {
  const queryClient = useQueryClient();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('registration') ?? false;
  const [params, setParams] = useSearchParams();
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const view: View = VIEWS.find((v) => v.key === params.get('view'))?.key ?? 'todo';
  const team = params.get('team') ?? '';
  const q = (params.get('q') ?? '').trim().toLowerCase();
  const today = hkDateKey(new Date().toISOString());

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['registrationBoard'],
    queryFn: getRegistrationBoard,
    enabled: allowed,
    staleTime: 60_000,
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmTeam, setConfirmTeam] = useState<{ team: string; ids: string[] } | null>(null);
  const [exporting, setExporting] = useState(false);

  const changed = () => void queryClient.invalidateQueries({ queryKey: ['registrationBoard'] });
  const register = useMutation({
    mutationFn: (ids: string[]) => markRegistered(ids),
    onSuccess: (r, ids) => {
      toast.success(ids.length === 1 ? 'Marked as registered' : `${r.count} marked as registered`);
      changed();
    },
    onError: failed,
  });
  const undo = useMutation({
    mutationFn: (id: string) => unmarkRegistered(id),
    onSuccess: () => {
      toast.success('Back on the Needs registering list');
      changed();
    },
    onError: failed,
  });

  const details = useMutation({
    mutationFn: ({ id, change }: { id: string; change: { registeredName?: string | null; visiting?: boolean } }) => saveRegistrationDetails(id, change),
    onSuccess: (r) => {
      toast.success(r.linked > 0 ? `Saved · ${r.linked} match card${r.linked === 1 ? '' : 's'} linked` : 'Saved');
      changed();
    },
    onError: failed,
  });

  const players = data?.players ?? [];
  const inView = (p: RegistrationPlayer, v: View) => (v === 'todo' ? !!p.reason : v === 'missing' ? missingDetails(p, today).length > 0 : true);
  const counts = Object.fromEntries(VIEWS.map((v) => [v.key, players.filter((p) => inView(p, v.key)).length])) as Record<View, number>;
  // A couple of hundred players at most: filtering on each render is cheap.
  const teams = [...new Set(players.map((p) => p.team ?? NO_TEAM))];
  const shown = players.filter(
    (p) =>
      inView(p, view) &&
      (!team || (p.team ?? NO_TEAM) === team) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        (p.registeredName ?? '').toLowerCase().includes(q) ||
        String(p.shirtNo ?? '') === q ||
        (p.hkidNo ?? '').toLowerCase().includes(q) ||
        (p.passportNo ?? '').toLowerCase().includes(q)),
  );
  const byTeam = new Map<string, RegistrationPlayer[]>();
  for (const p of shown) byTeam.set(p.team ?? NO_TEAM, [...(byTeam.get(p.team ?? NO_TEAM) ?? []), p]);
  const groups = [...byTeam.entries()];

  const exportCsv = async () => {
    setExporting(true);
    try {
      const n = await downloadRegistration({ todo: view === 'todo', team: team && team !== NO_TEAM ? team : null });
      toast.success(`${n} player${n === 1 ? '' : 's'} in the file`);
    } catch (err) {
      failed(err);
    } finally {
      setExporting(false);
    }
  };

  const body = () => {
    if (profileLoading || (allowed && isLoading)) return <Skeleton className="h-96 w-full" />;
    if (!allowed) return <p className="text-center py-12 text-muted-foreground">This screen is for the Hockey Convenor.</p>;
    if (error || !data) {
      return (
        <div className="text-center py-12 border border-dashed border-border rounded-xl">
          <p className="text-muted-foreground mb-2">{error instanceof ApiError && error.status < 500 ? error.message : 'Could not load the players.'}</p>
          <button onClick={() => refetch()} className="text-sm text-primary underline">
            Try again
          </button>
        </div>
      );
    }
    return (
      <>
        <p className="text-sm text-muted-foreground">
          Season {data.season} · {players.length} Active players · {counts.todo} to register
        </p>
        <div className="flex border-b border-border overflow-x-auto [scrollbar-width:none]">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              onClick={() => setParam('view', v.key === 'todo' ? null : v.key)}
              className={`px-2 sm:px-3 py-2 text-sm whitespace-nowrap -mb-px border-b-2 ${view === v.key ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}
            >
              {v.label} ({counts[v.key]})
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[12rem]">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <input className={`${inputClass} pl-8`} value={params.get('q') ?? ''} onChange={(e) => setParam('q', e.target.value || null)} placeholder="Name, shirt or ID number" aria-label="Search" />
          </div>
          <select className={selectClass} value={team} onChange={(e) => setParam('team', e.target.value || null)} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {view !== 'missing' && (
            <button className={secondaryButton} disabled={exporting || shown.length === 0} onClick={exportCsv} title="The file has ID numbers in it. Each download is logged.">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
          )}
        </div>
        {view === 'todo' && (
          <p className="text-xs text-muted-foreground">
            New players, moves up after play-ups and team changes come back here until they're ticked off. Open a player to copy their details.
          </p>
        )}
        {groups.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">
            {view === 'todo' && !q && !team ? 'Everyone is registered for this season.' : 'Nobody matches.'}
          </p>
        ) : (
          groups.map(([t, list]) => (
            <section key={t}>
              <div className="flex items-center gap-2 mb-1.5">
                <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t} ({list.length})
                </h2>
                {view === 'todo' && t !== NO_TEAM && list.length > 1 && (
                  <button className="text-xs text-primary" disabled={register.isPending} onClick={() => setConfirmTeam({ team: t, ids: list.map((p) => p.id) })}>
                    Mark all {list.length} registered
                  </button>
                )}
              </div>
              <ul className="rounded-xl border border-border bg-card divide-y divide-border">
                {list.map((p) => (
                  <PlayerItem
                    key={p.id}
                    p={p}
                    today={today}
                    open={openId === p.id}
                    busy={register.isPending || undo.isPending || details.isPending}
                    onToggle={() => setOpenId(openId === p.id ? null : p.id)}
                    onRegistered={() => register.mutate([p.id])}
                    onUndo={() => undo.mutate(p.id)}
                    onSaveName={(registeredName) => details.mutate({ id: p.id, change: { registeredName } })}
                    onVisiting={(visiting) => details.mutate({ id: p.id, change: { visiting } })}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
        {confirmTeam && (
          <ConfirmDialog
            title={`Mark ${confirmTeam.team} as registered?`}
            message={`All ${confirmTeam.ids.length} players listed for ${confirmTeam.team}${q ? ' (matching your search)' : ''} come off the list as registered with HockeyHK for ${data.season}.`}
            confirmLabel="Mark them registered"
            onCancel={() => setConfirmTeam(null)}
            onConfirm={() => {
              register.mutate(confirmTeam.ids);
              setConfirmTeam(null);
            }}
          />
        )}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="HKHA registration" />
      <main className="flex-1 container mx-auto max-w-4xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
