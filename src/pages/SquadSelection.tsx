import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { usePlayersForMatch, useAvailabilityPoll } from '@/lib/queries';
import { toast } from 'sonner';
import { ArrowLeft, Save, X, CheckSquare, Square } from 'lucide-react';
import { apiPost } from '../lib/apiClient';
import MatchHeader from '@/components/MatchHeader';
import PlayerFilters, { filtersToParams, paramsToFilters, type FilterState } from '@/components/PlayerFilters';
import PlayerRow from '@/components/PlayerRow';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/useAuth';

type Delta = { playerId: string; action: 'select' | 'remove' };

const POS_SHORT: Record<string, string> = {
  Defender: 'DEF', Midfielder: 'MID', Forward: 'FWD', Goalkeeper: 'GK', 'Flexible/Varies': 'FLEX',
};

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = usePlayersForMatch(matchId!);
  const { data: pollData } = useAvailabilityPoll(matchId!, true);

  const [pendingDeltas, setPendingDeltas] = useState<Delta[]>([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FilterState>(() => paramsToFilters(window.location.search));
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // ✅ Hooks called at top level
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    setHasChanges(pendingDeltas.length > 0);
  }, [pendingDeltas]);

  const handleFilterChange = useCallback((f: FilterState) => {
    setFilters(f);
    const params = filtersToParams(f);
    setSearchParams(params ? params : {}, { replace: true });
  }, [setSearchParams]);

  const mergedPlayers = useMemo(() => {
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
      if (p) {
        p.selectionStatus = delta.action === 'select' ? 'Selected' : '';
      }
    }
    return Array.from(map.values());
  }, [data, pollData, pendingDeltas]);

  const filteredPlayers = useMemo(() => {
    return mergedPlayers.filter(p => {
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

  const optimisticMatch = useMemo(() => {
    if (!data?.match) return null;
    let selectedCount = mergedPlayers.filter(p => p.selectionStatus === 'Selected').length;
    return { ...data.match, selectedCount };
  }, [data?.match, mergedPlayers]);

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

    const newDeltas: Delta[] = filteredPlayers
      .filter(p => p.eligibilityStatus !== 'blocked')
      .map(p => ({ 
        playerId: p.id, 
        action 
      }));

    updateDeltas(newDeltas);
  };

  const handleSave = async () => {
      if (!hasChanges) return;
      setSaving(true);
      try {
        const selectedIds = mergedPlayers.filter(p => p.selectionStatus === 'Selected').map(p => p.id);
        
        // 1. Send the save request to the backend
        await apiPost('/squad/sync', { 
          matchId, 
          selectedIds,
          actingEmail: user?.email 
        });

        // 2. Optimistically update the React Query cache so the UI doesn't "snap back"
        queryClient.setQueryData(['playersForMatch', matchId], (old: any) => {
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
        
        // 3. Clear local pending changes (the UI now relies on the instantly updated cache)
        setPendingDeltas([]);
        setHasChanges(false);
        
        // 4. Trigger a background refetch to ensure perfect sync across the app
        queryClient.invalidateQueries({ queryKey: ['playersForMatch', matchId] });
        queryClient.invalidateQueries({ queryKey: ['upcomingFixtures'] });
        
      } catch (e: any) {
        toast.error(e?.message || 'Failed to sync squad');
      } finally {
        setSaving(false);
      }
    };

  const actualChanges = useMemo(() => {
    return pendingDeltas.filter(delta => {
      const serverPlayer = data?.players.find(p => p.id === delta.playerId);
      const serverIsSelected = serverPlayer?.selectionStatus === 'Selected';
      const pendingIsSelected = delta.action === 'select';
      return serverIsSelected !== pendingIsSelected;
    });
  }, [pendingDeltas, data?.players]);

  if (isLoading) return <div className="p-6">Loading squad...</div>;
  if (isError) return <div className="p-6 text-destructive">Failed to load players: {(error as any)?.message || "Unknown error"}</div>;
  if (!data || !optimisticMatch) return <div className="p-6 text-destructive">No match data available</div>;

  return (
    <div className="pb-24">
      <div className="container mx-auto px-4">
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Fixtures
        </button>
      </div>

      <MatchHeader match={optimisticMatch} />
      
      <PlayerFilters filters={filters} onChange={handleFilterChange} />

      <div className="container mx-auto py-2 px-4.5 mb-1 flex items-center gap-3">
        <input
          type="checkbox"
          id="toggle-all"
          className="h-4 w-4 accent-primary"
          checked={
            filteredPlayers.length > 0 && 
            filteredPlayers
              .filter(p => p.eligibilityStatus !== 'blocked')
              .every(p => p.selectionStatus === 'Selected')
          }
          onChange={handleToggleAllVisible}
        />
        <label htmlFor="toggle-all" className="text-sm font-medium text-muted-foreground cursor-pointer">
          Select All
        </label>
      </div>

      <div className="container mx-auto px-4">
        {filteredPlayers.map(p => (
          <PlayerRow
            key={p.id}
            player={p}
            selected={p.selectionStatus === 'Selected'}
            onToggleSelection={() => handleToggleSelection(p.id)}
          />
        ))}
      </div>

      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex gap-3 z-50">
          <button onClick={() => setPendingDeltas([])} className="flex-1 py-3 border rounded">Discard</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 py-3 bg-primary text-white rounded">
            {saving ? 'Saving...' : `Save (${actualChanges.length} changes)`}
          </button>
        </div>
      )}
    </div>
  );
}