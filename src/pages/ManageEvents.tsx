import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, PartyPopper, Plus, X } from 'lucide-react';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import HelpLink from '@/components/HelpLink';
import { fieldInput } from '@/components/profile/ProfileFields';
import { errorText, primary, secondary } from '@/components/profile/steps';
import { ActionButton } from '@/components/ui/action-button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusChip } from '@/components/ui/status-chip';
import { EVENT_STATUS_LABEL, countsLine, eventStatusTone, eventWhen } from '@/components/events/eventText';
import { findPeople, getManageView, setSocialSecretaries } from '@/api/events';
import type { ManageView, ManagedEvent } from '@shared/events';

// ── Team social secretaries ──────────────────────────────────────────────

function SocialSecretaries({ view }: { view: ManageView }) {
  const queryClient = useQueryClient();
  const [team, setTeam] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ personId: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const found = useQuery({ queryKey: ['findPeople', search.trim()], queryFn: () => findPeople(search.trim()), enabled: !!team && search.trim().length >= 2 });
  const save = useMutation({
    mutationFn: () => setSocialSecretaries(team!, picked.map((p) => p.personId)),
    onSuccess: () => {
      toast.success('Social secretaries saved');
      setTeam(null);
      void queryClient.invalidateQueries({ queryKey: ['manageEvents'] });
    },
    onError: (err) => toast.error(errorText(err)),
  });
  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-2">
      <h2 className="text-base font-semibold text-foreground">Team social secretaries</h2>
      <ul className="divide-y divide-border">
        {view.socialSecretaries.map((t) => (
          <li key={t.teamId} className="py-2">
            {team === t.team ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">{t.team}</p>
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.personId} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-muted text-foreground">
                      {p.name}
                      <button aria-label={`Remove ${p.name}`} onClick={() => setPicked(picked.filter((x) => x.personId !== p.personId))}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
                <input className={fieldInput} placeholder="Search by name to add" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search by name" />
                <ul>
                  {found.data?.people
                    .filter((p) => !picked.some((x) => x.personId === p.personId))
                    .map((p) => (
                      <li key={p.personId}>
                        <button className="w-full text-left text-sm py-1.5 hover:bg-muted rounded px-1" onClick={() => { setPicked([...picked, { personId: p.personId, name: p.name }]); setSearch(''); }}>
                          {p.name} <span className="text-xs text-muted-foreground">{p.team ?? ''}</span>
                        </button>
                      </li>
                    ))}
                </ul>
                <div className="flex justify-end gap-2">
                  <button className={secondary} onClick={() => setTeam(null)}>
                    Cancel
                  </button>
                  <button className={primary} disabled={save.isPending} onClick={() => save.mutate()}>
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-foreground w-28 shrink-0">{t.team}</span>
                <span className="text-sm text-muted-foreground flex-1 min-w-0 truncate">{t.people.map((p) => p.name).join(', ') || 'None yet'}</span>
                <button className="text-xs text-primary" onClick={() => { setTeam(t.team); setPicked(t.people); setSearch(''); }}>
                  Change
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── The page ─────────────────────────────────────────────────────────────

function EventRow({ e, onOpen }: { e: ManagedEvent; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="w-full text-left py-2 flex items-center gap-3 hover:bg-muted/50 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
          {e.posterUrl ? <img src={e.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : <PartyPopper className="h-5 w-5 text-muted-foreground" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{e.title}</p>
          <p className="text-xs text-muted-foreground truncate">
            {eventWhen(e)}
            {e.team ? ` · ${e.team}` : ''}
          </p>
          {e.status !== 'draft' && <p className="text-xs text-muted-foreground truncate">{countsLine(e)}</p>}
        </div>
        <StatusChip tone={eventStatusTone(e.status)}>{EVENT_STATUS_LABEL[e.status]}</StatusChip>
      </button>
    </li>
  );
}

/**
 * Special events, for the social secretaries and Section Captains: add an
 * event as a draft, add its poster, publish it and share the link; then
 * see who's coming, who's bringing guests, and who hasn't answered.
 */
export default function ManageEventsPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const q = useQuery({ queryKey: ['manageEvents'], queryFn: getManageView, retry: false });
  const open = (id: string) => navigate(`/events/manage/${id}`);
  // Links from before the event became a page (/events/manage?event=<id>).
  const oldLink = params.get('event');
  if (oldLink) return <Navigate to={`/events/manage/${encodeURIComponent(oldLink)}`} replace />;

  const body = () => {
    if (q.isLoading) return <Skeleton className="h-64 w-full" />;
    if (q.isError || !q.data) return <p className="text-sm text-muted-foreground">{q.error ? errorText(q.error) : 'Events are kept by the social secretaries and Section Captains.'}</p>;
    const view = q.data;
    const now = Date.now();
    const upcoming = view.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) >= now);
    const past = view.events.filter((e) => Date.parse(e.endsAt ?? e.startsAt) < now).reverse();
    return (
      <>
        <section className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-foreground">Coming up</h2>
            <ActionButton icon={<Plus />} onClick={() => navigate('/events/manage/new')}>
              New event
            </ActionButton>
          </div>
          {upcoming.length ? (
            <ul className="divide-y divide-border">
              {upcoming.map((e) => (
                <EventRow key={e.id} e={e} onOpen={() => open(e.id)} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          )}
        </section>
        {past.length > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 space-y-2">
            <h2 className="text-base font-semibold text-foreground">Past two months</h2>
            <ul className="divide-y divide-border">
              {past.map((e) => (
                <EventRow key={e.id} e={e} onOpen={() => open(e.id)} />
              ))}
            </ul>
          </section>
        )}
        {view.club && <SocialSecretaries view={view} />}
      </>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader subtitle="Events">
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <ArrowLeft className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">My page</span>
        </button>
        <HelpLink guide="events" />
      </AppHeader>
      <main className="flex-1 container mx-auto max-w-2xl px-4 py-4 space-y-3">{body()}</main>
      <AppFooter />
    </div>
  );
}
