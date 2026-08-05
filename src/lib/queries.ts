import { useEffect, useState } from 'react';
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
    queryFn: () => authGet<ProfileData>('/api/my-profile'),
    staleTime: Infinity,
  });
}

export function useUpcomingFixtures(teamFilter?: string) {
  return useQuery({
    queryKey: ['upcomingFixtures', teamFilter],
    queryFn: () => authGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', { team: teamFilter }),
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

export function useAvailabilityPoll(matchId: string, isEnabled: boolean) {
  const isVisible = useDocumentVisible();
  return useQuery({
    queryKey: ['availabilityPoll', matchId],
    queryFn: () => apiGet<{ exceptions: { playerId: string; status: string; notes: string }[] }>(`/api/match/${matchId}/availability`),
    refetchInterval: isEnabled && isVisible ? 30000 : false,
    enabled: isEnabled,
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
    // Reverted to 15s per ChatGPT feedback: Section Captains expect prompt updates
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

export function useAbilityGroupConfig() {
  return useQuery({
    queryKey: ['rankingConfig'],
    queryFn: () => apiGet<AbilityGroupConfigMap>('/api/ranking/config'),
    staleTime: 0,
    refetchOnMount: true,
  });
}

/**
 * Ranking mutations return the fully refreshed RankingList from the Worker,
 * so we write it straight into the cache instead of triggering a refetch.
 * Automatically injects the acting user's email for audit logging.
 */
function useRankingMutation<TVariables>(url: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: TVariables) => {
      const user = await getCurrentSupabaseUser();
      return apiPost<RankingList>(url, { ...variables, actingEmail: user?.email });
    },
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

export function useReorderRanking() {
  return useRankingMutation<{ playerIds: string[] }>('/api/ranking/reorder');
}

export function useInitializeRanking() {
  return useRankingMutation<void>('/api/ranking/initialize');
}

export function useActivatePlayer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (variables: { playerId: string }) => {
      const user = await getCurrentSupabaseUser();
      return apiPost<RankingList>('/api/ranking/activate', { ...variables, actingEmail: user?.email });
    },
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
    mutationFn: async (variables: { playerId: string }) => {
      const user = await getCurrentSupabaseUser();
      return apiPost<RankingList>('/api/ranking/deactivate', { ...variables, actingEmail: user?.email });
    },
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
 * Config save now waits synchronously for the Worker to recompute ability 
 * badges and returns the fully updated RankingList. No polling required!
 */
export function useUpdateAbilityConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (config: AbilityGroupConfigMap) => {
      const user = await getCurrentSupabaseUser();
      return apiPost<RankingList>('/api/ranking/config', {
        config,
        actingEmail: user?.email,
      });
    },
    onSuccess: (updatedRankingList) => {
      // Update config cache
      if (updatedRankingList.config) {
        queryClient.setQueryData<AbilityGroupConfigMap>(['rankingConfig'], updatedRankingList.config);
      }
      // Update ranking cache directly with the fully consistent response
      if (updatedRankingList.players) {
        queryClient.setQueryData<RankingList>(['ranking'], updatedRankingList);
      } else {
        queryClient.invalidateQueries({ queryKey: ['ranking'] });
      }
    },
  });
}