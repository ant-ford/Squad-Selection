import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '@/lib/apiClient';
import { getCurrentSupabaseUser } from '@/lib/auth';
import type { ProfileData } from '@/api/getMyProfile';
import type { GetUpcomingFixturesOutput } from '@/api/getUpcomingFixtures';
import type { GetPlayersForMatchOutput } from '@/api/getPlayersForMatch';

async function authGet<T>(url: string, params?: Record<string, any>): Promise<T> {
  const user = await getCurrentSupabaseUser();
  return apiGet<T>(url, { ...params, email: user?.email });
}

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
    staleTime: 0, refetchOnMount: true,
  });
}

export function usePlayersForMatch(matchId: string, side?: "home" | "away") {
  return useQuery({
    queryKey: ['playersForMatch', matchId, side], // #3 fix: include side
    queryFn: () => apiGet<GetPlayersForMatchOutput>(`/api/match/${matchId}/players`, { side }),
    staleTime: 0, refetchOnMount: true,
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