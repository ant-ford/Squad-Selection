import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useUnsavedChanges } from '@/lib/useUnsavedChanges';
import { usePlayersForMatch, useAvailabilityPoll, useRecommendations } from '@/lib/queries';
import { toast } from '@/lib/toast';
import { apiPost, ApiError } from '../lib/apiClient';
import MatchHeader from '@/components/MatchHeader';
import PlayerFilters, { DEFAULT_ELIGIBILITY, filtersToParams, isDefaultEligibility, paramsToFilters, type FilterState } from '@/components/PlayerFilters';
import { canToggleSelection } from '@/components/PlayerRow';
import NotifySquadSheet from '@/components/NotifySquadSheet';
import WhatsAppListSheet from '@/components/WhatsAppListSheet';
import SeasonStatsSheet from '@/components/SeasonStatsSheet';
import CoachAvailabilitySheet, { type CoachAvailabilityTarget } from '@/components/CoachAvailabilitySheet';
import SquadToolbar from '@/components/squad/SquadToolbar';
import PriorityPlayersPanel from '@/components/squad/PriorityPlayersPanel';
import SquadPlayerList from '@/components/squad/SquadPlayerList';
import SquadSaveBar from '@/components/squad/SquadSaveBar';
import { buildNotSeenNudge, fixtureLink, type FixtureBrief } from '@/lib/whatsapp';
import { useQueryClient } from '@tanstack/react-query';
import { Skeleton } from '@/components/ui/skeleton';
import { noteSquadNotified, type MatchPlayer } from '@/api/getPlayersForMatch';
import { computeAutoSelectIds } from '@/lib/autoSelect';
import { compareSelected, sortSquadList } from '@/lib/squadSort';
import { POS_SHORT, shortTeam } from '@/lib/format';
import { pruneDeltas, squadChanges, type SquadDelta } from '@/lib/squadDelta';

type Delta = SquadDelta;

/** What POST /api/squad/changes answers on success. */
interface SquadChangesResult {
  success: boolean;
  version: number;
  selectedIds: string[];
  displaced?: { playerName: string; team: string }[];
}

const CONFLICT_MESSAGE = 'Someone else changed this squad. Check and save again.';

// The whole pool, not a top-N shortlist: the ranking orders the unselected
// half of the squad list, so every candidate needs a place in it.
const RECOMMENDATION_POOL_LIMIT = 500;

export default function SquadSelection() {
  const { matchId } = useParams<{ matchId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const side = (searchParams.get("side") as "home" | "away") || undefined;

  // Opened from far down the fixture list, the window would otherwise keep
  // that offset and land mid-squad.
  useEffect(() => { window.scrollTo(0, 0); }, [matchId]);

  const { data, isLoading, isError, error, refetch } = usePlayersForMatch(matchId!, side);
  const { data: pollData } = useAvailabilityPoll(matchId!, true);
  // The ranking comes with the players (recommendationOrder); only a Worker
  // older than that field is asked for it separately. includeSelected: the
  // current squad is ranked too, so a player taken out of it before saving
  // drops back into their natural place in the list.
  const needsRecommendations = !!data && data.recommendationOrder === undefined;
  const { data: recData } = useRecommendations(matchId!, side, undefined, RECOMMENDATION_POOL_LIMIT, needsRecommendations, true);

  const [pendingDeltas, setPendingDeltas] = useState<Delta[]>([]);
  const [filters, setFilters] = useState<FilterState>(() => {
    const fromUrl = paramsToFilters(searchParams);
    // Default to the players who can actually be picked. A coach opening a
    // squad screen is choosing among the eligible and the warned; blocked
    // players are there to be understood, not selected, and burying the
    // former among the latter is what made the list hard to work.
    //
    // An explicit eligibility param always wins, so a shared link still
    // shows exactly what the person who sent it was looking at.
    if (!searchParams.get('eligibility')) {
      fromUrl.eligibility = new Set(DEFAULT_ELIGIBILITY);
    }
    return fromUrl;
  });
  // True while the eligibility chips are still the default this page applied
  // rather than anything the coach or a shared link asked for. Cleared the
  // moment either of those touches the filters.
  const eligibilityDefaultedRef = useRef(!searchParams.get('eligibility'));
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();

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

  // A fresh squad (after a conflict, or the 30s refetch) can already hold
  // some of this coach's pending changes, made by someone else. Those are
  // dropped so Save counts only real changes; the rest stay pending and
  // show on top of the new squad.
  useEffect(() => {
    if (!data?.players) return;
    const selected = data.players.filter(p => p.selectionStatus === 'Selected').map(p => p.id);
    setPendingDeltas(prev => pruneDeltas(prev, selected));
  }, [data]);

  // A player picked for the Es and then taken by the Cs comes back blocked on
  // the E sheet - and the default eligibility chips would hide the very row
  // the E coach has to clear. So when a selection is about to disappear behind
  // the default, drop the default and show the whole list instead. Only ever
  // undoes a default this page applied: filters the coach set, or ones that
  // arrived on a shared link, are left exactly as they are.
  useEffect(() => {
    if (!eligibilityDefaultedRef.current) return;
    const hasHiddenSelection = mergedPlayers.some(
      p => p.selectionStatus === 'Selected' && p.eligibilityStatus === 'blocked',
    );
    if (!hasHiddenSelection) return;
    eligibilityDefaultedRef.current = false;
    setFilters(prev => (isDefaultEligibility(prev.eligibility)
      ? { ...prev, eligibility: new Set<string>() }
      : prev));
  }, [mergedPlayers]);

  // ── Auto-Select state ────────────────────────────────────────────────
  const [autoSelectEnabled, setAutoSelectEnabled] = useState<boolean>(false);
  const [autoSelectPending, setAutoSelectPending] = useState(false);
  const [suppressedPlayerIds, setSuppressedPlayerIds] = useState<Set<string>>(new Set());
  const [hasRunAutoSelect, setHasRunAutoSelect] = useState(false);
  const [showPriorityManager, setShowPriorityManager] = useState(false);
  const [showNotify, setShowNotify] = useState(false);
  const [showNotSeen, setShowNotSeen] = useState(false);
  const [statsPlayer, setStatsPlayer] = useState<{ id: string; name: string } | null>(null);
  const [availabilityTarget, setAvailabilityTarget] = useState<CoachAvailabilityTarget | null>(null);

  const priorityPlayerIds = useMemo(
    () => new Set(data?.match?.autoSelectPlayerIds || []),
    [data?.match?.autoSelectPlayerIds]
  );

  useEffect(() => {
    if (data?.match?.autoSelectEnabled !== undefined) {
      setAutoSelectEnabled(data.match.autoSelectEnabled);
    }
  }, [data?.match?.autoSelectEnabled]);

  const applyAutoSelect = useCallback((players: MatchPlayer[]) => {
    if (priorityPlayerIds.size === 0) return;
    const autoIds = computeAutoSelectIds(players, priorityPlayerIds, suppressedPlayerIds);

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

  useEffect(() => {
    if (!autoSelectEnabled || mergedPlayers.length === 0) return;
    if (!hasRunAutoSelect) {
      applyAutoSelect(mergedPlayers);
      setHasRunAutoSelect(true);
    }
  }, [autoSelectEnabled, mergedPlayers, hasRunAutoSelect, applyAutoSelect]);

  useEffect(() => {
    if (!autoSelectEnabled || !pollData?.exceptions || pollData.exceptions.length === 0) return;
    if (mergedPlayers.length === 0) return;
    applyAutoSelect(mergedPlayers);
  }, [pollData?.exceptions, autoSelectEnabled, mergedPlayers, applyAutoSelect]);

  const handleToggleSelection = (playerId: string) => {
    const player = mergedPlayers.find(p => p.id === playerId);
    if (!player) return;

    const serverStatus = data?.players.find(p => p.id === playerId)?.selectionStatus === 'Selected';
    const isCurrentlySelected = player.selectionStatus === 'Selected';
    if (!canToggleSelection(player.eligibilityStatus === 'blocked', isCurrentlySelected)) return;
    const nextAction: Delta['action'] = isCurrentlySelected ? 'remove' : 'select';

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

  const handleToggleAutoSelect = async (enabled: boolean) => {
    setAutoSelectEnabled(enabled);
    setAutoSelectPending(true);
    if (enabled) {
      setSuppressedPlayerIds(new Set());
      setHasRunAutoSelect(false);
      if (priorityPlayerIds.size > 0) {
        // Suppression was just reset above, so compute against an explicit
        // empty set here rather than through applyAutoSelect's memoized
        // closure, which would still see this render's (pre-reset) value.
        const autoIds = computeAutoSelectIds(mergedPlayers, priorityPlayerIds, new Set());
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
      });
    } catch (e: any) {
      toast.error('Failed to save auto-select setting');
    } finally {
      setAutoSelectPending(false);
    }
  };

  // A coach has answered for a player. Patch the cached list rather than
  // refetching it: the list is rebuilt per isolate on a five-minute cache,
  // so an immediate refetch could land on one that has not seen the write
  // and put the old answer straight back. The 30s availability poll, which
  // reads through the shared cache, is asked to refresh instead.
  const handleAvailabilitySaved = (
    playerId: string,
    status: string,
    notes: string,
  ) => {
    const qk: [string, string | undefined, string | undefined] = ['playersForMatch', matchId, side];
    queryClient.setQueryData(qk, (old: any) => {
      if (!old) return old;
      return {
        ...old,
        players: old.players.map((p: MatchPlayer) =>
          p.id === playerId
            ? { ...p, availabilityStatus: status, playerNotes: notes, availabilityFromRule: false }
            : p,
        ),
      };
    });
    // The poll overlays its exceptions on the list. Setting Available deletes
    // the exception, so drop the stale poll entry too or it would overlay the
    // old status until the next tick.
    queryClient.setQueryData(['availabilityPoll', matchId], (old: any) => {
      if (!old?.exceptions) return old;
      const rest = old.exceptions.filter((e: { playerId: string }) => e.playerId !== playerId);
      return {
        ...old,
        exceptions: status === 'Available' ? rest : [...rest, { playerId, status, notes }],
      };
    });
    queryClient.invalidateQueries({ queryKey: ['availabilityPoll', matchId] });
    queryClient.invalidateQueries({ queryKey: ['upcomingFixtures'] });
    setAvailabilityTarget(null);
  };

  const hasChanges = pendingDeltas.length > 0;

  const leave = useUnsavedChanges(hasChanges, 'Your squad changes will be lost.');

  const handleFilterChange = useCallback((f: FilterState) => {
    eligibilityDefaultedRef.current = false;
    setFilters(f);
    setSearchParams(prev => {
      const params = new URLSearchParams(prev);
      ['position', 'eligibility', 'selection', 'availability', 'ability', 'name'].forEach(k => params.delete(k));
      for (const [k, v] of filtersToParams(f)) params.set(k, v);
      return params;
    }, { replace: true });
  }, [setSearchParams]);

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

  // Rows with the "not seen" chip: 6+ weeks since they opened Eddy, and no answer for this fixture.
  const notSeenPlayers = useMemo(() => filteredPlayers.filter(p => p.notSeenWeeks != null), [filteredPlayers]);

  const recRankById = useMemo(
    () => {
      const order = data?.recommendationOrder ?? recData?.recommendations.map((r) => r.id) ?? [];
      return new Map(order.map((id, i) => [id, i] as [string, number]));
    },
    [data?.recommendationOrder, recData]
  );

  const sortedPlayers = useMemo(
    () => sortSquadList(filteredPlayers, recRankById),
    [filteredPlayers, recRankById]
  );

  const optimisticMatch = useMemo(() => {
    if (!data?.match) return null;
    const selectedCount = mergedPlayers.filter(p => p.selectionStatus === 'Selected').length;
    return { ...data.match, selectedCount };
  }, [data?.match, mergedPlayers]);

  // Squad to notify, in the order shown on screen. Uses the merged list so a
  // just-selected player is included without waiting for a refetch.
  const selectedPlayers = useMemo(
    () => mergedPlayers.filter(p => p.selectionStatus === 'Selected').sort(compareSelected),
    [mergedPlayers]
  );

  const notifyFixture: FixtureBrief | null = useMemo(() => {
    const m = data?.match;
    if (!m) return null;
    return {
      hkfcTeam: m.hkfcTeam || m.homeTeam,
      opponent: m.hkfcTeam === m.awayTeam ? m.homeTeam : m.awayTeam,
      date: m.date,
      venue: m.venue,
      kit: m.kit ?? '',
      link: matchId ? fixtureLink(window.location.origin, matchId) : undefined,
      change: m.change,
    };
  }, [data?.match, matchId]);

  // Who came in and went out since the squad was last sent from Notify.
  const sinceNotice = useMemo(() => {
    const notice = data?.match.notice;
    if (!notice) return null;
    const told = new Set(notice.squad);
    const now = new Set(selectedPlayers.map((p) => p.id));
    const target = (p: MatchPlayer) => ({ id: p.id, preferredName: p.preferredName, mobile: p.mobile, shirtNo: p.shirtNo, playingPosition: p.playingPosition });
    return {
      at: notice.at,
      added: selectedPlayers.filter((p) => !told.has(p.id)).map(target),
      removed: mergedPlayers.filter((p) => told.has(p.id) && !now.has(p.id)).map(target),
    };
  }, [data?.match.notice, selectedPlayers, mergedPlayers]);

  // The squad was sent: remember it as what the players know (once per sheet).
  const notifiedRef = useRef(false);
  const handleNotified = () => {
    const side = data?.match.side;
    if (notifiedRef.current || !matchId || !side) return;
    notifiedRef.current = true;
    void noteSquadNotified(matchId, side)
      .then(() => queryClient.invalidateQueries({ queryKey: ['playersForMatch'] }))
      .catch(() => {
        notifiedRef.current = false;
      });
  };

  // An empty squad can start from the team's last one: everyone in it who
  // isn't Unavailable or blocked, as changes to save.
  const lastSquad = data?.match.lastSquad;
  const canStartFromLast = !!lastSquad && lastSquad.players.length > 0 && selectedPlayers.length === 0 && pendingDeltas.length === 0;
  const startFromLastSquad = () => {
    if (!lastSquad) return;
    const byId = new Map(mergedPlayers.map((p) => [p.id, p]));
    const picks = lastSquad.players
      .map((id) => byId.get(id))
      .filter((p): p is MatchPlayer => !!p && p.eligibilityStatus !== 'blocked' && p.availabilityStatus !== 'Unavailable');
    updateDeltas(picks.map((p) => ({ playerId: p.id, action: 'select' })));
    const skipped = lastSquad.players.length - picks.length;
    toast.success(`${picks.length} from the last squad${skipped ? `; ${skipped} left out (unavailable or blocked)` : ''}. Save to keep.`);
  };

  const pendingPlayers = useMemo(
    () => mergedPlayers.filter(p => pendingDeltas.some(d => d.playerId === p.id)),
    [mergedPlayers, pendingDeltas]
  );

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

    // Selecting reaches only the pickable players; clearing reaches the whole
    // visible sheet, blocked-but-already-selected rows included. Leaving those
    // behind is how a coach ends up unable to empty their own list.
    const affected = action === 'remove'
      ? filteredPlayers.filter(p => canToggleSelection(p.eligibilityStatus === 'blocked', p.selectionStatus === 'Selected'))
      : eligiblePlayers;

    if (action === 'remove' && autoSelectEnabled) {
      const affectedIds = new Set(affected.filter(p => priorityPlayerIds.has(p.id)).map(p => p.id));
      if (affectedIds.size > 0) {
        setSuppressedPlayerIds(prev => new Set([...prev, ...affectedIds]));
      }
    }
    if (action === 'select') {
      setSuppressedPlayerIds(prev => {
        const next = new Set(prev);
        for (const p of affected) next.delete(p.id);
        return next;
      });
    }
    updateDeltas(affected.map(p => ({ playerId: p.id, action })));
  };

  const handleSave = async () => {
    if (!hasChanges || !data) return;
    const qk: [string, string | undefined, string | undefined] = ['playersForMatch', matchId, side];
    // Only this coach's adds and removes, against the squad as loaded, plus
    // that squad's version: the server merges them with anyone else's
    // changes and refuses only when both touched the same player.
    const loadedSelected = data.players.filter(p => p.selectionStatus === 'Selected').map(p => p.id);
    const { add, remove } = squadChanges(pendingDeltas, loadedSelected);
    if (add.length === 0 && remove.length === 0) {
      setPendingDeltas([]);
      return;
    }
    setSaving(true);
    try {
      const result = await apiPost<SquadChangesResult>('/api/squad/changes', {
        matchId,
        side,
        add,
        remove,
        version: data.match.selectionVersion ?? 0,
      });
      // The squad as it is now, everyone's changes included.
      const selected = new Set(
        result.selectedIds ?? [...loadedSelected.filter(id => !remove.includes(id)), ...add],
      );
      queryClient.setQueryData(qk, (old: any) => {
        if (!old) return old;
        return {
          ...old,
          match: { ...old.match, selectedCount: selected.size, selectionVersion: result.version },
          players: old.players.map((p: any) => ({
            ...p,
            selectionStatus: selected.has(p.id) ? 'Selected' : '',
          })),
        };
      });
      toast.success('Squad saved');
      // Higher team priority (Bye-Law 7.1): anyone this squad took from a
      // same-day lower squad has been removed from it. Say so, so the coach
      // can let that team know.
      const displaced = result?.displaced ?? [];
      if (displaced.length > 0) {
        const names = displaced.map(d => `${d.playerName} (${shortTeam(d.team)})`).join(', ');
        toast.info(`Removed from same-day squad: ${names}. One match per day - Bye-law 7.1.`, { duration: 10_000 });
        // The lower squads changed too; drop any of them this browser holds.
        queryClient.invalidateQueries({ queryKey: ['playersForMatch'] });
      }
      setPendingDeltas([]);
      setSuppressedPlayerIds(new Set());
      queryClient.invalidateQueries({ queryKey: qk });
      queryClient.invalidateQueries({ queryKey: ['upcomingFixtures'] });
      queryClient.invalidateQueries({ queryKey: ['recommendations', matchId, side] });
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'SQUAD_CONFLICT') {
        // Someone else changed one of the same players. Reload the squad and
        // keep this coach's changes: they show on top of the new squad, so
        // the coach checks and saves again.
        toast.error(CONFLICT_MESSAGE);
        queryClient.invalidateQueries({ queryKey: qk });
      } else {
        toast.error(e?.message || 'Could not save the squad');
      }
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
      <MatchHeader match={optimisticMatch} matchId={matchId} />

      <PlayerFilters filters={filters} onChange={handleFilterChange} />

      <SquadToolbar
        allVisibleSelected={filteredPlayers.length > 0 && filteredPlayers.filter(p => p.eligibilityStatus !== 'blocked').every(p => p.selectionStatus === 'Selected')}
        onToggleAll={handleToggleAllVisible}
        lastSquadCount={canStartFromLast ? lastSquad!.players.length : null}
        onStartFromLast={startFromLastSquad}
        autoSelectEnabled={autoSelectEnabled}
        autoSelectPending={autoSelectPending}
        onToggleAutoSelect={handleToggleAutoSelect}
        canNotify={!!notifyFixture}
        selectedCount={selectedPlayers.length}
        onNotify={() => setShowNotify(true)}
        notSeenCount={notSeenPlayers.length}
        onNotSeen={() => setShowNotSeen(true)}
        autoSelectedCount={autoSelectedCount}
        priorityCount={priorityPlayerIds.size}
        showPriorityManager={showPriorityManager}
        onTogglePriorityManager={() => setShowPriorityManager(prev => !prev)}
        suppressedCount={suppressedPlayerIds.size}
        onRescan={() => { setSuppressedPlayerIds(new Set()); setHasRunAutoSelect(false); }}
      />

      {showPriorityManager && (
        <PriorityPlayersPanel
          team={data.match.hkfcTeam}
          players={data.players}
          matchId={matchId}
          side={side}
          onClose={() => setShowPriorityManager(false)}
        />
      )}

      <SquadPlayerList
        players={sortedPlayers}
        onToggleSelection={(p) => handleToggleSelection(p.id)}
        onShowStats={(p) => setStatsPlayer({ id: p.id, name: p.preferredName })}
        onSetAvailability={(p) =>
          setAvailabilityTarget({
            id: p.id,
            name: p.preferredName,
            availabilityStatus: p.availabilityStatus,
            availabilityFromRule: p.availabilityFromRule,
            optInOnly: p.optInOnly,
            playerNotes: p.playerNotes,
          })
        }
      />

      {hasChanges && (
        <SquadSaveBar
          pendingPlayers={pendingPlayers}
          changeCount={pendingDeltas.length}
          saving={saving}
          onDiscard={() => setPendingDeltas([])}
          onSave={handleSave}
        />
      )}

      {leave.prompt}

      {showNotify && notifyFixture && (
        <NotifySquadSheet
          fixture={notifyFixture}
          players={selectedPlayers.map(p => ({
            id: p.id,
            preferredName: p.preferredName,
            mobile: p.mobile,
            shirtNo: p.shirtNo,
            playingPosition: p.playingPosition,
          }))}
          sinceNotice={sinceNotice}
          onNotified={handleNotified}
          appSend={matchId && data?.match.side && pendingDeltas.length === 0 ? { matchId, side: data.match.side } : undefined}
          onClose={() => {
            setShowNotify(false);
            notifiedRef.current = false;
          }}
        />
      )}

      {showNotSeen && notifyFixture && (
        <WhatsAppListSheet
          title="Not seen for 6+ weeks"
          people={notSeenPlayers.map(p => ({ id: p.id, name: p.preferredName, mobile: p.mobile }))}
          defaultMessage={buildNotSeenNudge(notifyFixture)}
          onClose={() => setShowNotSeen(false)}
        />
      )}

      <SeasonStatsSheet
        playerId={statsPlayer?.id ?? null}
        playerName={statsPlayer?.name}
        onClose={() => setStatsPlayer(null)}
      />

      {availabilityTarget && matchId && (
        <CoachAvailabilitySheet
          matchId={matchId}
          player={availabilityTarget}
          onClose={() => setAvailabilityTarget(null)}
          onSaved={(status, notes) => handleAvailabilitySaved(availabilityTarget.id, status, notes)}
        />
      )}
    </div>
  );
}