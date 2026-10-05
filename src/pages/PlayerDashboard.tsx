import { useState, useMemo, useEffect, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { useQueryClient } from '@tanstack/react-query';
import type { MyFixture } from '@/api/getMyFixtures';
import { useMyFixtures, useMyProfile, useQuickAvailability, useBulkAvailability } from '@/lib/queries';
import { safeFormat } from '@/lib/dateUtils';
import { hkDateKey } from '@shared/hkDateKey';
import { Skeleton } from '@/components/ui/skeleton';
import { BarChart3, BookOpenCheck, CalendarDays, ChevronDown, Flag, Info, LogOut, Settings, Shield, Trophy, UserPlus } from 'lucide-react';
import PlayerFixtureCard from '@/components/PlayerFixtureCard';
import PlayerAvailabilitySheet from '@/components/PlayerAvailabilitySheet';
import AvailabilityNoteSheet from '@/components/AvailabilityNoteSheet';
import SameDayGamesPrompt from '@/components/SameDayGamesPrompt';
import { otherGamesThatDay, needsSameDayPrompt } from '@/lib/sameDayGames';
import { SectionHeader } from '@/components/shared';
import { toast } from 'sonner';
import CalendarSyncSheet from '@/components/CalendarSyncSheet';
import AppFooter from '@/components/AppFooter';
import AppHeader, { headerNavClass, headerIconClass } from '@/components/AppHeader';
import SeasonStatsSheet from '@/components/SeasonStatsSheet';
import AvailabilityRulesSheet from '@/components/AvailabilityRulesSheet';
import PastFixtureCard from '@/components/PastFixtureCard';
import BirthdayBanner, { TeamBirthdayBanner } from '@/components/BirthdayBanner';
import MyTasksBanner from '@/components/MyTasksBanner';
import InviteDialog from '@/components/InviteDialog';
import MyKitCard from '@/components/MyKitCard';
import MyVolunteeringLink from '@/components/MyVolunteeringLink';
import EventsSection from '@/components/events/EventsSection';
import OfficersMenu, { officerItems } from '@/components/OfficersMenu';
import HelpLink from '@/components/HelpLink';
import { coachDashboardPath, useScrollMemory } from '@/lib/scrollMemory';
import { DEFAULT_PHOTO, fallBackToDefaultPhoto } from '@/lib/defaultPhoto';

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

/**
 * One-tap availability for a whole day, for the goalkeeper cohort, who see
 * every HKFC fixture grouped by date. Everyone else is asked about the rest
 * of the day when they say No to their own team's game (SameDayGamesPrompt),
 * which replaced this control on their list.
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
  // Declared before the query that reads it: results are fetched only while
  // this is on. Open by default (owner request, 2026-09-23) - players want to
  // see how the last games went. The payload is a few recent fixtures, and
  // the played-matches read behind it is shared through KV.
  const [showPast, setShowPast] = useState(true);
  const { data, isLoading: loading } = useMyFixtures(showPast);
  const quickAvailability = useQuickAvailability();
  const bulkAvailability = useBulkAvailability();
  const [selectedFixture, setSelectedFixture] = useState<MyFixture | null>(null);
  // Maybe / No just tapped on a card: offer the optional note.
  const [notePrompt, setNotePrompt] = useState<{ fixture: MyFixture; status: 'Maybe' | 'Unavailable' } | null>(null);
  const [showCalendarSync, setShowCalendarSync] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  // Members' own link for inviting someone to join (my-profile; Supabase only),
  // on whichever address the app is open at.
  const myProfile = useMyProfile().data;
  const profileInvite = myProfile?.inviteLink;
  const quizzesOn = myProfile?.quizzes ?? false;
  const inviteLink = profileInvite ? `${window.location.origin}/join${new URL(profileInvite).search}` : null;
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
    quickAvailability.mutate(
      { fixtureId, status, notes },
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

  // Under a My Team card the player is out for, while they still read as in
  // for another game that day.
  const renderSameDayPrompt = (f: MyFixture) => {
    const others = otherGamesThatDay(f, allFixtures);
    const open = promptsOpen.has(f.id);
    if (!open && (!needsSameDayPrompt(f, others) || isPromptDismissed(f.id))) return null;
    if (others.length === 0) return null;
    const key = dateKey(f.date);
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
      <AppHeader>
        <button onClick={() => navigate('/stats')} className={headerNavClass()}>
          <Trophy className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Stats</span>
        </button>
        <OfficersMenu
          items={officerItems(data)}
          extras={[
            // The coordinator has it among the officers' screens.
            ...(data.umpiring === 'umpire' ? [{ to: '/umpiring', label: 'Umpiring duties', icon: Flag }] : []),
            ...(quizzesOn ? [{ to: '/quizzes', label: 'Hockey Rules quizzes', icon: BookOpenCheck }] : []),
          ]}
          action={inviteLink ? { label: 'Invite someone to join', icon: UserPlus, onSelect: () => setShowInvite(true) } : undefined}
        />
        {(data.isCoach || data.isSectionCaptain) && (
          <button onClick={() => navigate(coachDashboardPath())} className={headerNavClass()}>
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
        <HelpLink guide="player" />
        <button onClick={() => logout()} className={headerIconClass} aria-label="Log out">
          <LogOut className="h-4 w-4" />
        </button>
      </AppHeader>
      {showInvite && inviteLink && <InviteDialog link={inviteLink} onClose={() => setShowInvite(false)} />}

      {/* Player identity card (compact - stat boxes removed) */}
      <div className="container mx-auto px-4 py-4">
        <MyTasksBanner />
        <MyKitCard />
        <div className="bg-card border border-border rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 shrink-0 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center">
              <img
                src={data.photo || DEFAULT_PHOTO}
                alt=""
                className="h-full w-full object-cover"
                loading="lazy"
                onError={fallBackToDefaultPhoto}
              />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-foreground">{data.playerName}</p>
              <p className="text-sm text-muted-foreground">
                {displayTeam || 'No team'}
                {data.playingPosition ? ` - ${data.playingPosition}` : ''}
                {data.shirtNoValue ? ` - #${data.shirtNoValue}` : ''}
              </p>
            </div>
            {data.eddyProfile && (
              <button onClick={() => navigate('/my-details')} className="text-xs font-medium text-primary shrink-0">
                My details
              </button>
            )}
          </div>
        </div>
        <MyVolunteeringLink />
        {data.isBirthday && <BirthdayBanner name={data.playerName} />}
        {!!data.teamBirthdays?.length && (
          <TeamBirthdayBanner names={data.teamBirthdays} team={displayTeam} />
        )}
        <EventsSection enabled={!!data.eddyProfile} />
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
                    <h2 className="text-sm font-bold text-foreground uppercase tracking-wide mb-3">
                      {safeFormat(date, 'EEEE d MMM')} ({list.length})
                    </h2>
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
                {data.fixtures.map((f) => (
                  <Fragment key={`${f.id}-${f.hkfcTeam}`}>
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
