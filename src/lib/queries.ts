import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';
import type { ProfileData } from '@/api/getMyProfile';
import type { GetUpcomingFixturesOutput } from '@/api/getUpcomingFixtures';
import type { GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';
import { getRecommendations } from '@/api/getRecommendations';
import type {
  AbilityGroupConfigMap,
  InactiveRankingEntry,
  RankingList,
} from '@/generated/domainTypes';

async function authGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const user = await getCurrentSupabaseUser();
  return apiGet<T>(url, { ...params, email: user?.email });
}

// ── Profile & Fixtures ───────────────────────────────────────────────────
export function useMyProfile() {
  return useQuery({
    queryKey: ['myProfile'],
    queryFn: () => authGet<ProfileData>('/api/my-profile'),
    staleTime: Infinity,
  });
}

export function useUpcomingFixtures(teamFilter?: string) {
  return useQuery({
    queryKey: ['upcomingFixtures', teamFilter],
    queryFn: () => authGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', { team: teamFilter }),
    staleTime: 20_000,
    refetchOnMount: true,
  });
}

export function usePlayersForMatch(matchId: string, side?: "home" | "away") {
  return useQuery({
    queryKey: ['playersForMatch', matchId, side],
    queryFn: () => apiGet<GetPlayersForMatchOutput>(`/api/match/${matchId}/players`, { side }),
    staleTime: 20_000,
    refetchOnMount: true,
  });
}

export function useAvailabilityPoll(matchId: string, isEnabled: boolean) {
  return useQuery({
    queryKey: ['availabilityPoll', matchId],
    queryFn: () => apiGet<{ exceptions: { playerId: string; status: string; notes: string }[] }>(`/api/match/${matchId}/availability`),
    refetchInterval: isEnabled ? 30000 : false,
    enabled: isEnabled,
  });
}

export function useRecommendations(matchId: string, side?: "home" | "away", position?: string, enabled = true) {
  return useQuery({
    queryKey: ['recommendations', matchId, side, position],
    queryFn: () => getRecommendations(matchId, side, position),
    enabled,
    staleTime: 20_000,
  });
}

// ── Ranking ──────────────────────────────────────────────────────────────
export function useRanking() {
  return useQuery({
    queryKey: ['ranking'],
    queryFn: () => apiGet<RankingList>('/api/ranking'),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

export function useInactiveRanking() {
  return useQuery({
    queryKey: ['rankingInactive'],
    queryFn: () => apiGet<InactiveRankingEntry[]>('/api/ranking/inactive'),
    staleTime: 30_000,
  });
}

export function useAbilityGroupConfig() {
  return useQuery({
    queryKey: ['rankingConfig'],
    queryFn: () => apiGet<AbilityGroupConfigMap>('/api/ranking/config'),
    // Always refetch on mount so the config sheet never shows stale values.
    staleTime: 0,
    refetchOnMount: true,
  });
}

/**
 * Ranking mutations return the fully refreshed RankingList from the Worker,
 * so we write it straight into the cache instead of triggering a refetch.
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
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

export function useMoveRanking() {
  return useRankingMutation<{ playerId: string; newRank: number }>('/api/ranking/move');
}

export function useMoveRankingRelative() {
  return useRankingMutation<{ sourceId: string; targetId: string; position: 'above' | 'below' }>(
    '/api/ranking/move-relative',
  );
}

/** Batch reorder: sends the complete new order; server diffs & writes only changes. */
export function useReorderRanking() {
  return useRankingMutation<{ playerIds: string[] }>('/api/ranking/reorder');
}

export function useInitializeRanking() {
  return useRankingMutation<void>('/api/ranking/initialize');
}

export function useActivatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables: { playerId: string }) =>
      apiPost<RankingList>('/api/ranking/activate', variables),
    onSuccess: (data) => {
      if (data?.players) queryClient.setQueryData<RankingList>(['ranking'], data);
      queryClient.invalidateQueries({ queryKey: ['rankingInactive'] });
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
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
    },
  });
}

/**
 * Config save responds as soon as the config rows are persisted; the Worker
 * re-ranks ability badges in the background. We write the returned config
 * straight to the cache (so reopening the sheet shows fresh values) and do a
 * delayed ranking refetch to pick up the freshly recomputed badges.
 */
export function useUpdateAbilityConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: AbilityGroupConfigMap) => {
      const user = await getCurrentSupabaseUser();
      return apiPost<AbilityGroupConfigMap>('/api/ranking/config', {
        config,
        actingEmail: user?.email,
      });
    },
    onSuccess: (updatedConfig, variables) => {
      const newConfig = updatedConfig || variables;
      queryClient.setQueryData<AbilityGroupConfigMap>(['rankingConfig'], newConfig);
      queryClient.invalidateQueries({ queryKey: ['rankingConfig'] });
      queryClient.invalidateQueries({ queryKey: ['ranking'] });
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['ranking'] });
      }, 4000);
    },
  });
}