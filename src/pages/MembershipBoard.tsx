import { Suspense, lazy, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, User, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import AppFooter from '@/components/AppFooter';
import { Skeleton } from '@/components/ui/skeleton';
import ApplicantCard from '@/components/membership/ApplicantCard';
import ApplicantSheet from '@/components/membership/ApplicantSheet';
import KanbanColumns, { BoardColumnsSkeleton } from '@/components/membership/KanbanColumns';
import { downloadActiveMembers, type ApplicantCard as Card } from '@/api/membership';
import { useMembershipBoard, useMyProfile } from '@/lib/queries';
import { NEEDS_FIXING } from '@shared/membershipStages';

// Its own chunk: an officer checking the board never downloads the charts.
const MembershipInsights = lazy(() => import('@/components/membership/MembershipInsights'));
// Likewise the commitment reviews, fetched only when their tab is opened.
const StatementsBoard = lazy(() => import('@/components/membership/StatementsBoard'));

const TABS = [
  { key: 'board', label: 'Process' },
  { key: 'statements', label: 'Statements' },
  { key: 'insights', label: 'Insights' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** Filters live in the address, so a view can be bookmarked or shared. */
const FILTERS = [{ key: 'type', label: 'Applicant type', of: (c: Card) => c.applicantType }] as const;

export default function MembershipBoard() {
  const navigate = useNavigate();
  const { data: profile, isLoading: profileLoading } = useMyProfile();
  const allowed = profile?.sections?.includes('membership') ?? false;
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.find((t) => t.key !== 'board' && t.key === params.get('view'))?.key ?? 'board';
  const { data: board, isLoading, isError, refetch } = useMembershipBoard(allowed && tab === 'board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const query = params.get('q') ?? '';
  const showParked = params.get('parked') === '1';
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const cards = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (board?.cards ?? []).filter(
      (c) =>
        (!q || c.name.toLowerCase().includes(q) || (c.membershipNo ?? '').includes(q)) &&
        FILTERS.every((f) => !params.get(f.key) || f.of(c) === params.get(f.key)),
    );
  }, [board, query, params]);

  const options = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map((f) => [
          f.key,
          [...new Set((board?.cards ?? []).map(f.of).filter((v): v is string => !!v))].sort(),
        ]),
      ),
    [board],
  );

  const byColumn = (column: string) => cards.filter((c) => c.column === column);
  const broken = byColumn(NEEDS_FIXING);
  const parkedCount = (board?.columns.parked ?? []).reduce((n, col) => n + byColumn(col).length, 0);
  // Empty stages are hidden (owner request, 2026-09-25): a column of "None"
  // costs a swipe on a phone and says nothing the stage chips do not.
  const columns = [...(board?.columns.pipeline ?? []), ...(showParked ? board?.columns.parked ?? [] : [])].filter(
    (column) => byColumn(column).length > 0,
  );
  const open = cards.find((c) => c.id === openId) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const count = await downloadActiveMembers();
      toast.success(`Exported ${count} active members`);
    } catch {
      toast.error('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  if (profileLoading) return <BoardSkeleton />;
  if (!allowed) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background p-6">
        <div className="text-center space-y-3">
          <p className="text-lg font-semibold text-foreground">Membership access required</p>
          <p className="text-sm text-muted-foreground">
            This section is for the Membership Officers and Section Captains.
          </p>
          <button onClick={() => navigate('/')} className="text-sm text-primary underline">
            Go to Player Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <AppHeader subtitle="Membership">
        <button onClick={exportCsv} disabled={exporting} className={headerNavClass()} title="Active members CSV">
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Active members CSV'}</span>
        </button>
        <button onClick={() => navigate('/')} className={headerNavClass()}>
          <User className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Player View</span>
        </button>
      </AppHeader>

      <main className="flex-1 container mx-auto px-4 py-4">
        <div role="tablist" aria-label="Membership views" className="flex gap-1 mb-4 border-b border-border">
          {TABS.map(({ key: t, label }) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => {
                // Each view keeps only its own settings in the address.
                const next = new URLSearchParams();
                if (t !== 'board') next.set('view', t);
                setParams(next, { replace: true });
              }}
              className={`px-3 py-2 text-sm -mb-px border-b-2 transition-colors ${
                tab === t
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'insights' ? (
          <Suspense fallback={<BoardColumnsSkeleton />}>
            <MembershipInsights />
          </Suspense>
        ) : tab === 'statements' ? (
          <Suspense fallback={<BoardColumnsSkeleton />}>
            <StatementsBoard />
          </Suspense>
        ) : (
        <>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <label className="relative flex-1 min-w-[12rem]">
            <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setParam('q', e.target.value || null)}
              placeholder="Search name or Membership No."
              className="w-full h-9 rounded-md border border-border bg-background pl-8 pr-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              aria-label="Search applicants"
            />
          </label>
          {FILTERS.map((f) => (
            <select
              key={f.key}
              value={params.get(f.key) ?? ''}
              onChange={(e) => setParam(f.key, e.target.value || null)}
              className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              aria-label={f.label}
            >
              <option value="">{f.label}: all</option>
              {options[f.key]?.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ))}
          <button
            onClick={() => setParam('parked', showParked ? null : '1')}
            className={headerNavClass(showParked)}
            aria-pressed={showParked}
          >
            {showParked ? 'Hide' : 'Show'} parked ({parkedCount})
          </button>
        </div>

        {board && !board.hasStageDates && (
          <p className="text-xs text-muted-foreground mb-3">
            Days are counted from the application date until the base has a "Stage Updated At" field.
          </p>
        )}

        {broken.length > 0 && (
          <div className="mb-3 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10">
            <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
              {broken.length} {broken.length === 1 ? 'record has' : 'records have'} an Applicant Stage that needs fixing in
              Airtable
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {broken.map((c) => `${c.name} (${c.stage})`).join(', ')}
            </p>
          </div>
        )}

        {isLoading ? (
          <BoardColumnsSkeleton />
        ) : isError || !board ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground mb-2">Could not load the applications.</p>
            <button onClick={() => refetch()} className="text-sm text-primary underline">
              Try again
            </button>
          </div>
        ) : columns.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-border rounded-xl">
            <p className="text-muted-foreground">
              {query || FILTERS.some((f) => params.get(f.key)) ? 'No applicants match.' : 'No applications in progress.'}
            </p>
          </div>
        ) : (
          <KanbanColumns
            columns={columns}
            itemsFor={byColumn}
            chipLabel={(column) => column.replace(/ \(Signed\)$/, '')}
            renderItem={(card) => <ApplicantCard card={card} onOpen={() => setOpenId(card.id)} />}
          />
        )}
        </>
        )}
      </main>

      <AppFooter />
      {open && <ApplicantSheet card={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-4">
      <Skeleton className="h-10 w-48" />
      <BoardColumnsSkeleton />
    </div>
  );
}
