import { QueryClient } from '@tanstack/react-query';

/**
 * The app's single QueryClient, in a module rather than inline in main.tsx so
 * non-component code can reach it - specifically the sign-out path, which has
 * to drop every cached response before the next person signs in.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30,  // keep in memory for 30 mins
      retry: 1,
      refetchOnWindowFocus: false, // prevents re-fetches when coaches switch tabs
    },
  },
});
