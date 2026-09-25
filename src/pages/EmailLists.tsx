import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ChevronDown, Copy, Download, Mail, Plus, Search, User, X } from 'lucide-react';
import { toast } from 'sonner';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { useChairmanDirectory, useMyProfile } from '@/lib/queries';
import { logExport, type ExportKind } from '@/api/chairman';
import { toCsv } from '@shared/csv';
import { hkDateKey } from '@shared/hkDateKey';
import {
  ANY,
  GROUPS,
  bccText,
  buildList,
  chunk,
  describeSelection,
  fromParams,
  groupOptions,
  mailtoBcc,
  toParams,
  uniqueAddresses,
  type DirectoryPerson,
  type Selection,
} from '@shared/emailLists';

/** Most providers cap recipients per message; big lists go out in batches. */
const BATCH = 100;


async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers, or a page without clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/**
 * The chairman's email lists (Section Chairs + Section Captains). Pick
 * groups, adjust by hand, then copy the addresses into a Bcc line or
 * download them. The list lives in the page address, so a bookmark is a
 * saved list. Every copy or download is recorded in Membership Events.
 */
export default function EmailLists() {
  const navigate = useNavigate();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('chairman') ?? false;
  const { data, isLoading, isError, refetch } = useChairmanDirectory(allowed);
  const [params, setParams] = useSearchParams();
  const [style, setStyle] = useState<'outlook' | 'gmail'>('outlook');
  const [showFilters, setShowFilters] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [search, setSearch] = useState('');

  const { selection, added, removed } = fromParams(params);
  const update = (next: { selection?: Selection; added?: string[]; removed?: string[] }) =>
    setParams(toParams(next.selection ?? selection, next.added ?? added, next.removed ?? removed), { replace: true });

  const toggle = (key: string, value: string) => {
    const picked = selection[key] ?? [];
    const next = picked.includes(value) ? picked.filter((v) => v !== value) : [...picked, value];
    update({ selection: { ...selection, [key]: next } });
  };

  const people = data?.people ?? [];
  const options = useMemo(() => groupOptions(people), [people]);
  const byId = useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);
  const list = useMemo(() => buildList(people, selection, added, removed), [people, selection, added, removed]);
  const addresses = useMemo(() => uniqueAddresses(list), [list]);
  const noEmail = list.filter((p) => p.emails.length === 0);
  const juniors = list.filter((p) => p.under18);
  // An under-18 whose guardian has no address on file: only the junior hears.
  const juniorsNoGuardian = juniors.filter((p) => p.emailSource === 'own');
  const listIds = new Set(list.map((p) => p.id));
  const description = [
    describeSelection(selection),
    added.length ? `plus ${added.length} added by hand` : '',
    removed.length ? `less ${removed.length} taken off` : '',
  ]
    .filter(Boolean)
    .join('; ');
  const activeGroups = GROUPS.filter((g) => selection[g.key]?.length).length;

  const exported = (kind: ExportKind, count: number) =>
    void logExport({ kind, people: list.length, addresses: count, description });

  const copy = async (batch: string[], label: string) => {
    if (await copyText(bccText(batch, style))) {
      toast.success(`${label} copied. Paste it into Bcc.`);
      exported(style, batch.length);
    } else {
      toast.error('Could not copy. Try the CSV download instead.');
    }
  };

  const downloadCsv = () => {
    const rows = [['Name', 'Email', 'Membership No.', 'Status', 'Team']];
    for (const p of list) {
      for (const e of p.emails) {
        rows.push([p.name, e, p.membershipNo ?? '', p.values.status?.[0] ?? '', p.values.team?.[0] ?? '']);
      }
    }
    const url = URL.createObjectURL(new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `hkfc-hockey-email-list-${hkDateKey(new Date().toISOString())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    exported('csv', addresses.length);
  };

  const mailto = mailtoBcc(addresses);
  const matchesSearch = search.trim()
    ? people
        .filter((p) => !listIds.has(p.id) && p.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  if (profileLoading) return <PageSkeleton />;
  if (!allowed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold text-foreground">Chairman's access required</p>
          <p className="text-sm text-muted-foreground">Email lists are for the Section Chairs and Section Captains.</p>
          <button onClick={() => navigate('/')} className="text-sm text-primary underline">
            Go to Player Dashboard
          </button>
        </div>
      </div>
    );
  }

  const groupBlock = (g: (typeof GROUPS)[number]) => {
    const opts = options[g.key] ?? [];
    if (opts.length === 0) return null;
    const picked = selection[g.key] ?? [];
    const chip = (value: string, label: string) => (
      <button
        key={value}
        onClick={() => toggle(g.key, value)}
        aria-pressed={picked.includes(value)}
        className={`text-xs px-2 py-1 rounded-full border transition-colors ${
          picked.includes(value)
            ? 'bg-primary text-primary-foreground border-primary'
            : 'border-border text-foreground hover:bg-muted'
        }`}
      >
        {label}
      </button>
    );
    return (
      <fieldset key={g.key} className="space-y-1.5">
        <legend className="text-xs font-semibold text-foreground mb-1">{g.label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {g.any && chip(ANY, 'Any')}
          {opts.map((o) => chip(o, o))}
        </div>
      </fieldset>
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader subtitle="Email lists">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>

      <main className="flex-1 container mx-auto px-4 py-4">
        {isLoading ? (
          <PageSkeleton inline />
        ) : isError || !data ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">Could not load the directory.</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[20rem_1fr] items-start">
            {/* ── Groups ── */}
            <aside className="bg-card border border-border rounded-lg p-3 space-y-4 lg:sticky lg:top-4">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="w-full flex items-center justify-between text-sm font-semibold text-foreground lg:cursor-default"
                aria-expanded={showFilters}
              >
                Groups {activeGroups > 0 && <span className="text-xs font-normal text-muted-foreground">({activeGroups} in use)</span>}
                <ChevronDown className={`h-4 w-4 lg:hidden transition-transform ${showFilters ? 'rotate-180' : ''}`} />
              </button>
              <div className={`space-y-4 ${showFilters ? '' : 'hidden'} lg:block`}>
                <p className="text-[11px] text-muted-foreground">
                  Several options in one group: anyone matching any of them. Several groups: people must match every group.
                </p>
                {GROUPS.filter((g) => g.primary).map(groupBlock)}
                <button
                  onClick={() => setShowMore((v) => !v)}
                  className="text-xs text-primary underline"
                  aria-expanded={showMore}
                >
                  {showMore ? 'Fewer groups' : 'Committees, volunteering, tours and more'}
                </button>
                {showMore && GROUPS.filter((g) => !g.primary).map(groupBlock)}
                {(activeGroups > 0 || added.length > 0 || removed.length > 0) && (
                  <button
                    onClick={() => update({ selection: {}, added: [], removed: [] })}
                    className="block text-xs text-muted-foreground underline"
                  >
                    Clear all groups
                  </button>
                )}
              </div>
            </aside>

            {/* ── The list ── */}
            <section className="space-y-3 min-w-0">
              <div className="bg-card border border-border rounded-lg p-3 space-y-3">
                <div>
                  <p className="text-lg font-semibold text-foreground">
                    {list.length} {list.length === 1 ? 'person' : 'people'} · {addresses.length}{' '}
                    {addresses.length === 1 ? 'address' : 'addresses'}
                  </p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Bookmark this page to keep the list. Copies and downloads are recorded in Membership Events.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div role="radiogroup" aria-label="Mail app" className="flex rounded-md border border-border overflow-hidden text-xs">
                    {(['outlook', 'gmail'] as const).map((s) => (
                      <button
                        key={s}
                        role="radio"
                        aria-checked={style === s}
                        onClick={() => setStyle(s)}
                        className={`px-2.5 py-1.5 ${style === s ? 'bg-secondary text-secondary-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                      >
                        {s === 'outlook' ? 'Outlook (;)' : 'Gmail and others (,)'}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => copy(addresses, `${addresses.length} addresses`)}
                    disabled={addresses.length === 0}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy all for Bcc
                  </button>
                  <button
                    onClick={downloadCsv}
                    disabled={addresses.length === 0}
                    className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted text-foreground hover:bg-muted/80 disabled:opacity-50"
                  >
                    <Download className="h-3.5 w-3.5" /> CSV
                  </button>
                  {mailto && (
                    <a
                      href={mailto}
                      onClick={() => exported('mailto', addresses.length)}
                      className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted text-foreground hover:bg-muted/80"
                    >
                      <Mail className="h-3.5 w-3.5" /> Open in mail app
                    </a>
                  )}
                </div>

                {addresses.length > BATCH && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">
                      Most email providers limit how many people one message can go to. Copy in batches of {BATCH} and send
                      one message per batch:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {chunk(addresses, BATCH).map((batch, i) => {
                        const from = i * BATCH + 1;
                        const label = `Batch ${i + 1} (${from}–${from + batch.length - 1})`;
                        return (
                          <button
                            key={i}
                            onClick={() => copy(batch, label)}
                            className="text-xs px-2.5 py-1 rounded-md border border-border text-foreground hover:bg-muted"
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {(noEmail.length > 0 || juniorsNoGuardian.length > 0) && (
                <div className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 space-y-1.5">
                  {noEmail.length > 0 && (
                    <p className="text-sm text-foreground flex items-start gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        {noEmail.length} {noEmail.length === 1 ? 'person has' : 'people have'} no email address and will not
                        get this: {noEmail.map((p) => p.name).join(', ')}
                      </span>
                    </p>
                  )}
                  {juniorsNoGuardian.length > 0 && (
                    <p className="text-sm text-foreground flex items-start gap-1.5">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                      <span>
                        No guardian email on file for {juniorsNoGuardian.length === 1 ? 'this under-18' : 'these under-18s'}, so
                        only they will get it: {juniorsNoGuardian.map((p) => p.name).join(', ')}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {juniors.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Guardians are copied in for the {juniors.length} under-18{juniors.length === 1 ? '' : 's'} on this list.
                </p>
              )}

              {/* Add someone by hand */}
              <div className="relative">
                <Search className="h-4 w-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Add someone who is not on the list"
                  className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Add someone to the list"
                />
                {matchesSearch.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full bg-background border border-border rounded-md shadow-sm max-h-64 overflow-y-auto">
                    {matchesSearch.map((p) => (
                      <li key={p.id}>
                        <button
                          onClick={() => {
                            update({ added: [...added, p.id], removed: removed.filter((id) => id !== p.id) });
                            setSearch('');
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center justify-between gap-2"
                        >
                          <span className="truncate">{p.name}</span>
                          <Plus className="h-4 w-4 text-muted-foreground shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {removed.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="text-muted-foreground">Taken off:</span>
                  {removed.map((id) => (
                    <button
                      key={id}
                      onClick={() => update({ removed: removed.filter((r) => r !== id) })}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border hover:bg-muted"
                      title="Put back on the list"
                    >
                      {byId.get(id)?.name ?? 'Someone'} <Plus className="h-3 w-3" />
                    </button>
                  ))}
                </div>
              )}

              <ul className="bg-card border border-border rounded-lg divide-y divide-border">
                {list.length === 0 ? (
                  <li className="p-6 text-center text-sm text-muted-foreground">Nobody matches these groups.</li>
                ) : (
                  list.map((p) => (
                    <PersonRow
                      key={p.id}
                      person={p}
                      addedByHand={added.includes(p.id)}
                      onRemove={() =>
                        update({ removed: [...removed, p.id], added: added.filter((id) => id !== p.id) })
                      }
                    />
                  ))
                )}
              </ul>
            </section>
          </div>
        )}
      </main>
      <AppFooter />
    </div>
  );
}

function PersonRow({
  person,
  addedByHand,
  onRemove,
}: {
  person: DirectoryPerson;
  addedByHand: boolean;
  onRemove: () => void;
}) {
  const meta = [person.values.team?.[0], person.values.status?.[0], addedByHand ? 'added by hand' : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <li className="flex items-center gap-2 px-3 py-2">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{person.name}</p>
        <p className="text-xs text-muted-foreground truncate">
          {person.emails.length ? person.emails.join(', ') : 'No email address'}
          {meta && ` · ${meta}`}
        </p>
      </div>
      <button
        onClick={onRemove}
        className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted shrink-0"
        aria-label={`Take ${person.name} off the list`}
        title="Take off the list"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

function PageSkeleton({ inline = false }: { inline?: boolean }) {
  const body = (
    <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
      <Skeleton className="h-64 rounded-lg" />
      <div className="space-y-3">
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
  return inline ? body : <div className="min-h-screen bg-background p-6">{body}</div>;
}
