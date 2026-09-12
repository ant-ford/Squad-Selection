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
import AppHeader, { headerNavClass, headerIconClass } from '@/components/AppHeader';
import SeasonStatsSheet from '@/components/SeasonStatsSheet';
import AvailabilityRulesSheet from '@/components/AvailabilityRulesSheet';
import PastFixtureCard from '@/components/PastFixtureCard';

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
  // Collapsed by default. This sits above every multi-fixture day, so as a
  // permanently expanded row of buttons it added a block of height to each
  // one and pushed the fixtures themselves - the thing players came to act
  // on - down the page. Open it and the same three choices are there.
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <div className="flex justify-end -mt-1">
        <button
          onClick={() => setOpen(true)}
          className="text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline py-0.5"
        >
          Set whole day
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-1.5 py-1 flex-wrap">
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
      <button
        onClick={() => setOpen(false)}
        aria-label="Close whole-day availability"
        className="text-[11px] text-muted-foreground hover:text-foreground px-1 py-1"
      >
        &times;
      </button>
    </div>
  );
}

export default function PlayerDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Declared before the query that reads it: results are extra payload on a
  // screen most players open to answer an upcoming fixture, so they are
  // fetched only while this is on.
  const [showPast, setShowPast] = useState(false);
  const { data, isLoading: loading } = useMyFixtures(showPast);
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
      <AppHeader>
        {(data.isCoach || data.isSectionCaptain) && (
          <button onClick={() => navigate('/coach')} className={headerNavClass()}>
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Coach View</span>
          </button>
        )}
        {data.playerId && (
          <button
            onClick={() => setStatsPlayerId(data.playerId!)}
            className={headerIconClass}
            title="My season stats"
            aria-label="My season stats"
          >
            <BarChart3 className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => setShowRules(true)}
          className={headerIconClass}
          title="Availability preferences"
          aria-label="Availability preferences"
        >
          <Settings className="h-4 w-4" />
        </button>
        <button
          onClick={() => setShowCalendarSync(true)}
          className={headerIconClass}
          title="Sync to Calendar"
          aria-label="Sync to Calendar"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
        <button onClick={() => logout()} className={headerIconClass} aria-label="Log out">
          <LogOut className="h-4 w-4" />
        </button>
      </AppHeader>

      {/* Player identity card (compact - stat boxes removed) */}
      <div className="container mx-auto px-4 py-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center">
              {data.photo ? (
                <img
                  src={data.photo}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  // A stale Airtable attachment URL would otherwise leave a
                  // broken-image glyph where the initial used to be.
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <span className="text-lg font-bold text-primary">
                  {(data.playerName || '?')[0].toUpperCase()}
                </span>
              )}
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

        {/* Played fixtures. Read-only: availability is a statement about the
            future, so the buttons are replaced by what actually happened. */}
        <div className="mt-6 pt-4 border-t border-border">
          <button
            onClick={() => setShowPast((v) => !v)}
            className="w-full flex items-center justify-between text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            <span className="font-medium">Recent results</span>
            <span className="text-xs">{showPast ? 'Hide' : 'Show'}</span>
          </button>

          {showPast && (
            <div className="mt-3 space-y-2">
              {loading ? (
                <p className="text-sm text-muted-foreground py-2">Loading results…</p>
              ) : (data.pastFixtures ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">
                  No fixtures played in the last few weeks.
                </p>
              ) : (
                (data.pastFixtures ?? []).map((f) => (
                  <PastFixtureCard key={f.id} fixture={f} />
                ))
              )}
            </div>
          )}
        </div>
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
