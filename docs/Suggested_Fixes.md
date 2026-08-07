src\pages\FixtureList.tsx"

import { useState, useMemo, useEffect } from 'react';
import { useSearchParams, useOutletContext } from 'react-router-dom';
import { useUpcomingFixtures } from '@/lib/queries';
import { safeFormat, isPastFixture } from '@/lib/dateUtils';
import { Skeleton } from '@/components/ui/skeleton';
import FixtureCard from '@/components/FixtureCard';
import type { ProfileData } from '@/api/getMyProfile';
import type { UpcomingFixture } from '@/api/getUpcomingFixtures';
import { CoachCalendarExport } from '@/components/CoachCalendarExport';

export default function FixtureList() {
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const [searchParams, setSearchParams] = useSearchParams();

  // Initialize state from URL parameters
  const teamFromUrl = searchParams.get('team') || 'all';
  const [activeTab, setActiveTab] = useState(teamFromUrl);
  const [showPast, setShowPast] = useState(searchParams.get('past') === '1');

  // Sync URL when activeTab changes
  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const newParams = new URLSearchParams(searchParams);
    if (tab === 'all') {
      newParams.delete('team');
    } else {
      newParams.set('team', tab);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Sync URL when showPast changes
  const handleTogglePast = () => {
    setShowPast(prev => {
      const next = !prev;
      const newParams = new URLSearchParams(searchParams);
      if (next) {
        newParams.set('past', '1');
      } else {
        newParams.delete('past');
      }
      setSearchParams(newParams, { replace: true });
      return next;
    });
  };

  // Keep state in sync if URL changes externally (e.g., browser back/forward buttons)
  useEffect(() => {
    const tabFromUrl = searchParams.get('team') || 'all';
    if (tabFromUrl !== activeTab) {
      setActiveTab(tabFromUrl);
    }
    const pastFromUrl = searchParams.get('past') === '1';
    if (pastFromUrl !== showPast) {
      setShowPast(pastFromUrl);
    }
  }, [searchParams, activeTab, showPast]);

  // Performance: fetch ALL coached fixtures once; tabs filter client-side.
  // The Worker already returns every coached team's fixtures when no team
  // param is passed, so per-tab requests were redundant round-trips that
  // blanked the list behind skeletons on every tab switch.
  const { data, isLoading } = useUpcomingFixtures();
  const allFixtures = data?.fixtures || [];

  const fixtures = useMemo(() => {
    let filtered = activeTab === 'all' ? allFixtures : allFixtures.filter((f) => f.hkfcTeam === activeTab);
    if (!showPast) {
      filtered = filtered.filter((f) => !isPastFixture(f.date));
    }
    return filtered;
  }, [allFixtures, activeTab, showPast]);

  const coachTeams = profile?.coachTeams ?? [];
  const isSectionCaptain = !!profile?.isSectionCaptain;
  // Section captains see the full section — derive all team names from
  // the fixtures response itself, since the Worker returns all teams when
  // the caller is a section captain.
  const allTeamNames = useMemo(() => {
    const names = new Set(allFixtures.map((f) => f.hkfcTeam).filter(Boolean));
    return Array.from(names).sort();
  }, [allFixtures]);
  const tabs = [
    { key: 'all', label: 'All' },
    ...(isSectionCaptain
      ? allTeamNames.map((name) => ({ key: name, label: name }))
      : coachTeams.map((t) => ({ key: t.teamName, label: t.teamName }))
    ),
  ];

  const grouped = useMemo(() => {
    return fixtures.reduce<Record<string, UpcomingFixture[]>>((acc, f) => {
      const dateKey = safeFormat(f.date, 'yyyy-MM-dd', 'unknown');
      (acc[dateKey] ||= []).push(f);
      return acc;
    }, {});
  }, [fixtures]);

  const sortedDates = Object.keys(grouped).sort();

  return (
    <div className="container mx-auto px-4 pb-8">
      <div className="flex items-center justify-between gap-4 border-b border-border py-2">
        {tabs.length > 2 && (
          <div className="flex gap-4 overflow-x-auto flex-1">
            {tabs.map(t => (
              <button
                key={t.key}
                onClick={() => handleTabChange(t.key)}
                className={`text-sm pb-2 whitespace-nowrap shrink-0 ${
                  activeTab === t.key
                    ? 'font-medium text-foreground border-b-2 border-primary'
                    : 'text-muted-foreground'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleTogglePast}
            className={`text-xs px-2 py-1 rounded-md ${
              showPast ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
            title={showPast ? 'Hide past fixtures' : 'Show past fixtures'}
          >
            {showPast ? 'Showing past' : 'Hide past'}
          </button>
          <CoachCalendarExport activeTab={activeTab} />
        </div>
      </div>
      {isLoading ? (
        <div className="space-y-3 pt-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground">
            {showPast ? 'No fixtures found' : 'No upcoming fixtures found'}
          </p>
          {showPast && (
            <button
              onClick={handleTogglePast}
              className="mt-2 text-sm text-primary hover:underline"
            >
              Show upcoming fixtures
            </button>
          )}
        </div>
      ) : (
        <div className="pt-4 space-y-4">
          {sortedDates.map(dateKey => (
            <div key={dateKey}>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                {safeFormat(dateKey, 'EEE d MMM yyyy')}
              </p>
              <div className="space-y-2">
                {grouped[dateKey].map(f => (
                  <FixtureCard key={f.id} fixture={f} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


src/components/AppHeader.tsx
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { LogOut, User, ListChecks } from 'lucide-react';
import type { ProfileData } from '@/api/getMyProfile';

export default function AppHeader({ profile }: { profile: ProfileData }) {
  const navigate = useNavigate();
  const location = useLocation();
  const isDashboard = location.pathname === '/coach' || location.pathname === '/coach/fixtures';
  const isRanking = location.pathname === '/coach/ranking';
  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/');
  };
  const teamNames = profile.coachTeams.map(t => t.teamName).join(', ');
  return (
    <header className="w-full border-b border-border bg-card">
      <div className="container mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-7 w-7 sm:h-8 sm:w-8 shrink-0">
            <img src="/assets/logo-plain.svg" alt="Eddy" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <p className="text-lg font-semibold text-foreground">HKFC Squad Selection</p>
            <p className="text-sm text-muted-foreground truncate">
              {teamNames ? `Coaching: ${teamNames}` : 'No teams assigned'}
            </p>
          </div>
          <div className="sm:hidden">
            <p className="text-sm font-semibold text-foreground">HKFC Squad</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
          <button onClick={() => navigate('/coach')} className={navBtn(isDashboard)}>
            <span className="hidden sm:inline">Dashboard</span>
            <span className="sm:hidden">🏠</span>
          </button>
          <button onClick={() => navigate('/coach/ranking')} className={navBtn(isRanking)}>
            <ListChecks className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ranking</span>
          </button>
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-xs px-2 sm:px-3 py-1.5 rounded-md bg-primary text-primary-foreground"
          >
            <User className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Player View</span>
          </button>
          <button
            onClick={logout}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function navBtn(active: boolean) {
  return `flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md transition-colors ${
    active ? 'bg-secondary text-secondary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'
  }`;
}

src/components/PlayerRow.tsx
import React from 'react';
import { CheckCircle2, Circle, Ban, AlertCircle } from 'lucide-react';

type Player = {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
  availabilityStatus: string;
  playerNotes: string;
  playUpCount: number;
  eligibilityStatus: string;
  reason: string | null;
  blocks: { rule: string; reason: string }[];
  warnings: string[];
  conflicts: { type: string; team: string; matchId: string }[];
  selectionStatus: string;
  selectionId: string;
  isU21?: boolean;
  isVisitingPlayer?: boolean;
};

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

interface PlayerRowProps {
  player: Player;
  selected: boolean;
  onToggleSelection: () => void;
}

const PlayerRow = React.memo(function PlayerRow({ player, selected, onToggleSelection }: PlayerRowProps) {
  const isBlocked = player.eligibilityStatus === 'blocked';
  const isUnavailable = player.availabilityStatus === 'Unavailable';
  const isMaybe = player.availabilityStatus === 'Maybe';

  let bgClass = '';
  if (isMaybe) bgClass = 'bg-amber-50/70';
  else if (isUnavailable) bgClass = 'bg-red-50/70';

  const dimmed = isBlocked || isUnavailable;

  return (
    <div
      className={`flex items-center gap-2 sm:gap-3 py-1.5 border-b border-border ${dimmed ? 'opacity-60' : ''} ${bgClass} cursor-pointer hover:bg-muted/50 transition-colors`}
      onClick={!isBlocked ? onToggleSelection : undefined}
    >
      <div className="shrink-0">
        {selected ? <CheckCircle2 className="h-5 w-5 text-primary" /> :
          isBlocked ? <Ban className="h-5 w-5 text-muted-foreground" /> :
          <Circle className="h-5 w-5 text-muted-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <p className="text-sm font-medium text-foreground truncate">{player.preferredName}</p>
          {player.isU21 && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1 py-0.5 rounded-sm shrink-0">U21</span>}
          {player.isVisitingPlayer && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-1 py-0.5 rounded-sm shrink-0">VP</span>}
          <span className="text-[11px] text-muted-foreground shrink-0">{POS_SHORT[player.playingPosition] || '–'} · {player.playingAbility || '–'}</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {player.registeredTeam || '–'} · {player.playUpCount} play-up{player.playUpCount !== 1 ? 's' : ''} · {player.availabilityStatus}
        </p>
        {player.playerNotes && <p className="text-xs text-muted-foreground mt-0.5 italic truncate">“{player.playerNotes}”</p>}

        {/* Cross-team conflict badges */}
        {player.conflicts?.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {player.conflicts.map((c, i) => (
              <span key={i} className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${c.type === 'selected' ? 'text-blue-600 bg-blue-50' : 'text-amber-600 bg-amber-50'}`}>
                {c.type === 'selected' ? `Selected: ${c.team}` : `Available: ${c.team}`}
              </span>
            ))}
          </div>
        )}

        {/* Blocks (reason) + warnings with icons */}
        <div className="mt-1 flex flex-wrap gap-1.5">
          {(player.blocks ?? []).map((b, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              <Ban className="h-3 w-3 shrink-0" /> {b.reason}
            </span>
          ))}
          {(player.warnings ?? []).map((w, i) => (
            <span key={i} className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              <AlertCircle className="h-3 w-3 shrink-0" /> {w}
            </span>
          ))}
        </div>
      </div>
      {selected && <span className="text-xs px-2 py-0.5 rounded shrink-0 bg-primary text-primary-foreground">Selected</span>}
    </div>
  );
});

export default PlayerRow;

src/pages/SquadSelection.tsx
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router-dom';
import { usePlayersForMatch, useAvailabilityPoll } from '@/lib/queries';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiPost } from '../lib/apiClient';
import MatchHeader from '@/components/MatchHeader';
import PlayerFilters, { filtersToParams, paramsToFilters, type FilterState } from '@/components/PlayerFilters';
import RecommendationsPanel from '@/components/RecommendationsPanel';
import PlayerRow from '@/components/PlayerRow';
import ConfirmDialog from '@/components/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/useAuth';
import { Skeleton } from '@/components/ui/skeleton';
import type { MatchPlayer } from '@/api/getPlayersForMatch';
import { ABILITY_RANK } from '../../worker/src/abilityRank';

type Delta = { playerId: string; action: 'select' | 'remove' };

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

function initials(name: string): string {
  return (name.split(' ').map(n => n[0]).join('').slice(0, 2) || '?').toUpperCase();
}

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const side = (searchParams.get("side") as "home" | "away") || undefined;
  const { data, isLoading, isError, error, refetch } = usePlayersForMatch(matchId!, side);
  const { data: pollData } = useAvailabilityPoll(matchId!, true);
  const [pendingDeltas, setPendingDeltas] = useState<Delta[]>([]);
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(window.location.search));
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    setHasChanges(pendingDeltas.length > 0);
  }, [pendingDeltas]);

  // Unsaved-changes guard: browser tab close / refresh
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  // Unsaved-changes guard: in-app navigation
  const blocker = useBlocker(hasChanges);

  const handleFilterChange = useCallback((f: FilterState) => {
    setFilters(f);
    const params = new URLSearchParams(window.location.search);
    ['position', 'eligibility', 'selection', 'availability', 'ability', 'name'].forEach(k => params.delete(k));
    const filterStr = filtersToParams(f);
    if (filterStr) {
      filterStr.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k && v) params.set(k, v);
      });
    }
    setSearchParams(params, { replace: true });
  }, [setSearchParams]);

  const mergedPlayers = useMemo<MatchPlayer[]>(() => {
    if (!data?.players) return [];
    const map = new Map(data.players.map(p => [p.id, { ...p }]));
    if (pollData?.exceptions) {
      for (const exc of pollData.exceptions) {
        const p = map.get(exc.playerId);
        if (p) { p.availabilityStatus = exc.status; p.playerNotes = exc.notes || ''; }
      }
    }
    for (const delta of pendingDeltas) {
      const p = map.get(delta.playerId);
      if (p) p.selectionStatus = delta.action === 'select' ? 'Selected' : '';
    }
    return Array.from(map.values());
  }, [data, pollData, pendingDeltas]);

  const filteredPlayers = useMemo(() => {
    const nameQuery = (filters.name ?? '').trim().toLowerCase();
    return mergedPlayers.filter(p => {
      if (nameQuery && !p.preferredName.toLowerCase().includes(nameQuery)) return false;
      if (filters.position.size > 0 && !filters.position.has(POS_SHORT[p.playingPosition] || p.playingPosition)) return false;
      if (filters.ability.size > 0 && !filters.ability.has(p.playingAbility)) return false;
      if (filters.eligibility.size > 0 && !filters.eligibility.has(p.eligibilityStatus)) return false;
      if (filters.availability.size > 0 && !filters.availability.has(p.availabilityStatus)) return false;
      if (filters.selection.size > 0) {
        const selKey = p.selectionStatus === 'Selected' ? 'selected' : 'none';
        if (!filters.selection.has(selKey)) return false;
      }
      return true;
    });
  }, [mergedPlayers, filters]);

  // Single sort: Selected first, then by Ability rank descending, then alphabetical
  const sortedPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      const aSelected = a.selectionStatus === 'Selected' ? 1 : 0;
      const bSelected = b.selectionStatus === 'Selected' ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      const abilityDiff = (ABILITY_RANK[b.playingAbility] ?? 0) - (ABILITY_RANK[a.playingAbility] ?? 0);
      if (abilityDiff !== 0) return abilityDiff;
      return a.preferredName.localeCompare(b.preferredName);
    });
  }, [filteredPlayers]);

  // Virtualization: only ~15 rows in the DOM instead of the full squad list.
  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: sortedPlayers.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  const optimisticMatch = useMemo(() => {
    if (!data?.match) return null;
    const selectedCount = mergedPlayers.filter(p => p.selectionStatus === 'Selected').length;
    return { ...data.match, selectedCount };
  }, [data?.match, mergedPlayers]);

  const selectedIdsSet = useMemo(
    () => new Set(mergedPlayers.filter(p => p.selectionStatus === 'Selected').map(p => p.id)),
    [mergedPlayers]
  );

  const pendingPlayers = useMemo(
    () => mergedPlayers.filter(p => pendingDeltas.some(d => d.playerId === p.id)),
    [mergedPlayers, pendingDeltas]
  );

  const updateDeltas = (newDeltas: Delta[]) => {
    setPendingDeltas(prev => {
      const playerIdsToUpdate = new Set(newDeltas.map(d => d.playerId));
      return [...prev.filter(d => !playerIdsToUpdate.has(d.playerId)), ...newDeltas];
    });
  };

  const handleToggleSelection = (playerId: string) => {
    const player = mergedPlayers.find(p => p.id === playerId);
    if (!player || player.eligibilityStatus === 'blocked') return;
    const serverStatus = data?.players.find(p => p.id === playerId)?.selectionStatus === 'Selected';
    const isCurrentlySelected = player.selectionStatus === 'Selected';
    const nextAction: Delta['action'] = isCurrentlySelected ? 'remove' : 'select';
    const serverMatchesIntended = (nextAction === 'select' && serverStatus) || (nextAction === 'remove' && !serverStatus);
    if (serverMatchesIntended) {
      setPendingDeltas(prev => prev.filter(d => d.playerId !== playerId));
    } else {
      updateDeltas([{ playerId, action: nextAction }]);
    }
  };

  const handleToggleAllVisible = () => {
    const eligiblePlayers = filteredPlayers.filter(p => p.eligibilityStatus !== 'blocked');
    const allSelected = eligiblePlayers.every(p => p.selectionStatus === 'Selected');
    const action: Delta['action'] = allSelected ? 'remove' : 'select';
    updateDeltas(eligiblePlayers.map(p => ({ playerId: p.id, action })));
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const selectedIds = mergedPlayers.filter(p => p.selectionStatus === 'Selected').map(p => p.id);
      await apiPost('/squad/sync', {
        matchId,
        selectedIds,
        actingEmail: user?.email,
        side: side,
      });
      const qk: [string, string | undefined, string | undefined] = ['playersForMatch', matchId, side];
      queryClient.setQueryData(qk, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          match: { ...old.match, selectedCount: selectedIds.length },
          players: old.players.map((p: any) => ({
            ...p,
            selectionStatus: selectedIds.includes(p.id) ? 'Selected' : ''
          }))
        };
      });
      toast.success('Squad synced successfully');
      setPendingDeltas([]);
      setHasChanges(false);
      queryClient.invalidateQueries({ queryKey: qk });
      queryClient.invalidateQueries({ queryKey: ['upcomingFixtures'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations', matchId, side] });
    } catch (e: any) {
      toast.error(e?.message || 'Failed to sync squad');
    } finally {
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="pb-24">
        <div className="container mx-auto px-4">
          <Skeleton className="h-8 w-40 my-3" />
        </div>
        <div className="container mx-auto px-4 py-2 space-y-2">
          {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-destructive font-medium">Failed to load players: {(error as any)?.message || "Unknown error"}</p>
        <button onClick={() => refetch()} className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium">
          Retry
        </button>
      </div>
    );
  }

  if (!data || !optimisticMatch) {
    return <div className="p-6 text-destructive">No match data available</div>;
  }

  return (
    <div className="pb-24">
      <div className="container mx-auto px-4">
        <button onClick={() => navigate('/coach/fixtures')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Fixtures
        </button>
      </div>
      <MatchHeader match={optimisticMatch} />
      {optimisticMatch.selectedCount < optimisticMatch.targetSquadSize && (
        <div className="container mx-auto px-4 pt-3">
          <RecommendationsPanel
            matchId={matchId!}
            side={side}
            excludeIds={selectedIdsSet}
            onSelect={(playerId) => updateDeltas([{ playerId, action: 'select' }])}
          />
        </div>
      )}
      <PlayerFilters filters={filters} onChange={handleFilterChange} />
      <div className="container mx-auto py-2 px-4 mb-1 flex items-center gap-3">
        <input
          type="checkbox"
          id="toggle-all"
          className="h-4 w-4 accent-primary"
          checked={filteredPlayers.length > 0 && filteredPlayers.filter(p => p.eligibilityStatus !== 'blocked').every(p => p.selectionStatus === 'Selected')}
          onChange={handleToggleAllVisible}
        />
        <label htmlFor="toggle-all" className="text-sm font-medium text-muted-foreground cursor-pointer">Select All</label>
      </div>
      {/* Player list — virtualized; sorted: Selected first, then by Ability */}
      <div ref={listRef} className="container mx-auto px-4 max-h-[70vh] overflow-y-auto">
        {sortedPlayers.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            No players match the current filters.
          </div>
        ) : (
          <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const p = sortedPlayers[virtualRow.index];
              return (
                <div
                  key={p.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <PlayerRow
                    player={p}
                    selected={p.selectionStatus === 'Selected'}
                    onToggleSelection={() => handleToggleSelection(p.id)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-3 sm:p-4 flex gap-3 z-50 items-center" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
            {pendingPlayers.slice(0, 4).map(p => (
              <span key={p.id} className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary shrink-0 font-medium">
                {initials(p.preferredName)}
              </span>
            ))}
            {pendingPlayers.length > 4 && (
              <span className="text-xs text-muted-foreground shrink-0">+{pendingPlayers.length - 4} more</span>
            )}
          </div>
          <button onClick={() => setPendingDeltas([])} className="flex-1 py-2.5 sm:py-3 border rounded text-sm font-medium">Discard</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 sm:py-3 bg-primary text-white rounded text-sm font-medium">
            {saving ? 'Saving...' : `Save (${pendingDeltas.length})`}
          </button>
        </div>
      )}
      {blocker.state === 'blocked' && (
        <ConfirmDialog
          title="Discard unsaved changes?"
          message="You have pending selection changes that will be lost."
          confirmLabel="Discard"
          cancelLabel="Stay"
          destructive
          onConfirm={() => blocker.proceed()}
          onCancel={() => blocker.reset()}
        />
      )}
    </div>
  );
}

tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    "moduleResolution": "Bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,

    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    },

    "jsx": "react-jsx",

    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,

    "types": ["vite/client", "node"]
  },
  "include": ["src"],
  "references": []
}

tests/abilityGroup.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeAbilityAssignment,
  emptyConfig,
  validateConfig,
  type AbilityAssignment,
} from '../worker/src/abilityGroup';
import type { AbilityGroupConfigMap } from '../src/generated/domainTypes';

describe('abilityGroup — computeAbilityAssignment', () => {
  const config: AbilityGroupConfigMap = { A: 5, B: 8, C: 12, D: 15, E: 15, F: 15, G: 10 };

  it('assigns rank 1 to group A', () => {
    const result = computeAbilityAssignment(1, 80, config);
    expect(result.abilityGroup).toBe('A');
    expect(result.abilityDisplay).toMatch(/^A/);
  });

  it('assigns last rank of group A correctly', () => {
    const result = computeAbilityAssignment(5, 80, config);
    expect(result.abilityGroup).toBe('A');
  });

  it('assigns first rank of group B correctly', () => {
    const result = computeAbilityAssignment(6, 80, config);
    expect(result.abilityGroup).toBe('B');
  });

  it('assigns sub-group "+" to top third, neutral to middle, "-" to bottom', () => {
    // Group A with 5 players: 5/3 → k=1, r=2 → plus=2, neutral=2, minus=1
    const a1 = computeAbilityAssignment(1, 80, config);
    const a2 = computeAbilityAssignment(2, 80, config);
    const a3 = computeAbilityAssignment(3, 80, config);
    const a4 = computeAbilityAssignment(4, 80, config);
    const a5 = computeAbilityAssignment(5, 80, config);

    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('plus');
    expect(a3.abilitySubGroup).toBe('neutral');
    expect(a4.abilitySubGroup).toBe('neutral');
    expect(a5.abilitySubGroup).toBe('minus');
  });

  it('residual players fall into group H', () => {
    // A:3 fills 1-3, remaining 7 go to H
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(5, 10, cfg);
    expect(result.abilityGroup).toBe('H');
  });

  it('group H display uses "-" suffix for bottom sub-group', () => {
    // A:3 fills 1-3, H has players 4-10 (7 players). Bottom 3rd gets "-"
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    // k=2, r=1 → plus=2, neutral=3, minus=2. Offset 5 (rank 9-4=5) >= 2+3=5 → minus
    const result = computeAbilityAssignment(9, 10, cfg);
    expect(result.abilityDisplay).toBe('H-');
  });

  it('group H display uses "+" suffix for top sub-group', () => {
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    // k=2, r=1 → plus=2, neutral=3, minus=2. Rank 4-3=1 offset < 2 → plus
    const result = computeAbilityAssignment(4, 10, cfg);
    expect(result.abilityDisplay).toBe('H+');
  });

  it('handles config with all zero groups (all residual H)', () => {
    const empty = emptyConfig();
    const result = computeAbilityAssignment(1, 20, empty);
    expect(result.abilityGroup).toBe('H');
  });

  it('handles out-of-range rank gracefully', () => {
    const result = computeAbilityAssignment(999, 80, config);
    expect(result.abilityGroup).toBe('H');
  });

  it('sub-group algorithm: r=0 case (divisible by 3)', () => {
    // Group of 3: k=1, r=0 → plus=1, neutral=1, minus=1
    const cfg: AbilityGroupConfigMap = { A: 3, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const a1 = computeAbilityAssignment(1, 3, cfg);
    const a2 = computeAbilityAssignment(2, 3, cfg);
    const a3 = computeAbilityAssignment(3, 3, cfg);
    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('neutral');
    expect(a3.abilitySubGroup).toBe('minus');
  });

  it('sub-group algorithm: r=2 case', () => {
    // Group of 5: k=1, r=2 → plus=2, neutral=2, minus=1
    const cfg: AbilityGroupConfigMap = { A: 5, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const a1 = computeAbilityAssignment(1, 5, cfg);
    const a2 = computeAbilityAssignment(2, 5, cfg);
    const a3 = computeAbilityAssignment(3, 5, cfg);
    const a4 = computeAbilityAssignment(4, 5, cfg);
    const a5 = computeAbilityAssignment(5, 5, cfg);
    expect(a1.abilitySubGroup).toBe('plus');
    expect(a2.abilitySubGroup).toBe('plus');
    expect(a3.abilitySubGroup).toBe('neutral');
    expect(a4.abilitySubGroup).toBe('neutral');
    expect(a5.abilitySubGroup).toBe('minus');
  });

  it('single-player group gets neutral (no suffix)', () => {
    const cfg: AbilityGroupConfigMap = { A: 1, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const result = computeAbilityAssignment(1, 2, cfg);
    // k=0, r=1 → plus=0, neutral=1, minus=0 → neutral gets no suffix
    expect(result.abilityDisplay).toBe('A');
  });

  it('display reflects neutral sub-group with no suffix', () => {
    const cfg: AbilityGroupConfigMap = { A: 2, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    // k=0, r=2 → plus=1, neutral=1, minus=0
    const r1 = computeAbilityAssignment(1, 2, cfg);
    const r2 = computeAbilityAssignment(2, 2, cfg);
    expect(r1.abilityDisplay).toBe('A+');
    expect(r2.abilityDisplay).toBe('A');
  });
});

describe('abilityGroup — emptyConfig', () => {
  it('returns all zeros', () => {
    const cfg = emptyConfig();
    expect(cfg.A).toBe(0);
    expect(cfg.B).toBe(0);
    expect(cfg.C).toBe(0);
    expect(cfg.D).toBe(0);
    expect(cfg.E).toBe(0);
    expect(cfg.F).toBe(0);
    expect(cfg.G).toBe(0);
  });
});

describe('abilityGroup — validateConfig', () => {
  it('accepts valid config within active count', () => {
    const cfg: AbilityGroupConfigMap = { A: 10, B: 10, C: 0, D: 0, E: 0, F: 0, G: 0 };
    expect(validateConfig(cfg, 25)).toBeNull();
    expect(validateConfig(cfg, 20)).toBeNull();
  });

  it('rejects config exceeding active count', () => {
    const cfg: AbilityGroupConfigMap = { A: 15, B: 10, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 20);
    expect(err).not.toBeNull();
    expect(err).toContain('exceeds');
  });

  it('rejects negative capacity', () => {
    const cfg: AbilityGroupConfigMap = { A: -1, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 10);
    expect(err).not.toBeNull();
    expect(err).toContain('non-negative');
  });

  it('rejects non-integer capacity', () => {
    const cfg: AbilityGroupConfigMap = { A: 3.5, B: 0, C: 0, D: 0, E: 0, F: 0, G: 0 };
    const err = validateConfig(cfg, 10);
    expect(err).not.toBeNull();
    expect(err).toContain('non-negative integer');
  });
});


tests/abilityRank.test.ts
import { describe, it, expect } from 'vitest';
import { ABILITY_RANK } from '../worker/src/abilityRank';

describe('ABILITY_RANK', () => {
  it('ranks A+ highest and H- lowest', () => {
    expect(ABILITY_RANK['A+']).toBe(24);
    expect(ABILITY_RANK['H-']).toBe(1);
  });

  it('maintains monotonic descending order from A+ to H-', () => {
    const entries = Object.entries(ABILITY_RANK).sort(([, a], [, b]) => b - a);
    const expectedOrder = [
      'A+', 'A', 'A-', 'B+', 'B', 'B-',
      'C+', 'C', 'C-', 'D+', 'D', 'D-',
      'E+', 'E', 'E-', 'F+', 'F', 'F-',
      'G+', 'G', 'G-', 'H+', 'H', 'H-',
    ];
    expect(entries.map(([k]) => k)).toEqual(expectedOrder);
  });

  it('ranks A above B (same tier, different groups)', () => {
    expect(ABILITY_RANK['A']).toBeGreaterThan(ABILITY_RANK['B']);
  });

  it('ranks C+ above C and C (intra-group +/neutral/-)', () => {
    expect(ABILITY_RANK['C+']).toBeGreaterThan(ABILITY_RANK['C']);
    expect(ABILITY_RANK['C']).toBeGreaterThan(ABILITY_RANK['C-']);
  });

  it('ranks B- above C+ (higher group beats lower group)', () => {
    expect(ABILITY_RANK['B-']).toBeGreaterThan(ABILITY_RANK['C+']);
  });

  it('has exactly 24 entries (A–H × 3 sub-groups)', () => {
    expect(Object.keys(ABILITY_RANK)).toHaveLength(24);
  });

  it('all values are positive integers', () => {
    for (const v of Object.values(ABILITY_RANK)) {
      expect(v).toBeGreaterThan(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});

tests/dateUtils.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeFormat, isPastFixture } from '../src/lib/dateUtils';

describe('dateUtils — safeFormat', () => {
  it('formats a valid ISO date string', () => {
    expect(safeFormat('2026-08-07T14:00:00', 'yyyy-MM-dd')).toBe('2026-08-07');
    expect(safeFormat('2026-08-07T14:00:00', 'EEE d MMM yyyy')).toBe('Fri 7 Aug 2026');
  });

  it('formats time portion', () => {
    expect(safeFormat('2026-08-07T14:30:00', 'HH:mm')).toBe('14:30');
  });

  it('returns fallback for undefined', () => {
    expect(safeFormat(undefined, 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for null', () => {
    expect(safeFormat(null, 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for empty string', () => {
    expect(safeFormat('', 'yyyy-MM-dd')).toBe('—');
  });

  it('returns fallback for invalid date', () => {
    expect(safeFormat('not-a-date', 'yyyy-MM-dd')).toBe('—');
  });

  it('returns custom fallback when provided', () => {
    expect(safeFormat(undefined, 'HH:mm', 'TBD')).toBe('TBD');
  });

  it('handles date-only ISO strings', () => {
    expect(safeFormat('2026-08-07', 'yyyy-MM-dd')).toBe('2026-08-07');
  });
});

describe('dateUtils — isPastFixture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a date in the past', () => {
    expect(isPastFixture('2026-08-06T19:00:00')).toBe(true);
  });

  it('returns false for today (same date)', () => {
    // Set to noon, fixture at midnight — today is same calendar day
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(isPastFixture('2026-08-07T19:00:00')).toBe(false);
  });

  it('returns false for a future date', () => {
    expect(isPastFixture('2026-08-08T19:00:00')).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPastFixture(undefined as unknown as string)).toBe(false);
  });

  it('returns false for an invalid date string', () => {
    expect(isPastFixture('bogus')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isPastFixture('')).toBe(false);
  });

  it('returns true for yesterday at any hour', () => {
    vi.setSystemTime(new Date('2026-08-07T00:05:00Z'));
    expect(isPastFixture('2026-08-06T23:59:00')).toBe(true);
  });

  it('handles dates in different format that parse correctly', () => {
    // Yesterday
    vi.setSystemTime(new Date('2026-08-07T12:00:00Z'));
    expect(isPastFixture('2026-08-06')).toBe(true);
    // Tomorrow
    expect(isPastFixture('2026-08-09')).toBe(false);
  });
});
