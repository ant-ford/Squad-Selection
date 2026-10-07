import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Wand2, X, Search, Plus } from 'lucide-react';
import { apiPost, apiGet } from '@/lib/apiClient';
import type { MatchPlayer } from '@/api/getPlayersForMatch';

interface PriorityPlayer {
  id: string;
  preferredName: string;
  registeredTeam: string;
  playingPosition: string;
  playingAbility: string;
}

/**
 * Auto-select's priority list for a team, opened from the squad screen's
 * bar: the players auto-select picks whenever they are eligible and
 * available.
 */
export default function PriorityPlayersPanel({
  team,
  players,
  matchId,
  side,
  onClose,
}: {
  team: string | undefined;
  /** The squad screen's players, to add from. */
  players: MatchPlayer[];
  matchId: string | undefined;
  side: 'home' | 'away' | undefined;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [priorityPlayers, setPriorityPlayers] = useState<PriorityPlayer[]>([]);
  const [prioritySearch, setPrioritySearch] = useState('');
  const [savingPriority, setSavingPriority] = useState(false);

  const loadPriorityPlayers = useCallback(async () => {
    if (!team) return;
    try {
      const result = await apiGet<{ players: PriorityPlayer[] }>(
        `/api/team/auto-select-players?team=${encodeURIComponent(team)}`
      );
      setPriorityPlayers(result.players || []);
    } catch {
      // Silently fail
    }
  }, [team]);

  useEffect(() => {
    loadPriorityPlayers();
  }, [loadPriorityPlayers]);

  const handleSavePriority = async () => {
    if (!team) return;
    setSavingPriority(true);
    try {
      const ids = priorityPlayers.map(p => p.id);
      await apiPost('/api/team/auto-select-players', {
        teamName: team,
        playerIds: ids,
      });
      queryClient.invalidateQueries({ queryKey: ['playersForMatch', matchId, side] });
      toast.success(`Priority list saved (${ids.length} players)`);
      onClose();
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

  const addablePlayers = useMemo(() => {
    const existingIds = new Set(priorityPlayers.map(p => p.id));
    const search = prioritySearch.trim().toLowerCase();
    return players
      .filter(p =>
        (p.eligibilityStatus === 'eligible' || p.eligibilityStatus === 'warning') &&
        !existingIds.has(p.id) &&
        (!search || p.preferredName.toLowerCase().includes(search))
      )
      .sort((a, b) => a.preferredName.localeCompare(b.preferredName));
  }, [players, priorityPlayers, prioritySearch]);

  return (
    <div className="container mx-auto px-4 py-3 border-b border-border/50 bg-muted/30">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Wand2 className="h-4 w-4 text-primary" />
          Auto-select priority players
        </h3>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        These players will be automatically selected for any {team} fixture if they are eligible and available.
      </p>

      {priorityPlayers.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {priorityPlayers.map(p => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-primary-tint/10 text-primary font-medium"
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

      <div className="relative mb-2">
        <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search by name"
          value={prioritySearch}
          onChange={e => setPrioritySearch(e.target.value)}
          className="w-full pl-8 pr-3 h-10 text-base sm:text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
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
        {savingPriority ? 'Saving...' : `Save priority list (${priorityPlayers.length})`}
      </button>
    </div>
  );
}
