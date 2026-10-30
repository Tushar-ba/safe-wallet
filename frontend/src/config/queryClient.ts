import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { isRetryableRpcError } from '../lib/backoff'
import { reportRpcError, reportRpcOk } from '../lib/rpc'

/**
 * No polling anywhere: no refetchInterval, no refetch on focus/reconnect.
 * Rate limits / transport errors are retried with exponential backoff (max 3 retries).
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => reportRpcError(err),
    onSuccess: () => reportRpcOk(),
  }),
  mutationCache: new MutationCache(),
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: (count, err) => count < 3 && isRetryableRpcError(err),
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
})
