import { useEffect, useState } from 'react';
import { keepPreviousData, queryOptions, useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { ProfileData } from '@/api/getMyProfile';
import type { GetUpcomingFixturesOutput } from '@/api/getUpcomingFixtures';
import type { GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';
import { getRecommendations } from '@/api/getRecommendations';
import { getMyFixtures, type GetMyFixturesOutput, type MyFixture } from '@/api/getMyFixtures';
import { setMyAvailability, setMyAvailabilityForDate } from '@/api/setMyAvailability';
import { getPlayerStats } from '@/api/getPlayerStats';
import { getPlayerAttendance } from '@/api/getPlayerAttendance';
import { getTeamAttendance } from '@/api/getTeamAttendance';
import {
  approveApplicant,
  getMembershipBoard,
  getMembershipInsights,
  getStatementBoard,
  requestReviewEmail,
  type ApproveInput,
} from '@/api/membership';
import { getChairmanDirectory } from '@/api/chairman';
import { getMyTasks } from '@/api/getMyTasks';
import { getSeasonStats } from '@/api/stats';
import { ALL_TIME_CONCURRENCY, allTimePlan } from '@/lib/allTimeStats';
import { hkDateKey } from '@shared/hkDateKey';
import type {
  AbilityGroupConfigMap,
  InactiveRankingEntry,
  RankingList,
} from '@shared/schema/domainTypes';

/** True while the browser tab is visible; used to pause background polling. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const handler = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);
  return visible;
}

// ── Profile & Fixtures ───────────────────────────────────────────────────

export function useMyProfile() {
  return useQuery({
    queryKey: ['myProfile'],
    queryFn: () => apiGet<ProfileData>('/api/my-profile'),
    staleTime: Infinity,
  });
}

// ── Stats page ───────────────────────────────────────────────────────────

/** Summaries change only when a result or card does; the Worker keeps past seasons for a month. */
const STATS_STALE_MS = 5 * 60_000;

export function useSeasonStats(season: string | null) {
  return useQuery({
    queryKey: ['seasonStats', season],
    queryFn: () => getSeasonStats(season!),
    enabled: !!season,
    staleTime: STATS_STALE_MS,
  });
}

/**
 * Every season with games, newest first, for "All time". Up to
 * ALL_TIME_CONCURRENCY seasons are requested at once (allTimeStats.ts),
 * not one after another: about 15 requests in a row became about four
 * rounds. History ends after two empty seasons in a row (a single empty one
 * can be a gap).
 */
export function useAllSeasonStats(seasons: string[], enabled: boolean) {
  // How many seasons, from the newest, may be requested: it grows as they load.
  const [reach, setReach] = useState(() => Math.min(seasons.length, ALL_TIME_CONCURRENCY));
  const results = useQueries({
    queries: seasons.map((season, i) => ({
      queryKey: ['seasonStats', season],
      queryFn: () => getSeasonStats(season),
      enabled: enabled && i < reach,
      staleTime: STATS_STALE_MS,
    })),
  });
  const plan = allTimePlan(results.map((r) => r.data?.matches));
  const next = plan.done ? plan.counted : plan.fetchUpTo;
  useEffect(() => {
    if (enabled && next !== reach) setReach(next);
  }, [enabled, next, reach]);
  const loaded = results.slice(0, plan.counted).map((r) => r.data);
  const summaries = loaded.filter((d): d is NonNullable<typeof d> => !!d && d.matches > 0);
  return {
    summaries,
    done: plan.done,
    loadedCount: results.filter((r) => r.data).length,
    isError: results.slice(0, Math.max(reach, plan.counted)).some((r) => r.isError),
  };
}

/**
 * Forms the member still owes (the player-page banner). Unlike the rest of
 * the app this refetches when the tab regains focus: the member has usually
 * just come back from filling the form in.
 */
export const myTasksQuery = queryOptions({
  queryKey: ['myTasks'],
  queryFn: getMyTasks,
  staleTime: 60_000,
  refetchOnWindowFocus: true,
});

export function useMyTasks() {
  return useQuery(myTasksQuery);
}

export function useUpcomingFixtures(teamFilter?: string, includePast = false) {
  return useQuery({
    // includePast is part of the key: the two responses hold different
    // fixtures, so they must not share a cache entry.
    queryKey: ['upcomingFixtures', teamFilter, includePast],
    queryFn: () =>
      apiGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', {
        team: teamFilter,
        // Played matches are a separate Airtable read, so they are requested
        // only while the coach is actually looking at past fixtures.
        past: includePast ? '1' : undefined,
      }),
    // Flipping the past toggle keeps the current list on screen while the
    // other variant loads, instead of dropping back to the skeleton.
    placeholderData: keepPreviousData,
    staleTime: 300_000,
  });
}

export function usePlayersForMatch(matchId: string, side?: "home" | "away") {
  return useQuery({
    queryKey: ['playersForMatch', matchId, side],
    // With the recommendation order, so the squad screen needs no second request.
    queryFn: () => apiGet<GetPlayersForMatchOutput>(`/api/match/${matchId}/players`, { side, recommendations: '1' }),
    staleTime: 300_000,
  });
}

export interface TeamAvailabilityRow {
  id: string;
  name: string;
  shirtNo: string;
  position: string;
  status: string;
}

export interface TeamAvailability {
  matchId: string;
  team: string;
  targetSquadSize: number;
  selected: TeamAvailabilityRow[];
  restOfTeam: TeamAvailabilityRow[];
  suggestions: TeamAvailabilityRow[];
}

/** Player-facing: the selected squad, the rest of the side, and the top five from elsewhere. */
export function useTeamAvailability(matchId: string, side: 'home' | 'away') {
  return useQuery({
    queryKey: ['teamAvailability', matchId, side],
    queryFn: () => apiGet<TeamAvailability>(`/api/match/${matchId}/team-availability`, { side }),
    staleTime: 30_000,
  });
}

export function usePlayerStats(playerId: string) {
  return useQuery({
    queryKey: ['playerStats', playerId],
    queryFn: () => getPlayerStats(playerId),
    enabled: !!playerId,
    staleTime: 60_000,
  });
}

export function usePlayerAttendance(playerId: string) {
  return useQuery({
    queryKey: ['playerAttendance', playerId],
    queryFn: () => getPlayerAttendance(playerId),
    enabled: !!playerId,
    staleTime: 60_000,
  });
}

export function useTeamAttendance() {
  return useQuery({
    queryKey: ['teamAttendance'],
    queryFn: getTeamAttendance,
    staleTime: 60_000,
  });
}

export function useAvailabilityPoll(matchId: string, isEnabled: boolean) {
  const isVisible = useDocumentVisible();
  return useQuery({
    queryKey: ['availabilityPoll', matchId],
    queryFn: () => apiGet<{ exceptions: { playerId: string; status: string; notes: string }[] }>(`/api/match/${matchId}/availability`),
    refetchInterval: isEnabled && isVisible ? 30000 : false,
    enabled: isEnabled,
  });
}

// ── Player dashboard ─────────────────────────────────────────────────────

export const myFixturesQuery = (includePast = false) =>
  queryOptions({
    // The flag is part of the key: the two responses differ, so they must not
    // share an entry. Every write below matches on the ['myFixtures'] PREFIX
    // rather than an exact key, so an optimistic patch still reaches whichever
    // variant is on screen.
    queryKey: ['myFixtures', includePast],
    queryFn: () => getMyFixtures(includePast),
    staleTime: 60_000,
  });

export function useMyFixtures(includePast = false) {
  return useQuery(myFixturesQuery(includePast));
}

/** Patch one fixture, by id, across all three sections of the cached dashboard data. */
function patchFixture(
  data: GetMyFixturesOutput | undefined,
  fixtureId: string,
  patch: Partial<MyFixture>,
): GetMyFixturesOutput | undefined {
  if (!data) return data;
  const upd = (f: MyFixture) => (f.id === fixtureId ? { ...f, ...patch } : f);
  return {
    ...data,
    fixtures: data.fixtures.map(upd),
    playUpOpportunities: data.playUpOpportunities?.map(upd),
    supportFixtures: data.supportFixtures?.map(upd),
  };
}

/** Patch every fixture on `date` (HKT date key), across all three sections. */
function patchFixturesForDate(
  data: GetMyFixturesOutput | undefined,
  date: string,
  patch: (f: MyFixture) => MyFixture,
): GetMyFixturesOutput | undefined {
  if (!data) return data;
  const upd = (f: MyFixture) => (hkDateKey(f.date) === date ? patch(f) : f);
  return {
    ...data,
    fixtures: data.fixtures.map(upd),
    playUpOpportunities: data.playUpOpportunities?.map(upd),
    supportFixtures: data.supportFixtures?.map(upd),
  };
}

/**
 * Single-fixture availability. Optimistic: the tapped status shows
 * immediately, and a failure rolls back to the pre-tap snapshot.
 *
 * The write always replaces the note, so `notes` is what the fixture should
 * carry afterwards: pass the current note to keep it, leave it out to clear.
 */
export function useQuickAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fixtureId, status, notes }: { fixtureId: string; status: 'Available' | 'Maybe' | 'Unavailable'; notes?: string }) =>
      setMyAvailability(fixtureId, status, notes),
    onMutate: async ({ fixtureId, status, notes }) => {
      await queryClient.cancelQueries({ queryKey: ['myFixtures'] });
      const previousData = queryClient.getQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] });
      // An answer for this fixture replaces whatever a preference said, so
      // the card's "pref." tag goes with it.
      queryClient.setQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] }, (old) =>
        patchFixture(old, fixtureId, { availabilityStatus: status, playerNotes: notes ?? '', availabilityFromRule: false }),
      );
      return { previousData };
    },
    onSuccess: (result, { fixtureId }) => {
      queryClient.setQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] }, (old) =>
        patchFixture(old, fixtureId, { availabilityExceptionId: result.exceptionId || '' }),
      );
      // The fixture sheet lists this player too.
      queryClient.invalidateQueries({ queryKey: ['teamAvailability', fixtureId] });
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.previousData ?? []) queryClient.setQueryData(key, data);
    },
  });
}

/**
 * Date-level bulk availability (the goalkeeper/multi-fixture-day shortcut).
 * Optimistic across every fixture on that date at once; a failure rolls
 * back the whole snapshot.
 */
export function useBulkAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ date, status }: { date: string; status: 'Available' | 'Maybe' | 'Unavailable' }) =>
      setMyAvailabilityForDate(date, status),
    onMutate: async ({ date, status }) => {
      await queryClient.cancelQueries({ queryKey: ['myFixtures'] });
      const previousData = queryClient.getQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] });
      queryClient.setQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] }, (old) =>
        patchFixturesForDate(old, date, (f) => ({ ...f, availabilityStatus: status, availabilityFromRule: false })),
      );
      return { previousData };
    },
    onSuccess: (result, { date, status }) => {
      queryClient.setQueriesData<GetMyFixturesOutput>({ queryKey: ['myFixtures'] }, (old) =>
        patchFixturesForDate(old, date, (f) => {
          const r = result.results.find((x) => x.matchId === f.id);
          return { ...f, availabilityStatus: status, availabilityExceptionId: r?.exceptionId || f.availabilityExceptionId };
        }),
      );
      queryClient.invalidateQueries({ queryKey: ['teamAvailability'] });
    },
    onError: (_err, _vars, context) => {
      for (const [key, data] of context?.previousData ?? []) queryClient.setQueryData(key, data);
    },
  });
}

export function useRecommendations(
  matchId: string,
  side?: "home" | "away",
  position?: string,
  limit?: number,
  enabled = true,
  includeSelected = false,
) {
  return useQuery({
    queryKey: ['recommendations', matchId, side, position, limit, includeSelected],
    queryFn: () => getRecommendations(matchId, side, position, limit, includeSelected),
    enabled,
    staleTime: 300_000,
  });
}

// ── Ranking ──────────────────────────────────────────────────────────────

export function useRanking() {
  return useQuery({
    queryKey: ['ranking'],
    queryFn: () => apiGet<RankingList>('/api/ranking'),
    // Section Captains expect prompt updates.
    staleTime: 15_000,
  });
}

export function useInactiveRanking() {
  return useQuery({
    queryKey: ['rankingInactive'],
    queryFn: () => apiGet<InactiveRankingEntry[]>('/api/ranking/inactive'),
    staleTime: 60_000,
  });
}

/**
 * Ranking mutations return the fully refreshed RankingList from the Worker,
 * so we write it straight into the cache instead of triggering a refetch.
 * The Worker derives the acting user from the session for audit logging.
 */
function useRankingMutation<TVariables>(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: TVariables) => apiPost<RankingList>(url, variables),
    onSuccess: (data) => {
      if (data?.players) {
        queryClient.setQueryData<RankingList>(['ranking'], data);
      } else {
        queryClient.invalidateQueries({ queryKey: ['ranking'] });
      }
      // Every ranking mutation writes a Ranking Event - refresh the
      // Recent Ranking Changes list immediately (spec S8).
      queryClient.invalidateQueries({ queryKey: ['recentChanges'] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

export function useReorderRanking() {
  return useRankingMutation<{ playerIds: string[]; justification?: string }>(
    '/api/ranking/reorder',
  );
}

export function useActivatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { playerId: string }) =>
      apiPost<RankingList>('/api/ranking/activate', variables),
    onSuccess: (data) => {
      if (data?.players) queryClient.setQueryData<RankingList>(['ranking'], data);
      queryClient.invalidateQueries({ queryKey: ['rankingInactive'] });
      queryClient.invalidateQueries({ queryKey: ['recentChanges'] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

/** Section Captains only (the Worker checks): takes a player out of the ranking. */
export function useDeactivatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { playerId: string }) =>
      apiPost<RankingList>('/api/ranking/deactivate', variables),
    onSuccess: (data) => {
      if (data?.players) queryClient.setQueryData<RankingList>(['ranking'], data);
      queryClient.invalidateQueries({ queryKey: ['rankingInactive'] });
      queryClient.invalidateQueries({ queryKey: ['recentChanges'] });
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

/**
 * Config save now waits synchronously for the Worker to recompute ability 
 * badges and returns the fully updated RankingList. No polling required!
 */
export function useUpdateAbilityConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: AbilityGroupConfigMap) =>
      apiPost<RankingList>('/api/ranking/config', { config }),
    onSuccess: (updatedRankingList) => {
      // Update ranking cache directly with the fully consistent response
      // (config is embedded in it - no separate config cache to update).
      if (updatedRankingList.players) {
        queryClient.setQueryData<RankingList>(['ranking'], updatedRankingList);
      } else {
        queryClient.invalidateQueries({ queryKey: ['ranking'] });
      }
    },
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────
/** A persisted Section Rank change (see worker/src/rankingEvents.ts). */
export interface RankingChange {
  id: string;
  playerId: string;
  kind: string;
  playerName: string;
  actorName: string;
  oldRank: number | null;
  newRank: number | null;
  note: string;
  at: string;
}

export function useRecentChanges(days = 7) {
  return useQuery({
    queryKey: ['recentChanges', days],
    queryFn: () => apiGet<{ changes: RankingChange[] }>('/api/recent-changes', { days }),
    staleTime: 60_000,
  });
}
// ── Membership section ───────────────────────────────────────────────────

export function useMembershipBoard(enabled = true) {
  return useQuery({
    queryKey: ['membershipBoard'],
    queryFn: getMembershipBoard,
    // Off until the profile says this person may see it, so nobody else
    // sends a request that can only come back 403.
    enabled,
    // The Worker caches the board for five minutes and drops it on any
    // People change, so refetching more often than this buys nothing.
    staleTime: 60_000,
  });
}

export function useMembershipInsights() {
  return useQuery({
    queryKey: ['membershipInsights'],
    queryFn: getMembershipInsights,
    staleTime: 60_000,
  });
}

export function useApproveApplicant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ApproveInput) => approveApplicant(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['membershipBoard'] });
      queryClient.invalidateQueries({ queryKey: ['membershipInsights'] });
      // Status and stage also feed the ranking lists.
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

export function useStatementBoard(enabled = true) {
  return useQuery({
    queryKey: ['statementBoard'],
    queryFn: getStatementBoard,
    enabled,
    // Cached five minutes on the Worker and dropped on any Commitments edit.
    staleTime: 60_000,
  });
}

export function useRequestReviewEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commitmentId: string) => requestReviewEmail(commitmentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['statementBoard'] }),
  });
}

// ── Chairman's section ───────────────────────────────────────────────────

export function useChairmanDirectory(enabled = true) {
  return useQuery({
    queryKey: ['chairmanDirectory'],
    queryFn: getChairmanDirectory,
    enabled,
    // Cached five minutes on the Worker and dropped on any People edit.
    staleTime: 60_000,
  });
}
