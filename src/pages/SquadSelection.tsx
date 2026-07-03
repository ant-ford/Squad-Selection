import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { getPlayersForMatch, GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeft } from 'lucide-react';
import MatchHeader from '@/components/MatchHeader';
import PlayerRow from '@/components/PlayerRow';
import BulkActionBar from '@/components/BulkActionBar';
import PlayerFilters from '@/components/PlayerFilters';

type Player = GetPlayersForMatchOutput['players'][0];
type MatchInfo = GetPlayersForMatchOutput['match'];

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const navigate = useNavigate();
  const [match, setMatch] = useState<MatchInfo | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(() => {
    if (!matchId) return;
    setLoading(true);
    getPlayersForMatch(matchId)
      .then(data => {
        setMatch(data.match);
        setPlayers(data.players);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [matchId]);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredPlayers = players.filter(p => {
    if (filter === 'eligible') return p.eligibilityStatus !== 'blocked';
    if (filter === 'selected') return !!p.selectionStatus;
    if (filter === 'DEF' || filter === 'MID' || filter === 'FWD' || filter === 'GK') {
      const posMap: Record<string, string> = { DEF: 'Defender', MID: 'Midfielder', FWD: 'Forward', GK: 'Goalkeeper' };
      return p.playingPosition === posMap[filter];
    }
    return true;
  });

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-4 space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-12 w-full" />
        {[1,2,3,4,5].map(i => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  return (
    <div className="pb-20">
      <div className="container mx-auto px-4">
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 py-3 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Fixtures
        </button>
      </div>

      {match && <MatchHeader match={match} />}

      <PlayerFilters active={filter} onFilter={setFilter} />

      <div className="container mx-auto px-4">
        {filteredPlayers.map(p => (
          <PlayerRow
            key={p.id}
            player={p}
            matchId={matchId!}
            checked={checkedIds.has(p.id)}
            onToggleCheck={() => toggleCheck(p.id)}
            onRefresh={loadData}
          />
        ))}
        {filteredPlayers.length === 0 && (
          <p className="text-center text-muted-foreground py-8">No players match this filter</p>
        )}
      </div>

      {checkedIds.size > 0 && (
        <BulkActionBar
          count={checkedIds.size}
          playerIds={[...checkedIds]}
          matchId={matchId!}
          onDone={() => { setCheckedIds(new Set()); loadData(); }}
        />
      )}
    </div>
  );
}
