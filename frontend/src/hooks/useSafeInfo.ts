import { useQuery } from '@tanstack/react-query'
import { isAddress, type Address } from 'viem'
import { getPublicClient } from '../lib/rpc'
import { safeKeys } from '../lib/queryKeys'
import { readSafeInfo } from '../lib/safeReads'

/**
 * Safe owners/threshold/nonce/balance/version in one multicall. No polling:
 * refetch manually with `refetch()` or `queryClient.invalidateQueries({queryKey: safeKeys.info(addr)})`.
 */
export function useSafeInfo(address: string | undefined) {
  const valid = !!address && isAddress(address)
  return useQuery({
    queryKey: safeKeys.info((address ?? '0x') as Address),
    queryFn: () => readSafeInfo(getPublicClient(), address as Address),
    enabled: valid,
  })
}
