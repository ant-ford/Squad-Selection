import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router-dom';
import { usePlayersForMatch, useAvailabilityPoll } from '@/lib/queries';
import { toast } from 'sonner';
import { ArrowLeft, Wand2, X, Settings2, Search, Plus, Trash2 } from 'lucide-react';
import { apiPost, apiGet } from '../lib/apiClient';
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

interface PriorityPlayer {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
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

  // ── Auto-Select state ────────────────────────────────────────────────
  const [autoSelectEnabled, setAutoSelectEnabled] = useState<boolean>(false);
  const [autoSelectPending, setAutoSelectPending] = useState(false);
  const [suppressedPlayerIds, setSuppressedPlayerIds] = useState<Set<string>>(new Set());
  const [hasRunAutoSelect, setHasRunAutoSelect] = useState(false);
  const [priorityPlayers, setPriorityPlayers] = useState<PriorityPlayer[]>([]);
  const [showPriorityManager, setShowPriorityManager] = useState(false);
  const [prioritySearch, setPrioritySearch] = useState('');
  const [savingPriority, setSavingPriority] = useState(false);

  const priorityPlayerIds = useMemo(
    () => new Set(data?.match?.autoSelectPlayerIds || []),
    [data?.match?.autoSelectPlayerIds]
  );

  // Initialise auto-select from server
  useEffect(() => {
    if (data?.match?.autoSelectEnabled !== undefined) {
      setAutoSelectEnabled(data.match.autoSelectEnabled);
    }
  }, [data?.match?.autoSelectEnabled]);

  // ── Auto-selection: only priority players, if eligible & available ──
  useEffect(() => {
    if (!autoSelectEnabled || !data?.players || data.players.length === 0) return;
    if (!hasRunAutoSelect) {
      applyAutoSelect(data.players);
      setHasRunAutoSelect(true);
    }
  }, [autoSelectEnabled, data?.players, hasRunAutoSelect]);

  useEffect(() => {
    if (!autoSelectEnabled || !pollData?.exceptions || pollData.exceptions.length === 0) return;
    if (!data?.players) return;
    applyAutoSelect(data.players);
  }, [pollData?.exceptions, autoSelectEnabled]);

  const applyAutoSelect = useCallback((players: MatchPlayer[]) => {
    if (priorityPlayerIds.size === 0) return;

    const autoIds = players
      .filter(p =>
        priorityPlayerIds.has(p.id) &&
        (p.eligibilityStatus === 'eligible' || p.eligibilityStatus === 'warning') &&
        p.availabilityStatus === 'Available' &&
        p.selectionStatus !== 'Selected' &&
        !suppressedPlayerIds.has(p.id)
      )
      .map(p => p.id);

    if (autoIds.length === 0) return;

    setPendingDeltas(prev => {
      const existingIds = new Set(prev.map(d => d.playerId));
      const newDeltas: Delta[] = [];
      for (const id of autoIds) {
        if (!existingIds.has(id)) {
          newDeltas.push({ playerId: id, action: 'select' });
        }
      }
      return [...prev, ...newDeltas];
    });
  }, [priorityPlayerIds, suppressedPlayerIds]);

  // ── Player toggle: track suppression for priority players ──
  const handleToggleSelection = (playerId: string) => {
    const player = mergedPlayers.find(p => p.id === playerId);
    if (!player || player.eligibilityStatus === 'blocked') return;

    const serverStatus = data?.players.find(p => p.id === playerId)?.selectionStatus === 'Selected';
    const isCurrentlySelected = player.selectionStatus === 'Selected';
    const nextAction: Delta['action'] = isCurrentlySelected ? 'remove' : 'select';

    // Suppress priority players when coach unselects them while auto-select is on
    if (nextAction === 'remove' && autoSelectEnabled && priorityPlayerIds.has(playerId)) {
      setSuppressedPlayerIds(prev => new Set([...prev, playerId]));
    }
    if (nextAction === 'select' && suppressedPlayerIds.has(playerId)) {
      setSuppressedPlayerIds(prev => {
        const next = new Set(prev);
        next.delete(playerId);
        return next;
      });
    }

    const serverMatchesIntended = (nextAction === 'select' && serverStatus) || (nextAction === 'remove' && !serverStatus);
    if (serverMatchesIntended) {
      setPendingDeltas(prev => prev.filter(d => d.playerId !== playerId));
    } else {
      updateDeltas([{ playerId, action: nextAction }]);
    }
  };

  // ── Auto-select toggle ────────────────────────────────────────────────
  const handleToggleAutoSelect = async (enabled: boolean) => {
    setAutoSelectEnabled(enabled);
    setAutoSelectPending(true);

    if (enabled) {
      setSuppressedPlayerIds(new Set());
      setHasRunAutoSelect(false);

      if (data?.players && priorityPlayerIds.size > 0) {
        const autoIds = data.players
          .filter(p =>
            priorityPlayerIds.has(p.id) &&
            (p.eligibilityStatus === 'eligible' || p.eligibilityStatus === 'warning') &&
            p.availabilityStatus === 'Available' &&
            p.selectionStatus !== 'Selected'
          )
          .map(p => p.id);

        if (autoIds.length > 0) {
          setPendingDeltas(prev => {
            const existingIds = new Set(prev.map(d => d.playerId));
            const newDeltas: Delta[] = autoIds
              .filter(id => !existingIds.has(id))
              .map(id => ({ playerId: id, action: 'select' as const }));
            return [...prev, ...newDeltas];
          });
        }
        setHasRunAutoSelect(true);
      }
    }

    try {
      await apiPost(`/api/match/${matchId}/auto-select`, {
        enabled,
        actingEmail: user?.email,
      });
    } catch (e: any) {
      toast.error('Failed to save auto-select setting');
    } finally {
      setAutoSelectPending(false);
    }
  };

  // ── Priority player management ────────────────────────────────────────
  const loadPriorityPlayers = useCallback(async () => {
    if (!data?.match?.hkfcTeam) return;
    try {
      const result = await apiGet<{ players: PriorityPlayer[] }>(
        `/api/team/auto-select-players?team=${encodeURIComponent(data.match.hkfcTeam)}`
      );
      setPriorityPlayers(result.players || []);
    } catch {
      // Silently fail — management panel just shows empty
    }
  }, [data?.match?.hkfcTeam]);

  useEffect(() => {
    if (showPriorityManager) loadPriorityPlayers();
  }, [showPriorityManager, loadPriorityPlayers]);

  const handleSavePriority = async () => {
    if (!data?.match?.hkfcTeam) return;
    setSavingPriority(true);
    try {
      const ids = priorityPlayers.map(p => p.id);
      await apiPost('/api/team/auto-select-players', {
        teamName: data.match.hkfcTeam,
        playerIds: ids,
        actingEmail: user?.email,
      });
      // Refresh match info to get updated autoSelectPlayerIds
      queryClient.invalidateQueries({ queryKey: ['playersForMatch', matchId, side] });
      toast.success(`Priority list saved (${ids.length} players)`);
      setShowPriorityManager(false);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save priority list');
    } finally {
      setSavingPriority(false);
    }
  };

  const handleAddPriority = (playerId: string, playerName: string, playerTeam: string, position: string, ability: string) => {
    if (priorityPlayers.some(p => p.id === playerId)) return;
    setPriorityPlayers(prev => [...prev, { id: playerId, preferredName: playerName, registeredTeam: playerTeam, playingPosition: position, playingAbility: ability }]);
  };

  const handleRemovePriority = (playerId: string) => {
    setPriorityPlayers(prev => prev.filter(p => p.id !== playerId));
  };

  // Which players can be added to the priority list (eligible/warning, not already in list)
  const addablePlayers = useMemo(() => {
    if (!data?.players) return [];
    const existingIds = new Set(priorityPlayers.map(p => p.id));
    const search = prioritySearch.trim().toLowerCase();
    return data.players
      .filter(p =>
        (p.eligibilityStatus === 'eligible' || p.eligibilityStatus === 'warning') &&
        !existingIds.has(p.id) &&
        (!search || p.preferredName.toLowerCase().includes(search))
      )
      .sort((a, b) => a.preferredName.localeCompare(b.preferredName));
  }, [data?.players, priorityPlayers, prioritySearch]);

  useEffect(() => {
    setHasChanges(pendingDeltas.length > 0);
  }, [pendingDeltas]);

  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

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

  // Count of priority players that are currently auto-selected
  const autoSelectedCount = useMemo(() => {
    if (!autoSelectEnabled || priorityPlayerIds.size === 0) return null;
    return mergedPlayers.filter(p =>
      p.selectionStatus === 'Selected' &&
      priorityPlayerIds.has(p.id) &&
      !suppressedPlayerIds.has(p.id)
    ).length;
  }, [autoSelectEnabled, mergedPlayers, priorityPlayerIds, suppressedPlayerIds]);

  const updateDeltas = (newDeltas: Delta[]) => {
    setPendingDeltas(prev => {
      const playerIdsToUpdate = new Set(newDeltas.map(d => d.playerId));
      return [...prev.filter(d => !playerIdsToUpdate.has(d.playerId)), ...newDeltas];
    });
  };

  const handleToggleAllVisible = () => {
    const eligiblePlayers = filteredPlayers.filter(p => p.eligibilityStatus !== 'blocked');
    const allSelected = eligiblePlayers.every(p => p.selectionStatus === 'Selected');
    const action: Delta['action'] = allSelected ? 'remove' : 'select';

    if (action === 'remove' && autoSelectEnabled) {
      const affectedIds = new Set(eligiblePlayers.filter(p => priorityPlayerIds.has(p.id)).map(p => p.id));
      if (affectedIds.size > 0) {
        setSuppressedPlayerIds(prev => new Set([...prev, ...affectedIds]));
      }
    }
    if (action === 'select') {
      setSuppressedPlayerIds(prev => {
        const next = new Set(prev);
        for (const p of eligiblePlayers) next.delete(p.id);
        return next;
      });
    }

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
      setSuppressedPlayerIds(new Set());
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

      {/* ── Selection Controls ─────────────────────────────────── */}
      <div className="container mx-auto py-2 px-4 flex flex-wrap items-center gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="toggle-all"
            className="h-4 w-4 accent-primary"
            checked={filteredPlayers.length > 0 && filteredPlayers.filter(p => p.eligibilityStatus !== 'blocked').every(p => p.selectionStatus === 'Selected')}
            onChange={handleToggleAllVisible}
          />
          <label htmlFor="toggle-all" className="text-sm font-medium text-muted-foreground cursor-pointer select-none">Select All</label>
        </div>

        <div className="w-px h-5 bg-border/50 hidden sm:block" />

        {/* Auto-Select Toggle */}
        <button
          onClick={() => handleToggleAutoSelect(!autoSelectEnabled)}
          disabled={autoSelectPending}
          className={`
            inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium
            transition-all duration-150 border select-none
            ${autoSelectEnabled
              ? 'bg-primary/10 text-primary border-primary/30 hover:bg-primary/15'
              : 'bg-muted text-muted-foreground border-border hover:bg-muted/80'
            }
            ${autoSelectPending ? 'opacity-60' : ''}
          `}
        >
          <Wand2 className={`h-3.5 w-3.5 ${autoSelectEnabled ? 'text-primary' : ''}`} />
          <span>Auto-Select</span>
          <span className={`
            inline-flex items-center justify-center w-7 h-4 rounded-full transition-colors duration-150
            ${autoSelectEnabled ? 'bg-primary' : 'bg-border'}
          `}>
            <span className={`
              inline-block w-3 h-3 rounded-full bg-white transition-transform duration-150
              ${autoSelectEnabled ? 'translate-x-1.5' : '-translate-x-1.5'}
            `} />
          </span>
        </button>

        {autoSelectEnabled && (
          <>
            {autoSelectedCount !== null && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {autoSelectedCount}/{priorityPlayerIds.size} auto-selected
              </span>
            )}
            <button
              onClick={() => setShowPriorityManager(prev => !prev)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Edit priority player list"
            >
              <Settings2 className="h-3 w-3" />
              {priorityPlayerIds.size === 0 ? 'Add priority players' : `${priorityPlayerIds.size} priority`}
            </button>
          </>
        )}

        {autoSelectEnabled && suppressedPlayerIds.size > 0 && (
          <button
            onClick={() => { setSuppressedPlayerIds(new Set()); setHasRunAutoSelect(false); }}
            className="text-xs text-muted-foreground underline hover:text-foreground"
          >
            <X className="inline h-3 w-3 mr-0.5" />
            {suppressedPlayerIds.size} excluded — rescan
          </button>
        )}
      </div>

      {/* ── Priority Player Manager ─────────────────────────────── */}
      {showPriorityManager && (
        <div className="container mx-auto px-4 py-3 border-b border-border/50 bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-primary" />
              Auto-Select Priority Players
            </h3>
            <button
              onClick={() => setShowPriorityManager(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            These players will be automatically selected for any {data.match.hkfcTeam} fixture if they are eligible and available.
          </p>

          {/* Current priority players */}
          {priorityPlayers.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {priorityPlayers.map(p => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium"
                >
                  {p.preferredName}
                  <button onClick={() => handleRemovePriority(p.id)} className="hover:text-destructive ml-0.5">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic mb-3">No priority players added yet. Search below to add your captain, goalkeeper, and key players.</p>
          )}

          {/* Search & add */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search players by name..."
              value={prioritySearch}
              onChange={e => setPrioritySearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {prioritySearch.trim() && (
            <div className="max-h-40 overflow-y-auto border rounded-md bg-background mb-3">
              {addablePlayers.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">No matching players found.</p>
              ) : (
                addablePlayers.slice(0, 12).map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleAddPriority(p.id, p.preferredName, p.registeredTeam, p.playingPosition, p.playingAbility)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-muted text-left text-xs border-b last:border-b-0 transition-colors"
                  >
                    <Plus className="h-3 w-3 text-primary shrink-0" />
                    <span className="font-medium">{p.preferredName}</span>
                    <span className="text-muted-foreground">{p.playingPosition}</span>
                    <span className="text-muted-foreground ml-auto">{p.playingAbility}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <button
            onClick={handleSavePriority}
            disabled={savingPriority}
            className="w-full py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {savingPriority ? 'Saving...' : `Save Priority List (${priorityPlayers.length} players)`}
          </button>
        </div>
      )}

      {/* Player list — virtualized */}
      <div ref={listRef} className="container mx-auto px-4 max-h-[60vh] overflow-y-auto">
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
