import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/apiClient';
import type { ProfileData } from '@/api/getMyProfile';
import type { GetUpcomingFixturesOutput } from '@/api/getUpcomingFixtures';
import type { GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';
import { getRecommendations } from '@/api/getRecommendations';
import { getMyFixtures, type GetMyFixturesOutput, type MyFixture } from '@/api/getMyFixtures';
import { setMyAvailability, setMyAvailabilityForDate } from '@/api/setMyAvailability';
import { getPlayerStats } from '@/api/getPlayerStats';
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

export function useUpcomingFixtures(teamFilter?: string) {
  return useQuery({
    queryKey: ['upcomingFixtures', teamFilter],
    queryFn: () => apiGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', { team: teamFilter }),
    staleTime: 300_000,
  });
}

export function usePlayersForMatch(matchId: string, side?: "home" | "away") {
  return useQuery({
    queryKey: ['playersForMatch', matchId, side],
    queryFn: () => apiGet<GetPlayersForMatchOutput>(`/api/match/${matchId}/players`, { side }),
    staleTime: 300_000,
  });
}

export function useMatchSquad(matchId: string, side: 'home' | 'away') {
  return useQuery({
    queryKey: ['matchSquad', matchId, side],
    queryFn: () => apiGet<{ players: { name: string; position: string }[] }>(`/api/match/${matchId}/squad`, { side }),
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

export function useMyFixtures() {
  return useQuery({
    queryKey: ['myFixtures'],
    queryFn: () => getMyFixtures(),
    staleTime: 60_000,
  });
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
 */
export function useQuickAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fixtureId, status }: { fixtureId: string; status: 'Available' | 'Maybe' | 'Unavailable' }) =>
      setMyAvailability(fixtureId, status),
    onMutate: async ({ fixtureId, status }) => {
      await queryClient.cancelQueries({ queryKey: ['myFixtures'] });
      const previousData = queryClient.getQueryData<GetMyFixturesOutput>(['myFixtures']);
      queryClient.setQueryData<GetMyFixturesOutput>(['myFixtures'], (old) =>
        patchFixture(old, fixtureId, { availabilityStatus: status }),
      );
      return { previousData };
    },
    onSuccess: (result, { fixtureId }) => {
      queryClient.setQueryData<GetMyFixturesOutput>(['myFixtures'], (old) =>
        patchFixture(old, fixtureId, { availabilityExceptionId: result.exceptionId || '' }),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) queryClient.setQueryData(['myFixtures'], context.previousData);
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
      const previousData = queryClient.getQueryData<GetMyFixturesOutput>(['myFixtures']);
      queryClient.setQueryData<GetMyFixturesOutput>(['myFixtures'], (old) =>
        patchFixturesForDate(old, date, (f) => ({ ...f, availabilityStatus: status })),
      );
      return { previousData };
    },
    onSuccess: (result, { date, status }) => {
      queryClient.setQueryData<GetMyFixturesOutput>(['myFixtures'], (old) =>
        patchFixturesForDate(old, date, (f) => {
          const r = result.results.find((x) => x.matchId === f.id);
          return { ...f, availabilityStatus: status, availabilityExceptionId: r?.exceptionId || f.availabilityExceptionId };
        }),
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previousData) queryClient.setQueryData(['myFixtures'], context.previousData);
    },
  });
}

export function useRecommendations(matchId: string, side?: "home" | "away", position?: string, enabled = true) {
  return useQuery({
    queryKey: ['recommendations', matchId, side, position],
    queryFn: () => getRecommendations(matchId, side, position),
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
export interface PlayUpWatchEntry { id: string; name: string; registeredTeam: string; playUpCount: number }

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

export function usePlayUpWatch() {
  return useQuery({
    queryKey: ['playUpWatch'],
    queryFn: () => apiGet<{ season: string; watch: PlayUpWatchEntry[] }>('/api/playup-watch'),
    staleTime: 300_000,
  });
}

export function useRecentChanges(days = 7) {
  return useQuery({
    queryKey: ['recentChanges', days],
    queryFn: () => apiGet<{ changes: RankingChange[] }>('/api/recent-changes', { days }),
    staleTime: 60_000,
  });
}