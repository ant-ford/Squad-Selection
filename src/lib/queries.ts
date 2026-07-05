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
    staleTime: Infinity, // profile doesn't change during a session
  });
}

export function useUpcomingFixtures(teamFilter?: string) {
  return useQuery({
    queryKey: ['upcomingFixtures', teamFilter],
    queryFn: () => authGet<GetUpcomingFixturesOutput>('/api/upcoming-fixtures', { team: teamFilter }),
    staleTime: 1000 * 60 * 5,
  });
}

export function usePlayersForMatch(matchId: string) {
  return useQuery({
    queryKey: ['playersForMatch', matchId],
    queryFn: () => apiGet<GetPlayersForMatchOutput>(`/api/match/${matchId}/players`),
    staleTime: 1000 * 60 * 10,
  });
}

// 30-second polling for availability exceptions ONLY (1 Airtable call instead of 5)
export function useAvailabilityPoll(matchId: string, isEnabled: boolean) {
  return useQuery({
    queryKey: ['availabilityPoll', matchId],
    queryFn: () => apiGet<{ exceptions: { playerId: string; status: string; notes: string }[] }>(`/api/match/${matchId}/availability`),
    refetchInterval: isEnabled ? 30000 : false,
    enabled: isEnabled,
  });
}

export function useBatchUpdateSquad(matchId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deltas: any[]) => {
      const user = await getCurrentSupabaseUser();
      return apiPost('/api/match/' + matchId + '/squad/batch', { 
        deltas, 
        actingEmail: user?.email 
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['playersForMatch', matchId] });
      queryClient.invalidateQueries({ queryKey: ['upcomingFixtures'] });
    }
  });
}