import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragOverlay, PointerSensor, closestCenter, useSensor, useSensors,
  MeasuringStrategy, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/ui/action-button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet } from '@/components/ui/sheet';
import { Tabs, TabPanel } from '@/components/ui/tabs';
import ConfirmDialog from '@/components/ConfirmDialog';
import SeasonStatsSheet, { AttendanceSheet } from '@/components/SeasonStatsSheet';
import {
  useActivatePlayer, useDeactivatePlayer, useInactiveRanking,
  useRanking, useReorderRanking, useUpdateAbilityConfig, useRecentChanges,
} from '@/lib/queries';
import { emptyConfig, computeAbilityAssignment } from '@shared/abilityGroup';
import type { ProfileData } from '@/api/getMyProfile';
import type { InactiveRankingEntry, Player } from '@shared/schema/domainTypes';
import { useMediaQuery } from '@/lib/useMediaQuery';
import {
  applicantVisible, computeGroupBoundaries, countMoved, getGroupForRank, moveIdToRank, nameOf, reorderIds,
} from '@/lib/rankingModel';
import { NO_ROW_ACTIONS, RankingRow, SortableRankingRow } from '@/components/ranking/RankingRow';
import { MoveToRankDialog } from '@/components/ranking/MoveToRankDialog';
import { AbilityGroupsSheet } from '@/components/ranking/AbilityGroupsSheet';
import { InactiveList } from '@/components/ranking/InactiveList';
import { RecentChanges } from '@/components/ranking/RecentChanges';
import { RankingSaveBar } from '@/components/ranking/RankingSaveBar';
import { RankingSheet } from '@/components/ranking/RankingSheet';
import { EMPTY_RANKING_FILTERS, RankingFilters, type RankingFilterState } from '@/components/ranking/RankingFilters';

type View = 'ranking' | 'changes' | 'inactive';

export default function PlayerRanking() {
  const queryClient = useQueryClient();
  const { profile } = useOutletContext<{ profile: ProfileData }>();
  const isSectionCaptain = !!profile?.isSectionCaptain;
  // Making players active or inactive: Section Captains only (owner
  // decision, 6 Oct 2026), the team link or the office. The Worker checks too.
  const canSetActive = isSectionCaptain || !!profile?.officerRoles?.some((r) => r.office === 'sectionCaptain');
  const ranking = useRanking();
  const inactiveQuery = useInactiveRanking();
  // Ranking history for the reversal advisory and the Recent changes tab.
  const recentChangesQuery = useRecentChanges(30);
  const reorder = useReorderRanking();
  const activate = useActivatePlayer();
  const deactivate = useDeactivatePlayer();
  const updateConfig = useUpdateAbilityConfig();
  const isPhone = useMediaQuery('(max-width: 639px)');

  const [view, setView] = useState<View>('ranking');
  const [filters, setFilters] = useState<RankingFilterState>(EMPTY_RANKING_FILTERS);
  // The name search waits for typing to pause.
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), 200);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const [showConfig, setShowConfig] = useState(false);
  const [moveToRankPlayer, setMoveToRankPlayer] = useState<Player | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [draftIds, setDraftIds] = useState<string[] | null>(null);
  const [confirmInactive, setConfirmInactive] = useState<{ playerId: string; label: string } | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState<string | null>(null);
  const [openMenuPlayerId, setOpenMenuPlayerId] = useState<string | null>(null);
  const [statsPlayerId, setStatsPlayerId] = useState<string | null>(null);
  const [attendancePlayerId, setAttendancePlayerId] = useState<string | null>(null);
  const [mutatingPlayerId, setMutatingPlayerId] = useState<string | null>(null);
  const [justification, setJustification] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const [currentGroup, setCurrentGroup] = useState<string | null>(null);

  const data = ranking.data;
  const players = data?.players ?? [];
  const config = data?.config ?? emptyConfig();
  const totalActive = data?.activeCount ?? 0;
  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const displayPlayers = useMemo(() => {
    const source = draftIds ? draftIds.map((id) => playersById.get(id)).filter((p): p is Player => !!p) : players;
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

  const boundaries = useMemo(() => computeGroupBoundaries(config, totalActive), [config, totalActive]);
  const teamOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of players) if (p.registeredTeam) set.add(p.registeredTeam);
    return Array.from(set).sort();
  }, [players]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    const applicants = { showTrial: filters.showTrial, showSponsoring: filters.showSponsoring };
    return displayPlayers.filter((p) => {
      if (!applicantVisible(p, applicants)) return false;
      if (filters.teams.size > 0 && !filters.teams.has(p.registeredTeam ?? '')) return false;
      if (filters.positions.size > 0 && !filters.positions.has(p.playingPosition ?? '')) return false;
      if (q) {
        const name = `${p.preferredName ?? ''} ${p.surname ?? ''} ${p.givenNames ?? ''}`.toLowerCase();
        if (!name.includes(q)) return false;
      }
      return true;
    });
  }, [displayPlayers, filters.teams, filters.positions, filters.showTrial, filters.showSponsoring, search]);

  const serverRankById = useMemo(() => new Map(players.map((p) => [p.id, p.sectionRank])), [players]);
  const modifiedCount = useMemo(() => countMoved(draftIds, serverRankById), [draftIds, serverRankById]);
  const hasChanges = modifiedCount > 0;
  const draftPending = draftIds !== null;

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
          setCurrentGroup(getGroupForRank(Number(row.getAttribute('data-rank')), boundaries));
          return;
        }
      }
    });
  }, [boundaries]);
  useEffect(() => () => { if (rafId.current) cancelAnimationFrame(rafId.current); }, []);

  const baseIds = useCallback((prev: string[] | null) => prev ?? players.map((p) => p.id), [players]);

  const reorderDraft = useCallback((sourceId: string, targetId: string, before: boolean) => {
    setDraftIds((prev) => reorderIds(baseIds(prev), sourceId, targetId, before) ?? prev);
  }, [baseIds]);

  const moveToAbsoluteRank = useCallback((id: string, rank: number) => {
    setDraftIds((prev) => moveIdToRank(baseIds(prev), id, rank));
  }, [baseIds]);

  const moveStep = useCallback((id: string, dir: 'up' | 'down') => {
    const idx = filteredPlayers.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const neighbor = dir === 'up' ? filteredPlayers[idx - 1] : filteredPlayers[idx + 1];
    if (!neighbor) return;
    reorderDraft(id, neighbor.id, dir === 'up');
  }, [filteredPlayers, reorderDraft]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const handleDragStart = useCallback((e: DragStartEvent) => setActiveDragId(String(e.active.id)), []);
  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const sourceId = String(active.id);
    const targetId = String(over.id);
    const si = filteredPlayers.findIndex((p) => p.id === sourceId);
    const ti = filteredPlayers.findIndex((p) => p.id === targetId);
    if (si === -1 || ti === -1) return;
    reorderDraft(sourceId, targetId, si > ti);
  }, [filteredPlayers, reorderDraft]);
  const handleDragCancel = useCallback(() => setActiveDragId(null), []);

  const handleSave = useCallback(async () => {
    if (!draftIds || modifiedCount === 0) return;
    try {
      const note = justification.trim() || undefined;
      await reorder.mutateAsync({ playerIds: draftIds, justification: note });
      setDraftIds(null);
      setJustification('');
      toast.success(`Ranking saved (${modifiedCount} change${modifiedCount !== 1 ? 's' : ''})`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not save the ranking');
    }
  }, [draftIds, modifiedCount, reorder, justification]);

  const handleDiscard = useCallback(() => {
    setDraftIds(null);
    setJustification('');
    queryClient.invalidateQueries({ queryKey: ['ranking'] });
  }, [queryClient]);

  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasChanges]);

  const displayPlayersRef = useRef(displayPlayers);
  displayPlayersRef.current = displayPlayers;
  const handleOpenMoveToRank = useCallback((playerId: string) => {
    setMoveToRankPlayer(displayPlayersRef.current.find((x) => x.id === playerId) ?? null);
  }, []);

  const handleMakeInactive = useCallback((playerId: string) => {
    const player = playersById.get(playerId);
    setConfirmInactive({ playerId, label: player ? nameOf(player) : 'this player' });
  }, [playersById]);

  const executeMakeInactive = useCallback(async (playerId: string, label: string) => {
    setConfirmInactive(null);
    setMutatingPlayerId(playerId);
    try {
      await deactivate.mutateAsync({ playerId });
      setDraftIds(null);
      toast.success(`${label} is inactive`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not make the player inactive');
    } finally { setMutatingPlayerId(null); }
  }, [deactivate]);

  const handleActivate = useCallback(async (entry: InactiveRankingEntry) => {
    setMutatingPlayerId(entry.id);
    try {
      await activate.mutateAsync({ playerId: entry.id });
      setDraftIds(null);
      toast.success(`${entry.preferredName ?? 'Player'} ${entry.status === 'Applicant' ? 'added to the ranking' : 'is active'}`);
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not make the player active');
    } finally { setMutatingPlayerId(null); }
  }, [activate]);

  if (ranking.isLoading) return <RankingSkeleton />;
  if (ranking.isError) {
    return (
      <div className="p-6 text-center text-danger-soft-foreground">
        Could not load the ranking: {(ranking.error as any)?.message ?? 'unknown error'}
        <div className="mt-3"><ActionButton variant="outline" onClick={() => ranking.refetch()}>Try again</ActionButton></div>
      </div>
    );
  }
  if (!data) return <RankingSkeleton />;

  const isSaving = reorder.isPending;
  const activeDragPlayer = activeDragId ? displayPlayers.find((p) => p.id === activeDragId) : null;
  const inactive = inactiveQuery.data ?? [];
  const changes = recentChangesQuery.data?.changes ?? [];
  const tabs = [
    { value: 'ranking' as const, label: `Ranking (${totalActive})` },
    { value: 'changes' as const, label: 'Recent changes' },
    { value: 'inactive' as const, label: `Inactive (${inactive.length})` },
  ];

  return (
    <div className={hasChanges ? 'pb-40 sm:pb-28' : 'pb-8'}>
      <div className="container mx-auto px-4 pt-2 flex items-end gap-2">
        <Tabs id="ranking" label="Ranking views" items={tabs} value={view} onChange={setView} className="flex-1 min-w-0" />
        {isSectionCaptain && (
          <ActionButton
            variant="ghost"
            iconOnly
            icon={<Settings2 />}
            aria-label="Ability groups"
            title="Ability groups"
            onClick={() => setShowConfig(true)}
          />
        )}
      </div>

      {view === 'ranking' && (
        <TabPanel tabsId="ranking" value="ranking">
          <RankingFilters filters={filters} onChange={setFilters} teamOptions={teamOptions} />

          {currentGroup && filteredPlayers.length > 0 && (
            <div className="sticky top-0 z-10 container mx-auto px-4">
              <div className="bg-background/95 backdrop-blur-sm border-b border-border py-1 px-2 rounded-b-lg">
                <span className="text-xs font-semibold text-muted-foreground">Ability group {currentGroup}</span>
              </div>
            </div>
          )}

          <div ref={listRef} data-rank-list onScroll={handleListScroll} className="container mx-auto px-4 pt-2 max-h-[70vh] overflow-y-auto">
            {filteredPlayers.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                No players match the filters
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
                <SortableContext items={filteredPlayers.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const p = filteredPlayers[virtualRow.index];
                      const prevPlayer = filteredPlayers[virtualRow.index - 1];
                      const currentGrp = getGroupForRank(p.sectionRank ?? 0, boundaries);
                      const prevGrp = prevPlayer ? getGroupForRank(prevPlayer.sectionRank ?? 0, boundaries) : null;
                      const showDivider = prevGrp !== null && currentGrp !== prevGrp;
                      return (
                        <div
                          key={p.id}
                          data-index={virtualRow.index}
                          ref={virtualizer.measureElement}
                          style={{
                            position: 'absolute', top: 0, left: 0, width: '100%',
                            transform: `translateY(${virtualRow.start}px)`,
                            zIndex: openMenuPlayerId === p.id ? 50 : undefined,
                          }}
                        >
                          {showDivider && <GroupDivider group={prevGrp!} />}
                          <SortableRankingRow
                            player={p}
                            isFirst={virtualRow.index === 0}
                            isLast={virtualRow.index === filteredPlayers.length - 1}
                            disabled={isSaving || mutatingPlayerId === p.id}
                            draftPending={draftPending}
                            compact={isPhone}
                            menuOpen={openMenuPlayerId === p.id}
                            onMenuOpenChange={(v) => setOpenMenuPlayerId(v ? p.id : null)}
                            onMoveStep={moveStep}
                            onOpenMoveToRank={handleOpenMoveToRank}
                            onViewStats={setStatsPlayerId}
                            onViewAttendance={setAttendancePlayerId}
                            onPhotoClick={setExpandedPhoto}
                            onMakeInactive={canSetActive ? handleMakeInactive : undefined}
                          />
                        </div>
                      );
                    })}
                  </div>
                </SortableContext>
                <DragOverlay>
                  {activeDragPlayer ? (
                    <RankingRow
                      {...NO_ROW_ACTIONS}
                      player={activeDragPlayer}
                      isFirst={false} isLast={false} disabled={false} draftPending={false} compact={false}
                      isDragging={false} menuOpen={false} onMenuOpenChange={() => {}}
                      dragHandleProps={{}}
                      style={{ opacity: 0.9, boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }}
                    />
                  ) : null}
                </DragOverlay>
              </DndContext>
            )}
          </div>
        </TabPanel>
      )}

      {view === 'changes' && (
        <TabPanel tabsId="ranking" value="changes" className="container mx-auto px-4 pt-3">
          <RecentChanges changes={changes} loading={recentChangesQuery.isLoading} />
        </TabPanel>
      )}

      {view === 'inactive' && (
        <TabPanel tabsId="ranking" value="inactive" className="container mx-auto px-4 pt-3">
          <InactiveList
            entries={inactive}
            loading={inactiveQuery.isLoading}
            onReactivate={canSetActive ? handleActivate : undefined}
            draftPending={draftPending}
            busyId={mutatingPlayerId}
          />
        </TabPanel>
      )}

      {moveToRankPlayer && (
        <MoveToRankDialog
          player={moveToRankPlayer}
          activeCount={totalActive}
          history={changes}
          onClose={() => setMoveToRankPlayer(null)}
          onSubmit={(rank) => { moveToAbsoluteRank(moveToRankPlayer.id, rank); setMoveToRankPlayer(null); }}
        />
      )}

      {showConfig && isSectionCaptain && (
        <RankingSheet title="Ability groups" onClose={() => setShowConfig(false)}>
          <AbilityGroupsSheet
            config={config}
            activeCount={totalActive}
            saving={updateConfig.isPending}
            onClose={() => setShowConfig(false)}
            onSave={async (next) => {
              try {
                await updateConfig.mutateAsync(next);
                toast.success('Ability groups saved');
                setShowConfig(false);
              } catch (err: any) {
                toast.error(err?.message ?? 'Could not save the ability groups');
              }
            }}
          />
        </RankingSheet>
      )}

      {confirmInactive && (
        <ConfirmDialog
          title="Make inactive"
          message={`Take ${confirmInactive.label} out of the ranking? They can be made active again from the Inactive tab.`}
          confirmLabel="Make inactive"
          destructive
          onConfirm={() => executeMakeInactive(confirmInactive.playerId, confirmInactive.label)}
          onCancel={() => setConfirmInactive(null)}
        />
      )}

      {/* The same season stats a player sees on their own page. */}
      <SeasonStatsSheet
        playerId={statsPlayerId}
        playerName={statsPlayerId ? nameOf(playersById.get(statsPlayerId) ?? {}) : undefined}
        onClose={() => setStatsPlayerId(null)}
      />

      {/* Past attendance and upcoming availability, fixture by fixture. */}
      <AttendanceSheet
        playerId={attendancePlayerId}
        playerName={attendancePlayerId ? nameOf(playersById.get(attendancePlayerId) ?? {}) : undefined}
        onClose={() => setAttendancePlayerId(null)}
      />

      {openMenuPlayerId !== null && <div className="fixed inset-0 z-30" onClick={() => setOpenMenuPlayerId(null)} />}

      <Sheet open={!!expandedPhoto} raised onOpenChange={(next) => !next && setExpandedPhoto(null)}>
        <div className="fixed inset-0 z-[61] bg-black/70 flex items-center justify-center p-6" onClick={() => setExpandedPhoto(null)}>
          <img src={expandedPhoto ?? undefined} alt="Player" className="max-w-full max-h-full rounded-lg shadow-2xl" />
        </div>
      </Sheet>

      {hasChanges && (
        <RankingSaveBar
          count={modifiedCount}
          note={justification}
          onNote={setJustification}
          saving={isSaving}
          onDiscard={handleDiscard}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function GroupDivider({ group }: { group: string }) {
  return (
    <div className="flex items-center gap-2 py-1" aria-hidden="true">
      <div className="h-px flex-1 bg-border" />
      <span className="text-xs font-semibold text-muted-foreground">End of {group}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

function RankingSkeleton() {
  return (
    <div className="container mx-auto px-4 py-4 space-y-3">
      <Skeleton className="h-8 w-40" />
      <div className="pt-2 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-lg" />)}
      </div>
    </div>
  );
}
