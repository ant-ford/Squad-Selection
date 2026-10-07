import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { Copy, Search } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/apiClient';
import { safeFormat } from '@/lib/dateUtils';
import { getVolunteersBoard } from '@/api/volunteering';
import { COACH_LEVELS, UMPIRE_LEVELS, VOLUNTEER_GROUPS, type Volunteer } from '@shared/volunteering';

const input =
  'w-full h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary';
const chip = 'text-[11px] px-2 py-0.5 rounded-full bg-muted text-foreground';

/** A role and who offered it; the qualifications are shown the same way. */
interface RoleList {
  group: string;
  role: string;
  people: Volunteer[];
}

async function copyEmails(list: Volunteer[]) {
  const emails = list.map((v) => v.email).filter((e): e is string => !!e);
  try {
    await navigator.clipboard.writeText(emails.join('; '));
    toast.success(`${emails.length} email${emails.length === 1 ? '' : 's'} copied`);
  } catch {
    toast.error("Couldn't copy. Try again.");
  }
}

const NO_TEAM = 'No team';

/** People split by team (A first, no team last), alphabetical within each. */
function byTeam(people: Volunteer[]): [string, Volunteer[]][] {
  const teams = new Map<string, Volunteer[]>();
  for (const v of people) {
    const team = v.team || NO_TEAM;
    teams.set(team, [...(teams.get(team) ?? []), v]);
  }
  return [...teams.entries()]
    .sort(([a], [b]) => (a === NO_TEAM ? 1 : b === NO_TEAM ? -1 : a.localeCompare(b)))
    .map(([team, list]) => [team, [...list].sort((a, b) => a.name.localeCompare(b.name))]);
}

function ByRole({ lists }: { lists: RoleList[] }) {
  const groups = [...new Set(lists.map((l) => l.group))];
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g} className="rounded-xl border border-border bg-card">
          <h2 className="text-sm font-semibold text-foreground px-3 pt-3">{g}</h2>
          <ul className="divide-y divide-border">
            {lists
              .filter((l) => l.group === g)
              .map((l) => (
                <li key={l.role} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-foreground">
                      {l.role} <span className="text-xs text-muted-foreground">{l.people.length}</span>
                    </span>
                    {l.people.length > 0 && (
                      <button className="inline-flex items-center gap-1 text-xs text-primary" onClick={() => copyEmails(l.people)}>
                        <Copy className="h-3 w-3" /> Emails
                      </button>
                    )}
                  </div>
                  {l.people.length > 0 ? (
                    <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2">
                      {byTeam(l.people).map(([team, list]) => (
                        <div key={team} className="min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{team}</p>
                          <ul className="text-xs text-foreground">
                            {list.map((v) => (
                              <li key={v.id} className="truncate">
                                {v.name}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">Nobody yet.</p>
                  )}
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ByPerson({ people }: { people: Volunteer[] }) {
  if (people.length === 0) {
    return <p className="rounded-xl border border-border bg-card px-3 py-6 text-center text-sm text-muted-foreground">Nobody matches.</p>;
  }
  return (
    <div className="space-y-4">
      {byTeam(people).map(([team, list]) => (
        <section key={team}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
            {team} ({list.length})
          </h2>
          <ul className="rounded-xl border border-border bg-card divide-y divide-border">
            {list.map((v) => (
              <li key={v.id} className="px-3 py-2">
                <p className="text-sm text-foreground">
                  {v.name}
                  <span className="text-xs text-muted-foreground">
                    {' '}
                    {[v.status !== 'Member' ? v.status : '', v.active ? '' : 'not Active'].filter(Boolean).join(' · ')}
                  </span>
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {VOLUNTEER_GROUPS.flatMap((g) => v.roles[g.key].map((r) => <span key={`${g.key}-${r}`} className={chip}>{r}</span>))}
                  {v.qualifiedCoach && <span className={`${chip} bg-primary-tint/10 text-primary`}>Coach {v.qualifiedCoach}</span>}
                  {v.qualifiedUmpire && <span className={`${chip} bg-primary-tint/10 text-primary`}>Umpire {v.qualifiedUmpire}</span>}
                </div>
                {v.updatedAt && <p className="text-[11px] text-muted-foreground mt-0.5">Updated {safeFormat(v.updatedAt, 'd MMM yyyy')}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * Who would help with what: every role on the volunteering form with the
 * people who offered it, or each person with their roles, plus coaching and
 * umpiring levels. For officers, coaches and captains.
 */
export default function Volunteers() {
  const [params, setParams] = useSearchParams();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['volunteersBoard'], queryFn: getVolunteersBoard, staleTime: 60_000 });
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const view = params.get('view') === 'people' ? 'people' : 'roles';
  const everyone = params.get('all') === '1';
  const q = (params.get('q') ?? '').trim().toLowerCase();

  const people = useMemo(
    () => (data?.volunteers ?? []).filter((v) => (everyone || v.active) && (!q || v.name.toLowerCase().includes(q) || v.team.toLowerCase().includes(q))),
    [data, everyone, q],
  );
  const lists = useMemo<RoleList[]>(
    () => [
      ...VOLUNTEER_GROUPS.flatMap((g) => g.options.map((role) => ({ group: g.label, role, people: people.filter((v) => v.roles[g.key].includes(role)) }))),
      ...COACH_LEVELS.map((l) => ({ group: 'Qualified coaches', role: l, people: people.filter((v) => v.qualifiedCoach === l) })).filter((l) => l.people.length),
      ...UMPIRE_LEVELS.map((l) => ({ group: 'Qualified umpires', role: l, people: people.filter((v) => v.qualifiedUmpire === l) })).filter((l) => l.people.length),
    ],
    [people],
  );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader title="Volunteers" />
      <main className="flex-1 container mx-auto max-w-3xl px-4 py-4 space-y-3">
        {isLoading ? (
          <Skeleton className="h-96 w-full" />
        ) : error || !data ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">{error instanceof ApiError && error.status < 500 ? error.message : 'Could not load the volunteers.'}</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className="flex gap-1 border-b border-border">
              {(['roles', 'people'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setParam('view', v === 'roles' ? null : v)}
                  className={`px-3 py-2 text-sm -mb-px border-b-2 ${view === v ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground'}`}
                >
                  {v === 'roles' ? 'By role' : `By person (${people.length})`}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[12rem]">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <input className={`${input} pl-8`} value={params.get('q') ?? ''} onChange={(e) => setParam('q', e.target.value || null)} placeholder="Name or team" aria-label="Search" />
              </div>
              <label className="flex items-center gap-2 text-xs text-foreground">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--primary))]" checked={everyone} onChange={(e) => setParam('all', e.target.checked ? '1' : null)} />
                Include players who aren't Active
              </label>
            </div>
            {view === 'roles' ? <ByRole lists={lists} /> : <ByPerson people={people} />}
          </>
        )}
      </main>
      <AppFooter />
    </div>
  );
}
