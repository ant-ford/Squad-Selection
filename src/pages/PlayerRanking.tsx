import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowLeft,
  Search,
  Settings2,
  X,
  ChevronUp,
  ChevronDown,
  UserMinus,
  UserPlus,
  GripVertical,
  ListChecks,
  Loader2,
  Filter,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  useAbilityGroupConfig,
  useActivatePlayer,
  useDeactivatePlayer,
  useInactiveRanking,
  useInitializeRanking,
  useRanking,
  useReorderRanking,
  useUpdateAbilityConfig,
} from '@/lib/queries';
import { emptyConfig, computeAbilityAssignment } from '../../worker/src/abilityGroup';
import type { ProfileData } from '@/api/getMyProfile';
import type {
  AbilityGroupConfigMap,
  InactiveRankingEntry,
  Player,
} from '@/generated/domainTypes';

// ── Constants ────────────────────────────────────────────────────────────
const POS_SHORT: Record<string, string> = {
  Defender: 'DEF',
  Midfielder: 'MID',
  Forward: 'FWD',
  Goalkeeper: 'GK',
  'Flexible/Varies': 'FLEX',
};
const ALL_POSITIONS = Object.keys(POS_SHORT);
const GROUP_COLORS: Record<string, string> = {
  A: '#3b82f6', B: '#06b6d4', C: '#14b8a6', D: '#22c55e',
  E: '#eab308', F: '#f97316', G: '#ef4444',
};

const STAGE_FILTER_OPTIONS = [
  { key: 'All', label: 'All', minOrdinal: -1 },
  { key: 'Trial Application', label: 'Trial Application', minOrdinal: 1 },
  { key: 'Sponsoring', label: 'Sponsoring', minOrdinal: 2 },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────
function stageOrdinal(stage?: string): number {
  if (!stage) return -1;
  const m = /^(\d+)./.exec(stage);
  return m ? Number(m[1]) : -1;
}

function shortStage(s?: string): string {
  return s ? s.replace(/^\d+.\s*/, '') : '';
}

function computeGroupBoundaries(config: AbilityGroupConfigMap, totalActive: number) {
  const boundaries: { group: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const g of ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const) {
    const cap = Math.max(0, Math.floor(config[g] ?? 0));
    if (cap === 0) continue;
    const start = cursor + 1;
    const end = Math.min(cursor + cap, totalActive);
    if (end < start) break;
    boundaries.push({ group: g, start, end });
    cursor = end;
  }
  return boundaries;
}

function nameOf(p: Player | InactiveRankingEntry): string {
  const a = (p.preferredName ?? '').trim();
  const b = (p.surname ?? '').trim();
  const c = (p.givenNames ?? '').trim();
  if (a && b) return `${a} ${b}`;
  if (a) return a;
  if (b) return b;
  if (c) return c;
  return 'Unknown';
}

function getDividerGroup(player: Player, boundaries: ReturnType<typeof computeGroupBoundaries>) {
  const rank = player.sectionRank ?? 0;
  for (const b of boundaries) {
    if (rank >= b.start && rank <= b.end) return b.group;
  }
  return 'H';
}

function getGroupForRank(rank: number, boundaries: ReturnType<typeof computeGroupBoundaries>): string {
  for (const b of boundaries) {
    if (rank >= b.start && rank <= b.end) return b.group;
  }
  return 'H';
}

// ── Main component ───────────────────────────────────────────────────────
export default function PlayerRanking() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const isSectionCaptain = !!profile?.isSectionCaptain;
  const ranking = useRanking();
  const inactiveQuery = useInactiveRanking();
  const configQuery = useAbilityGroupConfig();
  const reorder = useReorderRanking();
  const activate = useActivatePlayer();
  const deactivate = useDeactivatePlayer();
  const initialize = useInitializeRanking();
  const updateConfig = useUpdateAbilityConfig();

  // ── Filter / UI state ──────────────────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  // Search debounce (200ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [teamFilter, setTeamFilter] = useState<string | null>(null);
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [showInactive, setShowInactive] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [moveToRankPlayer, setMoveToRankPlayer] = useState<Player | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<{ playerId: string; label: string } | null>(null);
  const [confirmInitialize, setConfirmInitialize] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 640);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const [mutatingPlayerId, setMutatingPlayerId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [currentGroup, setCurrentGroup] = useState<string | null>(null);

  // ── Derived data ───────────────────────────────────────────────────────
  const data = ranking.data;
  const players = data?.players ?? [];
  const config = data?.config ?? (configQuery.data as AbilityGroupConfigMap | undefined) ?? emptyConfig();
  const totalActive = data?.activeCount ?? 0;
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const displayPlayers = useMemo(() => {
    const source = draftIds
      ? draftIds.map((id) => playersById.get(id)).filter((p): p is Player => !!p)
      : players;
    const teamCounters = new Map<string, number>();
    const posCounters = new Map<string, number>();
    return source.map((p, i) => {
      const rank = i + 1;
      const tk = p.registeredTeam ?? '';
      const pk = p.playingPosition ?? '';
      const tr = (teamCounters.get(tk) ?? 0) + 1;
      teamCounters.set(tk, tr);
      const pr = (posCounters.get(pk) ?? 0) + 1;
      posCounters.set(pk, pr);
      const ability = computeAbilityAssignment(rank, source.length, config).abilityDisplay;
      return { ...p, sectionRank: rank, teamRank: tr, positionalRank: pr, playingAbility: ability };
    });
  }, [draftIds, players, playersById, config]);

  const boundaries = useMemo(
    () => computeGroupBoundaries(config, totalActive),
    [config, totalActive],
  );

  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.registeredTeam) set.add(p.registeredTeam);
    return Array.from(set).sort();
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minOrdinal = stageFilter ? STAGE_FILTER_OPTIONS.find(o => o.key === stageFilter)?.minOrdinal ?? -1 : -1;

    return displayPlayers.filter((p) => {
      if (p.applicantStage === 'Rejected') return false;
      if (minOrdinal !== -1 && p.status === 'Applicant') {
        const ord = stageOrdinal(p.applicantStage);
        if (ord === -1 || ord < minOrdinal) return false;
      }
      if (teamFilter && p.registeredTeam !== teamFilter) return false;
      if (positionFilter && p.playingPosition !== positionFilter) return false;
      if (q) {
        const name = `${p.preferredName ?? ''} ${p.surname ?? ''} ${p.givenNames ?? ''}`.toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [displayPlayers, teamFilter, positionFilter, search, stageFilter]);

  const modifiedCount = useMemo(() => {
    if (!draftIds) return 0;
    let count = 0;
    for (const p of displayPlayers) {
      const server = playersById.get(p.id);
      if (server && server.sectionRank !== p.sectionRank) count++;
    }
    return count;
  }, [draftIds, displayPlayers, playersById]);

  const hasChanges = modifiedCount > 0;

  const virtualizer = useVirtualizer({
    count: filteredPlayers.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 56,
    overscan: 8,
  });

  const rafId = useRef<number>(0);
  const handleListScroll = useCallback(() => {
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const container = listRef.current;
      if (!container) return;
      const rows = container.querySelectorAll('[data-rank]');
      const containerTop = container.getBoundingClientRect().top;
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.bottom > containerTop + 48) {
          const rank = Number(row.getAttribute('data-rank'));
          setCurrentGroup(getGroupForRank(rank, boundaries));
          return;
        }
      }
    });
  }, [boundaries]);

  useEffect(() => {
    return () => {
      if (rafId.current) cancelAnimationFrame(rafId.current);
    };
  }, []);

  const reorderDraft = useCallback(
    (sourceId: string, targetId: string, before: boolean) => {
      if (sourceId === targetId) return;
      setDraftIds((prev) => {
        const base = prev ?? players.map((p) => p.id);
        const next = base.filter((id) => id !== sourceId);
        const ti = next.indexOf(targetId);
        if (ti === -1) return prev;
        next.splice(before ? ti : ti + 1, 0, sourceId);
        return next;
      });
    },
    [players],
  );

  const moveToAbsoluteRank = useCallback(
    (id: string, rank: number) => {
      setDraftIds((prev) => {
        const base = prev ?? players.map((p) => p.id);
        const next = base.filter((x) => x !== id);
        const clamped = Math.max(1, Math.min(rank, next.length + 1));
        next.splice(clamped - 1, 0, id);
        return next;
      });
    },
    [players],
  );

  const moveStep = useCallback(
    (id: string, dir: 'up' | 'down') => {
      const idx = filteredPlayers.findIndex((p) => p.id === id);
      if (idx === -1) return;
      const neighbor = dir === 'up' ? filteredPlayers[idx - 1] : filteredPlayers[idx + 1];
      if (!neighbor) return;
      reorderDraft(id, neighbor.id, dir === 'up');
    },
    [filteredPlayers, reorderDraft],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const sourceId = String(active.id);
      const targetId = String(over.id);
      const sourceIdx = filteredPlayers.findIndex((p) => p.id === sourceId);
      const targetIdx = filteredPlayers.findIndex((p) => p.id === targetId);
      if (sourceIdx === -1 || targetIdx === -1) return;
      const before = sourceIdx > targetIdx;
      reorderDraft(sourceId, targetId, before);
    },
    [filteredPlayers, reorderDraft],
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!draftIds || modifiedCount === 0) return;
    try {
      await reorder.mutateAsync({ playerIds: draftIds });
      setDraftIds(null);
      toast.success(`Ranking saved (${modifiedCount} change${modifiedCount !== 1 ? 's' : ''})`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to save ranking');
    }
  }, [draftIds, modifiedCount, reorder]);

  const handleDiscard = useCallback(() => {
    setDraftIds(null);
    queryClient.invalidateQueries({ queryKey: ['ranking'] });
  }, [queryClient]);

  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const displayPlayersRef = useRef(displayPlayers);
  displayPlayersRef.current = displayPlayers;

  const handleOpenMoveToRank = useCallback((playerId: string) => {
    const p = displayPlayersRef.current.find((x) => x.id === playerId) ?? null;
    setMoveToRankPlayer(p);
  }, []);

  const handleDeactivateById = useCallback(
    (playerId: string) => {
      const player = playersById.get(playerId);
      const label = player ? nameOf(player) : 'this player';
      setConfirmDeactivate({ playerId, label });
    },
    [playersById],
  );

  const executeDeactivate = useCallback(
    async (playerId: string, label: string) => {
      setMutatingPlayerId(playerId);
      try {
        await deactivate.mutateAsync({ playerId });
        setDraftIds(null);
        toast.success(`${label} removed from ranking`);
      } catch (err: any) {
        toast.error(err?.message ?? 'Failed to deactivate player');
      } finally {
        setMutatingPlayerId(null);
      }
    },
    [deactivate],
  );

  const handleActivate = useCallback(
    async (entry: InactiveRankingEntry) => {
      setMutatingPlayerId(entry.id);
      try {
        await activate.mutateAsync({ playerId: entry.id });
        setDraftIds(null);
        toast.success(`${entry.preferredName ?? 'Player'} ${entry.status === 'Applicant' ? 'added to ranking' : 'reactivated'}`);
      } catch (err: any) {
        toast.error(err?.message ?? 'Failed to activate player');
      } finally {
        setMutatingPlayerId(null);
      }
    },
    [activate],
  );

  const handleInitialize = useCallback(() => {
    setConfirmInitialize(true);
  }, []);

  const executeInitialize = useCallback(async () => {
    try {
      const result = await initialize.mutateAsync();
      setDraftIds(null);
      toast.success(`Ranking initialised (${result.activeCount} active players)`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to initialise ranking');
    }
  }, [initialize]);

  if (ranking.isLoading) return <RankingSkeleton />;
  if (ranking.isError) {
    return (
      <div className="p-6 text-center text-destructive">
        Failed to load ranking: {(ranking.error as any)?.message ?? 'Unknown error'}
        <div className="mt-3">
          <Button onClick={() => ranking.refetch()}>Retry</Button>
        </div>
      </div>
    );
  }
  if (!data) return <RankingSkeleton />;

  const isSaving = reorder.isPending;
  const activeDragPlayer = activeDragId ? playersById.get(activeDragId) : null;

  const filterBarProps = {
    search: searchInput,
    onSearch: setSearchInput,
    teamFilter,
    onTeamFilter: setTeamFilter,
    positionFilter,
    onPositionFilter: setPositionFilter,
    stageFilter,
    onStageFilter: setStageFilter,
    teamOptions,
    showInactive,
    onToggleShowInactive: () => setShowInactive((v) => !v),
    onInitialize: handleInitialize,
  };

  return (
    <div className="pb-32">
      <div className="container mx-auto px-4 pt-3 flex items-center gap-2">
        <button onClick={() => navigate('/coach')} className="flex items-center gap-1 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Fixtures
        </button>
        <div className="flex-1" />
        {isSectionCaptain && (
          <button
            onClick={() => setShowConfig(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-muted text-muted-foreground hover:bg-muted/80"
          >
            <Settings2 className="h-3.5 w-3.5" /> Configuration
          </button>
        )}
      </div>

      <div className="container mx-auto px-4 pt-2 pb-1">
        <h1 className="text-xl font-semibold text-foreground">Player Ranking</h1>
      </div>

      {isMobile ? (
        <>
          <div className="container mx-auto px-4 py-2 border-y border-border bg-card">
            <button
              onClick={() => setIsFilterSheetOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
            >
              <Filter className="h-4 w-4" />
              Filters
              {(search || teamFilter || positionFilter || stageFilter) && ' (active)'}
            </button>
          </div>
          <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
            <SheetContent side="bottom" className="rounded-t-2xl max-h-[85vh] overflow-y-auto">
              <SheetHeader>
                <SheetTitle>Filters</SheetTitle>
              </SheetHeader>
              <RankingFilterContent {...filterBarProps} />
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <div className="container mx-auto px-4 py-2 border-y border-border bg-card">
          <RankingFilterContent {...filterBarProps} />
        </div>
      )}

      {currentGroup && filteredPlayers.length > 0 && (
        <div className="sticky top-0 z-10 container mx-auto px-4">
          <div className="bg-background/95 backdrop-blur-sm border-b border-border py-1 px-2 rounded-b-lg">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">
              Ability Group {currentGroup}
            </span>
          </div>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleListScroll}
        className="container mx-auto px-4 pt-2 max-h-[70vh] overflow-y-auto"
      >
        {filteredPlayers.length === 0 ? (
          <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
            No players match the current filters.
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
          >
            <SortableContext
              items={filteredPlayers.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div
                style={{
                  height: `${virtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const p = filteredPlayers[virtualRow.index];
                  const prevPlayer = filteredPlayers[virtualRow.index - 1];
                  const currentGrp = getDividerGroup(p, boundaries);
                  const prevGrp = prevPlayer ? getDividerGroup(prevPlayer, boundaries) : null;
                  const showDivider = prevGrp !== null && currentGrp !== prevGrp;
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
                      {showDivider && <TierDivider group={prevGrp!} />}
                      <SortableRankingRow
                        player={p}
                        isFirst={virtualRow.index === 0}
                        isLast={virtualRow.index === filteredPlayers.length - 1}
                        disabled={isSaving || mutatingPlayerId === p.id}
                        onMoveStep={moveStep}
                        onOpenMoveToRank={handleOpenMoveToRank}
                        onDeactivate={handleDeactivateById}
                      />
                    </div>
                  );
                })}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeDragPlayer ? (
                <RankingRowInner
                  player={activeDragPlayer}
                  isFirst={false}
                  isLast={false}
                  disabled={false}
                  isDragging={false}
                  onMoveStep={() => {}}
                  onOpenMoveToRank={() => {}}
                  onDeactivate={() => {}}
                  dragHandleProps={{}}
                  style={{ opacity: 0.9, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {showInactive && (
        <InactiveSection
          entries={inactiveQuery.data ?? []}
          loading={inactiveQuery.isLoading}
          onReactivate={handleActivate}
        />
      )}

      {moveToRankPlayer && (
        <MoveToRankSheet
          player={moveToRankPlayer}
          activeCount={totalActive}
          onClose={() => setMoveToRankPlayer(null)}
          onSubmit={(rank) => {
            moveToAbsoluteRank(moveToRankPlayer.id, rank);
            setMoveToRankPlayer(null);
          }}
        />
      )}

      {showConfig && isSectionCaptain && (
        <ConfigSheet
          config={config}
          activeCount={totalActive}
          saving={updateConfig.isPending}
          onClose={() => setShowConfig(false)}
          onSave={async (next) => {
            try {
              await updateConfig.mutateAsync(next);
              toast.success('Configuration saved — ability badges updated');
              setShowConfig(false);
            } catch (err: any) {
              toast.error(err?.message ?? 'Failed to update configuration');
            }
          }}
        />
      )}

      {confirmDeactivate && (
        <ConfirmDialog
          title="Remove from ranking"
          message={`Remove ${confirmDeactivate.label} from the ranking? They will be marked inactive.`}
          confirmLabel="Remove"
          destructive
          onConfirm={() => executeDeactivate(confirmDeactivate.playerId, confirmDeactivate.label)}
          onCancel={() => setConfirmDeactivate(null)}
        />
      )}

      {confirmInitialize && (
        <ConfirmDialog
          title="Initialize ranking"
          message="Initialize section ranks for all active players and applicants without one? Existing ranks are preserved."
          confirmLabel="Initialize"
          onConfirm={executeInitialize}
          onCancel={() => setConfirmInitialize(false)}
        />
      )}

      {hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t p-4 flex gap-3 z-50 items-center">
          <div className="flex-1 text-sm text-muted-foreground">
            {modifiedCount} unsaved change{modifiedCount !== 1 ? 's' : ''}
          </div>
          <button onClick={handleDiscard} disabled={isSaving} className="flex-1 py-3 border rounded text-sm font-medium disabled:opacity-50">
            Discard
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 py-3 bg-primary text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {reorder.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> Saving…
              </span>
            ) : (
              `Save (${modifiedCount})`
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────
function RankingFilterContent(props: {
  search: string;
  onSearch: (v: string) => void;
  teamFilter: string | null;
  onTeamFilter: (v: string | null) => void;
  positionFilter: string | null;
  onPositionFilter: (v: string | null) => void;
  stageFilter: string | null;
  onStageFilter: (v: string | null) => void;
  teamOptions: string[];
  showInactive: boolean;
  onToggleShowInactive: () => void;
  onInitialize: () => void;
}) {
  const hasFilter = !!props.search || !!props.teamFilter || !!props.positionFilter || !!props.stageFilter;
  return (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Search by name…"
          className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {hasFilter && (
          <button
            onClick={() => {
              props.onSearch('');
              props.onTeamFilter(null);
              props.onPositionFilter(null);
              props.onStageFilter(null);
            }}
            className="text-xs text-destructive flex items-center gap-0.5"
          >
            <X className="h-3 w-3" /> Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Team:</span>
        <Chip label="All" active={!props.teamFilter} onClick={() => props.onTeamFilter(null)} />
        {props.teamOptions.map((t) => (
          <Chip key={t} label={t} active={props.teamFilter === t} onClick={() => props.onTeamFilter(props.teamFilter === t ? null : t)} />
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Position:</span>
        <Chip label="All" active={!props.positionFilter} onClick={() => props.onPositionFilter(null)} />
        {ALL_POSITIONS.map((p) => (
          <Chip key={p} label={POS_SHORT[p] ?? p} active={props.positionFilter === p} onClick={() => props.onPositionFilter(props.positionFilter === p ? null : p)} />
        ))}
      </div>

      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <span className="text-xs text-muted-foreground w-16 shrink-0">Min. Stage:</span>
        {STAGE_FILTER_OPTIONS.map((s) => (
          <Chip
            key={s.key}
            label={s.label}
            active={props.stageFilter === s.key}
            onClick={() => props.onStageFilter(props.stageFilter === s.key ? null : s.key)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={props.onToggleShowInactive}
          className={`text-xs px-2 py-1 rounded-md ${props.showInactive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
        >
          {props.showInactive ? 'Hide inactive' : 'Show inactive'}
        </button>
        <div className="flex-1" />
        <button
          onClick={props.onInitialize}
          className="text-xs flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground hover:bg-muted/80"
          title="Assigns initial section ranks to all unranked active players and applicants, ordered by ability."
        >
          <ListChecks className="h-3 w-3" /> Initialise
        </button>
      </div>
    </>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 transition-colors ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
    >
      {label}
    </button>
  );
}

function TierDivider({ group }: { group: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <span className="text-[10px] font-semibold tracking-widest uppercase text-muted-foreground">─── End {group} ───</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function SortableRankingRow(props: {
  player: Player;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onMoveStep: (id: string, dir: 'up' | 'down') => void;
  onOpenMoveToRank: (playerId: string) => void;
  onDeactivate: (playerId: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.player.id, disabled: props.disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <RankingRowInner
        player={props.player}
        isFirst={props.isFirst}
        isLast={props.isLast}
        disabled={props.disabled}
        isDragging={isDragging}
        onMoveStep={props.onMoveStep}
        onOpenMoveToRank={props.onOpenMoveToRank}
        onDeactivate={props.onDeactivate}
        dragHandleProps={listeners ?? {}}
      />
    </div>
  );
}

function RankingRowInner(props: {
  player: Player;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  isDragging: boolean;
  onMoveStep: (id: string, dir: 'up' | 'down') => void;
  onOpenMoveToRank: (playerId: string) => void;
  onDeactivate: (playerId: string) => void;
  dragHandleProps: Record<string, any>;
  style?: React.CSSProperties;
}) {
  const { player, disabled, isDragging } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const rank = player.sectionRank ?? 0;
  const ability = player.playingAbility ?? '—';
  const abilityTone = getAbilityTone(ability);
  const isApplicant = player.status === 'Applicant';

  return (
    <div
      data-rank={rank}
      style={props.style}
      className={`flex items-center gap-2 py-1 px-2 border rounded-lg transition-colors ${
        isApplicant ? 'bg-amber-50/70 dark:bg-amber-950/30' : 'bg-card'
      } ${isDragging ? 'border-primary' : isApplicant ? 'border-amber-200 dark:border-amber-800' : 'border-border'}`}
    >
      <div
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground shrink-0 touch-none"
        {...props.dragHandleProps}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      <div className="w-8 text-center shrink-0">
        <span className="text-sm font-bold text-foreground tabular-nums">{rank || '—'}</span>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-sm font-medium text-foreground truncate leading-tight">{nameOf(player)}</p>
          {isApplicant && (
            <span
              className="text-[9px] font-bold uppercase tracking-wider bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm shrink-0"
              title={player.applicantStage}
            >
              Applicant{player.applicantStage ? `· ${shortStage(player.applicantStage)}` : ''}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground truncate leading-tight">
          {POS_SHORT[player.playingPosition ?? ''] ?? '–'} · {player.registeredTeam ?? '–'} · T#{player.teamRank ?? '–'} · P#{player.positionalRank ?? '–'}
        </p>
      </div>

      <AbilityBadge value={ability} tone={abilityTone} />

      <div className="relative">
        <button onClick={() => setMenuOpen((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground" title="More actions">
          <Settings2 className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-7 z-40 w-48 bg-card border border-border rounded-md shadow-lg p-1 text-sm">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onOpenMoveToRank(player.id);
                }}
                className="w-full flex items-center text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
              >
                Move to rank…
              </button>
              <div className="my-1 h-px bg-border" />
              <button
                onClick={() => {
                  setMenuOpen(false);
                  props.onDeactivate(player.id);
                }}
                className="w-full flex items-center text-left text-xs px-2 py-1.5 rounded hover:bg-muted text-destructive"
              >
                <UserMinus className="h-3.5 w-3.5 mr-2" /> Deactivate
              </button>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <button
          onClick={() => props.onMoveStep(player.id, 'up')}
          disabled={disabled || props.isFirst}
          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move up"
        >
          <ChevronUp className="h-4 w-4" />
        </button>
        <button
          onClick={() => props.onMoveStep(player.id, 'down')}
          disabled={disabled || props.isLast}
          className="p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
          title="Move down"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function AbilityBadge({ value, tone }: { value: string; tone: string }) {
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${tone}`} title={value}>
      {value}
    </span>
  );
}

function getAbilityTone(value: string): string {
  if (value.startsWith('A')) return 'bg-blue-100 text-blue-800 border border-blue-200';
  if (value.startsWith('B')) return 'bg-cyan-100 text-cyan-800 border border-cyan-200';
  if (value.startsWith('C')) return 'bg-teal-100 text-teal-800 border border-teal-200';
  if (value.startsWith('D')) return 'bg-green-100 text-green-800 border border-green-200';
  if (value.startsWith('E')) return 'bg-yellow-100 text-yellow-800 border border-yellow-200';
  if (value.startsWith('F')) return 'bg-orange-100 text-orange-800 border border-orange-200';
  if (value.startsWith('G')) return 'bg-red-100 text-red-800 border border-red-200';
  if (value.startsWith('H')) return 'bg-pink-100 text-pink-800 border border-pink-200';
  return 'bg-muted text-muted-foreground';
}

function MoveToRankSheet({
  player,
  activeCount,
  onClose,
  onSubmit,
}: {
  player: Player;
  activeCount: number;
  onClose: () => void;
  onSubmit: (rank: number) => void;
}) {
  const [value, setValue] = useState(String(player.sectionRank ?? 1));
  const [error, setError] = useState('');
  const n = Number(value);
  const isValid = Number.isInteger(n) && n >= 1 && n <= activeCount;

  return (
    <ModalSheet title={`Move ${nameOf(player)} to rank`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Current rank: <span className="font-medium text-foreground">#{player.sectionRank || 'Unranked'}</span>. Allowed: 1 to {activeCount}.
        </p>
        <input
          type="number"
          min={1}
          max={activeCount}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          className={`w-full text-base border rounded px-3 py-2 bg-background text-foreground ${error ? 'border-destructive' : 'border-border'}`}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={onClose}>Cancel</Button>
          <Button
            className="flex-1 bg-primary text-primary-foreground"
            onClick={() => {
              if (isValid) {
                onSubmit(n);
              } else {
                setError(`Enter a whole number between 1 and ${activeCount}.`);
              }
            }}
          >
            Move
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">Staged — remember to press Save.</p>
      </div>
    </ModalSheet>
  );
}

function ConfigSheet({
  config,
  activeCount,
  saving,
  onClose,
  onSave,
}: {
  config: AbilityGroupConfigMap;
  activeCount: number;
  saving: boolean;
  onClose: () => void;
  onSave: (config: AbilityGroupConfigMap) => void;
}) {
  const [local, setLocal] = useState<AbilityGroupConfigMap>({ ...config });

  useEffect(() => {
    setLocal({ ...config });
  }, [config]);

  const total = (['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).reduce((acc, g) => acc + (local[g] ?? 0), 0);
  const overCapacity = total > activeCount;

  return (
    <ModalSheet title="Ability Group Configuration" onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">
        Set the capacity of each top-level group. Group H is the residual group and automatically contains every remaining active player.
      </p>
      <div className="space-y-2">
        {(['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map((g) => (
          <div key={g} className="flex items-center gap-3">
            <span className="w-6 text-base font-bold text-foreground">{g}</span>
            <input
              type="number"
              min={0}
              disabled={saving}
              value={local[g] ?? 0}
              onChange={(e) => setLocal((s) => ({ ...s, [g]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))}
              className="flex-1 text-sm border border-border rounded px-2 py-1 bg-background text-foreground disabled:opacity-50"
            />
            <span className="text-xs text-muted-foreground w-10 text-right">players</span>
          </div>
        ))}
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <span className="w-6 text-base font-bold text-pink-700">H</span>
          <span className="flex-1 text-sm text-muted-foreground italic">residual (auto)</span>
          <span className="text-xs text-muted-foreground w-10 text-right">rest</span>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex h-4 rounded-full overflow-hidden border border-border">
          {(['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const).map((g) => {
            const cap = local[g] ?? 0;
            if (cap === 0 || activeCount === 0) return null;
            const pct = (cap / activeCount) * 100;
            return (
              <div
                key={g}
                className="h-full flex items-center justify-center text-[8px] font-bold text-white transition-all duration-200"
                style={{ width: `${pct}%`, backgroundColor: GROUP_COLORS[g] }}
                title={`Group ${g}: ${cap} players (${pct.toFixed(0)}%)`}
              >
                {pct > 6 ? g : ''}
              </div>
            );
          })}
          {activeCount > total && (
            <div
              className="h-full flex items-center justify-center text-[8px] font-bold text-pink-800 bg-pink-200 transition-all duration-200"
              style={{ width: `${((activeCount - total) / activeCount) * 100}%` }}
              title={`Group H (residual): ${activeCount - total} players`}
            >
              {((activeCount - total) / activeCount) * 100 > 6 ? 'H' : ''}
            </div>
          )}
        </div>
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>A</span>
          <span className={overCapacity ? 'text-destructive font-medium' : ''}>
            Total A–G: {total} / {activeCount} active{overCapacity ? ' — exceeds active count' : ''}
          </span>
          <span>H</span>
        </div>
      </div>

      <div className="flex gap-2 mt-4">
        <Button className="flex-1 h-10" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          className="flex-1 h-10 bg-primary text-primary-foreground disabled:opacity-50 flex items-center justify-center"
          disabled={overCapacity || saving}
          onClick={() => onSave(local)}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
        </Button>
      </div>
    </ModalSheet>
  );
}

function InactiveSection({
  entries,
  loading,
  onReactivate,
}: {
  entries: InactiveRankingEntry[];
  loading: boolean;
  onReactivate: (entry: InactiveRankingEntry) => void;
}) {
  return (
    <div className="container mx-auto px-4 pt-6">
      <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-2">
        Inactive ({entries.length})
      </h2>
      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : entries.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No inactive players.</p>
      ) : (
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 py-1 px-2 bg-card border border-border rounded-lg">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{nameOf(e)}</p>
                  {e.status === 'Applicant' && e.applicantStage && (
                    <span className="text-[9px] font-bold uppercase tracking-wider bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-sm shrink-0">
                      {shortStage(e.applicantStage)}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground truncate">
                  {e.registeredTeam ?? '–'} · {POS_SHORT[e.playingPosition ?? ''] ?? '–'}
                  {typeof e.lastSectionRank === 'number' ? `· last rank #${e.lastSectionRank}` : ''}
                </p>
              </div>
              <button
                onClick={() => onReactivate(e)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary text-primary-foreground whitespace-nowrap"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {e.status === 'Applicant' ? 'Add to ranking' : 'Reactivate'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModalSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-background rounded-t-2xl max-h-[85vh] overflow-y-auto shadow-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

function RankingSkeleton() {
  return (
    <div className="container mx-auto px-4 py-4 space-y-3">
      <Skeleton className="h-8 w-40" />
      <div className="pt-2 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}