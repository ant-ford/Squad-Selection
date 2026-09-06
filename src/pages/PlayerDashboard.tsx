import { useState, useMemo, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import type { MyFixture } from '@/api/getMyFixtures';
import { useMyFixtures, useQuickAvailability, useBulkAvailability } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { hkDateKey } from '@shared/hkDateKey';
import { Skeleton } from '@/components/ui/skeleton';
import { LogOut, Shield, CalendarDays, Info, ChevronDown, BarChart3, Settings } from 'lucide-react';
import PlayerFixtureCard from '@/components/PlayerFixtureCard';
import PlayerAvailabilitySheet from '@/components/PlayerAvailabilitySheet';
import { SectionHeader } from '@/components/shared';
import { toast } from 'sonner';
import CalendarSyncSheet from '@/components/CalendarSyncSheet';
import AppFooter from '@/components/AppFooter';
import SeasonStatsSheet from '@/components/SeasonStatsSheet';
import AvailabilityRulesSheet from '@/components/AvailabilityRulesSheet';

type AvailabilityStatus = 'Available' | 'Maybe' | 'Unavailable';

const dateKey = (d: string) => hkDateKey(d);

/**
 * One-tap availability for a whole day. Shown to the goalkeeper cohort for
 * every date, and to everyone else on dates where they have more than one
 * fixture in play (own team, play-up or support) - the case where setting
 * each card individually is the most tedious.
 */
function DayAvailabilityControl({
  date,
  busy,
  onSet,
}: {
  date: string;
  busy: string | null;
  onSet: (date: string, status: AvailabilityStatus) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 py-1.5 flex-wrap">
      <span className="text-[11px] text-muted-foreground">Set availability for the day:</span>
      {(['Available', 'Maybe', 'Unavailable'] as AvailabilityStatus[]).map((s) => (
        <button
          key={s}
          disabled={busy !== null}
          onClick={() => onSet(date, s)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-full border transition-colors disabled:opacity-50 ${
            busy === date + s
              ? 'bg-primary text-primary-foreground border-primary'
              : 'border-border text-muted-foreground hover:bg-muted/50'
          }`}
        >
          {s === 'Available' ? 'All going' : s === 'Maybe' ? 'All maybe' : 'All out'}
        </button>
      ))}
    </div>
  );
}

export default function PlayerDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, isLoading: loading } = useMyFixtures();
  const quickAvailability = useQuickAvailability();
  const bulkAvailability = useBulkAvailability();
  const [selectedFixture, setSelectedFixture] = useState<MyFixture | null>(null);
  const [conflictHint, setConflictHint] = useState<string | null>(null);
  const [showCalendarSync, setShowCalendarSync] = useState(false);
  const [showPlayUps, setShowPlayUps] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [statsPlayerId, setStatsPlayerId] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);

  const handleQuickAvailability = (fixtureId: string, status: AvailabilityStatus) => {
    quickAvailability.mutate(
      { fixtureId, status },
      {
        onSuccess: () => toast.success('Availability updated'),
        onError: () => toast.error('Failed to update availability'),
      },
    );
  };

  // Date-level bulk availability: a UX shortcut that performs the existing
  // match-level updates for every fixture on the date. "Available" removes
  // exceptions; individual cards stay overridable.
  //
  // The Worker applies this to every HKFC fixture that day, so the play-up
  // and support lists have to be patched alongside "My Team" - otherwise a
  // player marks themselves out and the play-up cards still read Available.
  const handleBulkAvailability = (date: string, status: AvailabilityStatus) => {
    setBulkBusy(date + status);
    bulkAvailability.mutate(
      { date, status },
      {
        onSuccess: () => toast.success(`Availability set for ${safeFormat(date, 'EEE d MMM')}`),
        onError: () => toast.error('Failed to update availability'),
        onSettled: () => setBulkBusy(null),
      },
    );
  };

  // Opening a Support Fixture: if the player is Available for their My Team
  // fixture on the same date, pass a soft hint to the availability sheet.
  const openFixture = (f: MyFixture) => {
    let hint: string | null = null;
    if (f.fixtureCategory === 'support') {
      const ownAvailable = (data?.fixtures ?? []).some(
        (x) => dateKey(x.date) === dateKey(f.date) && x.availabilityStatus === 'Available'
      );
      if (ownAvailable) hint = data?.displayTeam || data?.registeredTeam || '';
    }
    setConflictHint(hint);
    setSelectedFixture(f);
  };

  // Lowest-ranked-team goalkeepers see every upcoming HKFC fixture,
  // grouped by date.
  const isSpecialGK = data?.specialGoalkeeperView === true;
  const gkFixturesByDate = useMemo(() => {
    if (!data?.specialGoalkeeperView) return null;
    const map = new Map<string, MyFixture[]>();
    for (const f of data.fixtures) {
      const key = dateKey(f.date);
      const list = map.get(key) || [];
      list.push(f);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [data]);

  // How many fixtures the player could act on per date, across all three
  // lists. Drives whether a day is worth a one-tap control: on a date with a
  // single fixture the card's own buttons already do the job.
  const relevantCountByDate = useMemo(() => {
    const counts = new Map<string, number>();
    if (!data) return counts;
    const all = [
      ...data.fixtures,
      ...(data.playUpOpportunities ?? []),
      ...(data.supportFixtures ?? []),
    ];
    for (const f of all) {
      const key = dateKey(f.date);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [data]);

  // AuthGate already guarantees a signed-in user before this route renders.
  if (loading || !data) return <DashboardSkeleton />;

  const playUps = data.playUpOpportunities ?? [];
  const support = data.supportFixtures ?? [];
  const displayTeam = data.displayTeam || data.registeredTeam;

  const renderCard = (f: MyFixture) => (
    <PlayerFixtureCard
      key={`${f.id}-${f.hkfcTeam}`}
      fixture={f}
      onTap={() => openFixture(f)}
      onAvailabilityChange={(status) => handleQuickAvailability(f.id, status)}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8">
                <img src="/assets/logo-plain.svg" alt="Eddy" className="h-full w-full object-contain" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-foreground">HKFC Hockey</h1>
                <p className="text-sm text-muted-foreground">Squad Selection</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {(data.isCoach || data.isSectionCaptain) && (
                <button
                  onClick={() => navigate('/coach')}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
                >
                  <Shield className="h-3.5 w-3.5" />
                  Coach View
                </button>
              )}
              {data.playerId && (
                <button
                  onClick={() => setStatsPlayerId(data.playerId!)}
                  className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="My season stats"
                  aria-label="My season stats"
                >
                  <BarChart3 className="h-4 w-4" />
                </button>
              )}
              <button
                onClick={() => setShowRules(true)}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Availability preferences"
                aria-label="Availability preferences"
              >
                <Settings className="h-4 w-4" />
              </button>
              <button
                onClick={() => setShowCalendarSync(true)}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
                title="Sync to Calendar"
              >
                <CalendarDays className="h-4 w-4" />
              </button>
              <button
                onClick={() => logout()}
                className="p-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Player identity card (compact - stat boxes removed) */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">
                {(data.playerName || '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{data.playerName}</p>
              <p className="text-sm text-muted-foreground">
                {displayTeam || 'No team'}
                {data.playingPosition ? ` - ${data.playingPosition}` : ''}
                {data.shirtNoValue ? ` - #${data.shirtNoValue}` : ''}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 pb-8">

        {isSpecialGK ? (
          <>
            <div className="mb-3 p-3 rounded-lg bg-muted/60 border border-border">
              <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Info className="h-4 w-4 text-primary shrink-0" />
                Goalkeeper availability
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                All {displayTeam} goalkeepers can support any HKFC team. Let us know which
                matches you can play.
              </p>
            </div>
            {data.fixtures.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <p className="text-muted-foreground">No upcoming HKFC fixtures</p>
              </div>
            ) : (
              <div className="space-y-4">
                {gkFixturesByDate?.map(([date, list]) => (
                  <div key={date}>
                    <SectionHeader title={safeFormat(date, 'EEEE d MMM')} count={list.length} />
                    <DayAvailabilityControl
                      date={date}
                      busy={bulkBusy}
                      onSet={handleBulkAvailability}
                    />
                    <div className="space-y-2">
                      {list.map((f) => renderCard(f))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <SectionHeader title="My Team" count={data.fixtures.length} />
            {data.fixtures.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <p className="text-muted-foreground">No upcoming fixtures for your team</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.fixtures.map((f, i) => {
                  const key = dateKey(f.date);
                  const isFirstOfDate =
                    data.fixtures.findIndex((x) => dateKey(x.date) === key) === i;
                  const worthADayControl = (relevantCountByDate.get(key) ?? 0) > 1;
                  return (
                    <Fragment key={`${f.id}-${f.hkfcTeam}`}>
                      {isFirstOfDate && worthADayControl && (
                        <DayAvailabilityControl
                          date={key}
                          busy={bulkBusy}
                          onSet={handleBulkAvailability}
                        />
                      )}
                      {renderCard(f)}
                    </Fragment>
                  );
                })}
              </div>
            )}

            {playUps.length > 0 && (
              <div className="mt-6">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowPlayUps((v) => !v)}
                  aria-expanded={showPlayUps}
                >
                  <SectionHeader title="Play-Up Opportunities" count={playUps.length} />
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${showPlayUps ? 'rotate-180' : ''}`}
                  />
                </button>
                {showPlayUps && <div className="space-y-2 mt-2">{playUps.map((f) => renderCard(f))}</div>}
              </div>
            )}

            {support.length > 0 && (
              <div className="mt-6">
                <button
                  className="w-full flex items-center justify-between"
                  onClick={() => setShowSupport((v) => !v)}
                  aria-expanded={showSupport}
                >
                  <SectionHeader title="Support Fixtures" count={support.length} />
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${showSupport ? 'rotate-180' : ''}`}
                  />
                </button>
                {showSupport && <div className="space-y-2 mt-2">{support.map((f) => renderCard(f))}</div>}
              </div>
            )}
          </>
        )}
      </div>

      {selectedFixture && (
        <PlayerAvailabilitySheet
          fixture={selectedFixture}
          conflictHint={conflictHint ?? undefined}
          onClose={() => setSelectedFixture(null)}
          onSaved={() => {
            setSelectedFixture(null);
            queryClient.invalidateQueries({ queryKey: ['myFixtures'] });
          }}
        />
      )}
      {showCalendarSync && <CalendarSyncSheet onClose={() => setShowCalendarSync(false)} />}

      <SeasonStatsSheet
        playerId={statsPlayerId}
        playerName={data.playerName}
        onClose={() => setStatsPlayerId(null)}
      />

      {showRules && (
        <AvailabilityRulesSheet
          onClose={() => {
            setShowRules(false);
            // A new rule changes the default on every unanswered fixture.
            queryClient.invalidateQueries({ queryKey: ['myFixtures'] });
          }}
        />
      )}
      <AppFooter />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card px-4 py-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-24 mt-1" />
      </div>
      <div className="container mx-auto px-4 py-4 space-y-4">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}
