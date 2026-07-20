import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams, useBlocker } from 'react-router-dom';
import { usePlayersForMatch, useAvailabilityPoll } from '@/lib/queries';
import { toast } from 'sonner';
import { ArrowLeft } from 'lucide-react';
import { apiPost } from '../lib/apiClient';
import MatchHeader from '@/components/MatchHeader';
import PlayerFilters, { filtersToParams, paramsToFilters, type FilterState } from '@/components/PlayerFilters';
import RecommendationsPanel from '@/components/RecommendationsPanel';
import PlayerRow from '@/components/PlayerRow';
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
      // Selected players always at top
      const aSelected = a.selectionStatus === 'Selected' ? 1 : 0;
      const bSelected = b.selectionStatus === 'Selected' ? 1 : 0;
      if (aSelected !== bSelected) return bSelected - aSelected;
      // Then by ability rank descending
      const abilityDiff = (ABILITY_RANK[b.playingAbility] ?? 0) - (ABILITY_RANK[a.playingAbility] ?? 0);
      if (abilityDiff !== 0) return abilityDiff;
      // Tiebreak: alphabetical
      return a.preferredName.localeCompare(b.preferredName);
    });
  }, [filteredPlayers]);

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
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
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

      {/* Player list — sorted: Selected first, then by Ability */}
      <div className="container mx-auto px-4">
        {sortedPlayers.map(p => (
          <PlayerRow
            key={p.id}
            player={p}
            selected={p.selectionStatus === 'Selected'}
            onToggleSelection={() => handleToggleSelection(p.id)}
          />
        ))}
      </div>

      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex gap-3 z-50 items-center">
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
          <button onClick={() => setPendingDeltas([])} className="flex-1 py-3 border rounded text-sm font-medium">Discard</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-primary text-white rounded text-sm font-medium">
            {saving ? 'Saving...' : `Save (${pendingDeltas.length})`}
          </button>
        </div>
      )}

      {blocker.state === 'blocked' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40">
          <div className="bg-background rounded-lg p-4 max-w-sm mx-4 shadow-lg">
            <p className="text-foreground font-medium mb-2">Discard unsaved changes?</p>
            <p className="text-sm text-muted-foreground mb-4">You have pending selection changes that will be lost.</p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => blocker.reset()} className="px-3 py-2 rounded border border-border text-sm font-medium">Stay</button>
              <button onClick={() => blocker.proceed()} className="px-3 py-2 rounded bg-destructive text-destructive-foreground text-sm font-medium">Discard</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}