import { useState, useMemo, useEffect, Fragment, Suspense, lazy } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import type { MyFixture } from '@/api/getMyFixtures';
import { useMyFixtures, useMyProfile, useQuickAvailability, useBulkAvailability } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { hkDateKey } from '@shared/hkDateKey';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, CalendarDays, ChevronDown, IdCard, Settings, Shield } from 'lucide-react';
import PlayerFixtureCard from '@/components/PlayerFixtureCard';
import PlayerAvailabilitySheet from '@/components/PlayerAvailabilitySheet';
import AvailabilityNoteSheet from '@/components/AvailabilityNoteSheet';
import SameDayGamesPrompt from '@/components/SameDayGamesPrompt';
import { otherGamesThatDay, needsSameDayPrompt, groupByHkDay, multiFixtureDays, firstCardOfEachDay } from '@/lib/sameDayGames';
import DayAnswerControl from '@/components/DayAnswerControl';
import { DateHeading, SectionHeader } from '@/components/shared';
import { toast } from 'sonner';
import AppFooter from '@/components/AppFooter';
import AppHeader, { headerNavClass } from '@/components/AppHeader';
import PastFixtureCard from '@/components/PastFixtureCard';
import BirthdayBanner, { TeamBirthdayBanner } from '@/components/BirthdayBanner';
import MyTasksBanner from '@/components/MyTasksBanner';
import MyKitCard from '@/components/MyKitCard';
import MyVolunteeringLink from '@/components/MyVolunteeringLink';
import EventsSection from '@/components/events/EventsSection';
import { MainMenu, ProfileMenu, officerItems } from '@/components/HeaderMenus';
import UmpireViewButton from '@/components/UmpireViewButton';
import { coachDashboardPath, useScrollMemory } from '@/lib/scrollMemory';

// Opened from the profile menu: loaded then, not with the page.
const CalendarSyncSheet = lazy(() => import('@/components/CalendarSyncSheet'));
const SeasonStatsSheet = lazy(() => import('@/components/SeasonStatsSheet'));
const AvailabilityRulesSheet = lazy(() => import('@/components/AvailabilityRulesSheet'));

type AvailabilityStatus = 'Available' | 'Maybe' | 'Unavailable';

const dateKey = (d: string) => hkDateKey(d);

// "Keep as is" on the same-day prompt is remembered per fixture on this
// device, so a player who really is free for the support game later that day
// is not asked again every visit.
const promptDismissedKey = (fixtureId: string) => `sameDayPrompt.dismissed.${fixtureId}`;

function isPromptDismissed(fixtureId: string): boolean {
  try {
    return localStorage.getItem(promptDismissedKey(fixtureId)) === '1';
  } catch {
    return false;
  }
}

function setPromptDismissed(fixtureId: string, dismissed: boolean): void {
  try {
    if (dismissed) localStorage.setItem(promptDismissedKey(fixtureId), '1');
    else localStorage.removeItem(promptDismissedKey(fixtureId));
  } catch {
    // Storage unavailable: the prompt just comes back next visit.
  }
}

export default function PlayerDashboard() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  // Open by default (owner request, 2026-09-23) - players want to see how the
  // last games went. Results are always fetched (a few recent fixtures, read
  // from the cached season context) and hiding them is display-only, so the
  // toggle never swaps the page back to the skeleton for a refetch. Home
  // (App.tsx) starts this same query alongside the profile.
  const [showPast, setShowPast] = useState(true);
  const { data, isLoading: loading } = useMyFixtures(true);
  const quickAvailability = useQuickAvailability();
  const bulkAvailability = useBulkAvailability();
  const [selectedFixture, setSelectedFixture] = useState<MyFixture | null>(null);
  // Maybe / No just tapped on a card: offer the optional note.
  const [notePrompt, setNotePrompt] = useState<{ fixture: MyFixture; status: 'Maybe' | 'Unavailable' } | null>(null);
  const [showCalendarSync, setShowCalendarSync] = useState(false);
  // The burger's quizzes, umpiring duties and invite link (my-profile). Can
  // still be on its way: the menu fills in when it lands.
  const myProfile = useMyProfile().data;
  const [showPlayUps, setShowPlayUps] = useState(false);
  const [showSupport, setShowSupport] = useState(false);
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const [statsPlayerId, setStatsPlayerId] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  // Same-day prompts the player has started answering stay open (even once
  // every game reads No) until they press Done, so rows don't vanish under
  // their thumb. `dismissTick` re-renders after a dismissal is stored.
  const [promptsOpen, setPromptsOpen] = useState<Set<string>>(() => new Set());
  const [, setDismissTick] = useState(0);
  const keepPromptOpen = (fixtureId: string, open: boolean) =>
    setPromptsOpen((prev) => {
      const next = new Set(prev);
      if (open) next.add(fixtureId);
      else next.delete(fixtureId);
      return next;
    });

  const handleQuickAvailability = (fixtureId: string, status: AvailabilityStatus, notes?: string) => {
    // A fresh "No" is a new moment to ask about the rest of the day.
    if (status === 'Unavailable') setPromptDismissed(fixtureId, false);
    // No toast on success: the card changes under the player's thumb, which
    // says it. A failure rolls the card back and does say so.
    quickAvailability.mutate(
      { fixtureId, status, notes },
      { onError: () => toast.error('Could not save your answer. Try again.') },
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
        onError: () => toast.error(`Could not save your answers for ${safeFormat(date, 'EEE d MMM')}. Try again.`),
        onSettled: () => setBulkBusy(null),
      },
    );
  };

  // Saying No to a Support Fixture while Available for their My Team fixture
  // that day: the note pop-up suggests explaining why.
  const supportConflictHint = (f: MyFixture): string | undefined => {
    if (f.fixtureCategory !== 'support') return undefined;
    const ownAvailable = (data?.fixtures ?? []).some(
      (x) => dateKey(x.date) === dateKey(f.date) && x.availabilityStatus === 'Available'
    );
    return ownAvailable ? data?.displayTeam || data?.registeredTeam || '' : undefined;
  };

  // A card's own Maybe / No: saved at once (keeping any note already there),
  // then the note pop-up offers to add or change it.
  const handleCardAvailability = (f: MyFixture, status: AvailabilityStatus) => {
    if (status === 'Available') {
      handleQuickAvailability(f.id, status);
      return;
    }
    handleQuickAvailability(f.id, status, f.playerNotes);
    setNotePrompt({ fixture: f, status });
  };

  const openFixture = (f: MyFixture) => setSelectedFixture(f);

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

  // Every fixture the player can answer, for the same-day prompt.
  const allFixtures = useMemo(
    () => (data ? [...data.fixtures, ...(data.playUpOpportunities ?? []), ...(data.supportFixtures ?? [])] : []),
    [data],
  );
  const fixturesByDay = useMemo(() => groupByHkDay(allFixtures), [allFixtures]);
  // Days with more than one game get one whole-day answer.
  const multiDays = useMemo(() => multiFixtureDays(fixturesByDay), [fixturesByDay]);

  // A fixture link the coach shared on WhatsApp (?fixture=<match id>) opens
  // that fixture's sheet once the list has loaded. A game that isn't on
  // their page (already played, or not their team) just says so.
  const [params, setParams] = useSearchParams();
  const sharedFixtureId = params.get('fixture');
  useEffect(() => {
    if (!sharedFixtureId || !data) return;
    const f = allFixtures.find((x) => x.id === sharedFixtureId);
    if (f) openFixture(f);
    else toast.info("That game isn't on your page any more");
    setParams(
      (p) => {
        p.delete('fixture');
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedFixtureId, data, allFixtures]);

  // Back from a player's full stats (or the coach screens) lands where the
  // player left off rather than at the top.
  useScrollMemory('player-dashboard', !loading && !!data);

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
      onAvailabilityChange={(status) => handleCardAvailability(f, status)}
    />
  );

  // The whole-day control sits in front of the first card of its day, in
  // the order the cards are shown (a collapsed list shows none).
  const dayAnchors = firstCardOfEachDay(
    [...data.fixtures, ...(showPlayUps ? playUps : []), ...(showSupport ? support : [])],
    multiDays,
  );
  const renderDayControl = (f: MyFixture) => {
    if (!dayAnchors.has(f)) return null;
    const key = dateKey(f.date);
    return (
      <DayAnswerControl
        date={key}
        fixtures={multiDays.get(key) ?? []}
        busy={bulkBusy !== null}
        onSet={handleBulkAvailability}
      />
    );
  };
  // A play-up or support card, with its day's control in front when it is the first shown.
  const renderListed = (f: MyFixture) => (
    <Fragment key={`${f.id}-${f.hkfcTeam}`}>
      {renderDayControl(f)}
      {renderCard(f)}
    </Fragment>
  );

  // Under a My Team card the player is out for, while they still read as in
  // for another game that day.
  const renderSameDayPrompt = (f: MyFixture) => {
    const key = dateKey(f.date);
    const others = otherGamesThatDay(f, fixturesByDay.get(key) ?? []);
    const open = promptsOpen.has(f.id);
    if (!open && (!needsSameDayPrompt(f, others) || isPromptDismissed(f.id))) return null;
    if (others.length === 0) return null;
    return (
      <SameDayGamesPrompt
        fixture={f}
        others={others}
        busy={bulkBusy !== null}
        onSet={(id, status) => {
          keepPromptOpen(f.id, true);
          handleQuickAvailability(id, status);
        }}
        onOutAllDay={() => {
          keepPromptOpen(f.id, false);
          handleBulkAvailability(key, 'Unavailable');
        }}
        onClose={() => {
          keepPromptOpen(f.id, false);
          if (others.some((o) => o.availabilityStatus !== 'Unavailable')) setPromptDismissed(f.id, true);
          setDismissTick((t) => t + 1);
        }}
      />
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader menu={<MainMenu officer={officerItems(data)} profile={myProfile} />}>
        {(data.isCoach || data.isSectionCaptain) && (
          <button onClick={() => navigate(coachDashboardPath())} className={headerNavClass()}>
            <Shield className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Coach View</span>
          </button>
        )}
        {data.umpiring && <UmpireViewButton />}
        <ProfileMenu
          guide="player"
          onLogout={() => logout()}
          entries={[
            { to: '/my-details', label: 'My details', icon: IdCard },
            ...(data.playerId ? [{ label: 'My season stats', icon: BarChart3, onSelect: () => setStatsPlayerId(data.playerId!) }] : []),
            { label: 'Availability preferences', icon: Settings, onSelect: () => setShowRules(true) },
            { label: 'Sync to calendar', icon: CalendarDays, onSelect: () => setShowCalendarSync(true) },
          ]}
        />
      </AppHeader>

      {/* What the player came for comes first: anything they must do, then
          their fixtures. Events, kit and the rest follow. */}
      <div className="container mx-auto px-4 pt-4 pb-8">
        <MyTasksBanner />

        {isSpecialGK ? (
          data.fixtures.length === 0 ? (
            <div className="text-center py-12 border border-dashed border-border rounded-xl">
              <p className="text-muted-foreground">No upcoming HKFC fixtures</p>
            </div>
          ) : (
            <div className="space-y-4">
              {gkFixturesByDate?.map(([date, list]) => (
                <div key={date}>
                  <DateHeading date={date} suffix={` (${list.length})`} />
                  <div className="space-y-2">
                    {list.length > 1 && (
                      <DayAnswerControl date={date} fixtures={list} busy={bulkBusy !== null} onSet={handleBulkAvailability} />
                    )}
                    {list.map((f) => renderCard(f))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <SectionHeader title="My Team" count={data.fixtures.length} />
            {data.fixtures.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl">
                <p className="text-muted-foreground">No upcoming fixtures for your team</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.fixtures.map((f) => (
                  <Fragment key={`${f.id}-${f.hkfcTeam}`}>
                    {renderDayControl(f)}
                    {renderCard(f)}
                    {renderSameDayPrompt(f)}
                  </Fragment>
                ))}
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
                {showPlayUps && <div className="space-y-2 mt-2">{playUps.map((f) => renderListed(f))}</div>}
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
                {showSupport && <div className="space-y-2 mt-2">{support.map((f) => renderListed(f))}</div>}
              </div>
            )}
          </>
        )}

        <EventsSection enabled={!!data.eddyProfile} />
        <MyKitCard />
        <MyVolunteeringLink />
        {data.isBirthday && <BirthdayBanner name={data.playerName} />}
        {!!data.teamBirthdays?.length && (
          <TeamBirthdayBanner names={data.teamBirthdays} team={displayTeam} />
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
              {(data.pastFixtures ?? []).length === 0 ? (
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
          viewerId={data.playerId}
          onClose={() => setSelectedFixture(null)}
        />
      )}
      {notePrompt && (
        <AvailabilityNoteSheet
          // A second tap on another card starts a fresh note.
          key={`${notePrompt.fixture.id}-${notePrompt.status}`}
          fixture={notePrompt.fixture}
          status={notePrompt.status}
          conflictHint={supportConflictHint(notePrompt.fixture)}
          busy={quickAvailability.isPending}
          onClose={() => setNotePrompt(null)}
          onSave={(notes) => {
            const { fixture, status } = notePrompt;
            setNotePrompt(null);
            quickAvailability.mutate(
              { fixtureId: fixture.id, status, notes },
              {
                onSuccess: () => toast.success('Note saved'),
                onError: () => toast.error('Failed to save note'),
              },
            );
          }}
        />
      )}
      <Suspense fallback={null}>
        {showCalendarSync && <CalendarSyncSheet onClose={() => setShowCalendarSync(false)} />}

        {statsPlayerId && (
          <SeasonStatsSheet
            playerId={statsPlayerId}
            playerName={data.playerName}
            onClose={() => setStatsPlayerId(null)}
          />
        )}

        {/* The sheet refetches the fixtures itself as it closes, if a rule changed. */}
        {showRules && <AvailabilityRulesSheet onClose={() => setShowRules(false)} />}
      </Suspense>
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
