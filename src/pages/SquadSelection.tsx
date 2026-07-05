import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { usePlayersForMatch, useAvailabilityPoll, useBatchUpdateSquad } from '@/lib/queries';
import { toast } from 'sonner';
import { ArrowLeft, Save, X } from 'lucide-react';
import MatchHeader from '@/components/MatchHeader';
import PlayerFilters from '@/components/PlayerFilters';
import PlayerRow from '@/components/PlayerRow';
import BulkActionBar from '@/components/BulkActionBar';

type Delta = { playerId: string; action: 'select' | 'reserve' | 'remove' };

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();

  const { data, isLoading } = usePlayersForMatch(matchId!);
  const { data: pollData } = useAvailabilityPoll(matchId!, true);
  const batchMutation = useBatchUpdateSquad(matchId!);

  const [pendingDeltas, setPendingDeltas] = useState<Delta[]>([]);
  const [filter, setFilter] = useState('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  // Merge Server State + Polling State + Local Optimistic State
  const mergedPlayers = useMemo(() => {
    if (!data?.players) return [];
    
    const map = new Map(data.players.map(p => [p.id, { ...p }]));

    // 1. Apply live availability polling updates
    if (pollData?.exceptions) {
      for (const exc of pollData.exceptions) {
        const p = map.get(exc.playerId);
        if (p) {
          p.availabilityStatus = exc.status;
          p.playerNotes = exc.notes || '';
        }
      }
    }

    // 2. Apply pending local selection deltas
    for (const delta of pendingDeltas) {
      const p = map.get(delta.playerId);
      if (p) {
        if (delta.action === 'remove') {
          p.selectionStatus = '';
          p.selectionId = '';
        } else {
          p.selectionStatus = delta.action === 'select' ? 'Selected' : 'Reserve';
          p.selectionId = 'pending';
        }
      }
    }

    return Array.from(map.values());
  }, [data, pollData, pendingDeltas]);

  // Calculate optimistic match header stats
  const optimisticMatch = useMemo(() => {
    if (!data?.match) return null;
    const m = { ...data.match };
    
    let selected = m.selectedCount;
    let reserve = m.reserveCount;
    
    for (const delta of pendingDeltas) {
      const serverPlayer = data.players.find(p => p.id === delta.playerId);
      const prevStatus = serverPlayer?.selectionStatus || '';
      
      if (prevStatus === 'Selected') selected--;
      if (prevStatus === 'Reserve') reserve--;
      
      if (delta.action === 'select') selected++;
      if (delta.action === 'reserve') reserve++;
    }
    
    return { ...m, selectedCount: selected, reserveCount: reserve };
  }, [data?.match, pendingDeltas, data?.players]);

  const hasChanges = pendingDeltas.length > 0;

  // Handle individual player taps (100% local, 0 API calls)
  const handleToggleSelection = (playerId: string) => {
    setPendingDeltas(prev => {
      const current = mergedPlayers.find(p => p.id === playerId);
      if (!current || current.eligibilityStatus === 'blocked') return prev;

      const effectiveStatus = current.selectionStatus;
      let nextAction: Delta['action'];

      if (!effectiveStatus) nextAction = 'select';
      else if (effectiveStatus === 'Selected') nextAction = 'reserve';
      else nextAction = 'remove';

      // Remove existing delta for this player to prevent duplicates
      const filtered = prev.filter(d => d.playerId !== playerId);
      
      // If removing, and they weren't selected on the server, just drop it
      if (nextAction === 'remove' && !data?.players.find(p => p.id === playerId)?.selectionStatus) {
        return filtered;
      }

      return [...filtered, { playerId, action: nextAction }];
    });
  };

  // Handle Save Button
  const handleSave = async () => {
    if (!hasChanges) return;
    
    try {
      const result = await batchMutation.mutateAsync(pendingDeltas);
      
      if (result.errors && result.errors.length > 0) {
        toast.error(`${result.errors.length} selection(s) rejected: ${result.errors[0].reason}`);
      } else {
        toast.success('Squad saved successfully');
        setPendingDeltas([]);
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save squad');
    }
  };

  const handleDiscard = () => setPendingDeltas([]);

  // Bulk actions update local state
  const handleBulkReserve = () => {
    const newDeltas: Delta[] = Array.from(checkedIds).map(id => ({ playerId: id, action: 'reserve' as const }));
    setPendingDeltas(prev => [...prev.filter(d => !checkedIds.has(d.playerId)), ...newDeltas]);
    setCheckedIds(new Set());
    toast.info(`${checkedIds.size} players marked as reserve (pending save)`);
  };

  const handleToggleCheck = (playerId: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  };

  // Filtering logic
  const filteredPlayers = useMemo(() => {
    if (filter === 'all') return mergedPlayers;
    if (filter === 'eligible') return mergedPlayers.filter(p => p.eligibilityStatus !== 'blocked');
    if (filter === 'selected') return mergedPlayers.filter(p => !!p.selectionStatus);
    const posMap: Record<string, string> = { DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', GK: 'Goalkeeper' };
    return mergedPlayers.filter(p => p.playingPosition === posMap[filter]);
  }, [mergedPlayers, filter]);

  if (isLoading || !data || !optimisticMatch) {
    return <div className="p-6">Loading squad...</div>;
  }

  return (
    <div className="pb-24">
      <div className="container mx-auto px-4">
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Fixtures
        </button>
      </div>

      <MatchHeader match={optimisticMatch} />
      <PlayerFilters active={filter} onFilter={setFilter} />

      <div className="container mx-auto px-4">
        {filteredPlayers.map(p => (
          <PlayerRow
            key={p.id}
            player={p}
            checked={checkedIds.has(p.id)}
            onToggleCheck={() => handleToggleCheck(p.id)}
            onToggleSelection={() => handleToggleSelection(p.id)}
          />
        ))}
      </div>

      {checkedIds.size > 0 && (
        <BulkActionBar
          count={checkedIds.size}
          playerIds={Array.from(checkedIds)}
          matchId={matchId!}
          onDone={() => setCheckedIds(new Set())}
          onBulkReserve={handleBulkReserve}
        />
      )}

      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex gap-3 z-50">
          <button onClick={handleDiscard} className="flex-1 py-3 border rounded flex items-center justify-center gap-2">
            <X className="h-4 w-4" /> Discard
          </button>
          <button 
            onClick={handleSave} 
            disabled={batchMutation.isPending}
            className="flex-1 py-3 bg-primary text-primary-foreground rounded flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> 
            {batchMutation.isPending ? 'Saving...' : `Save (${pendingDeltas.length})`}
          </button>
        </div>
      )}
    </div>
  );
}