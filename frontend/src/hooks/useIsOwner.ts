import { useAccount } from 'wagmi'
import { useSafeInfo } from './useSafeInfo'

/** Whether the connected wallet is an owner of the given Safe (derived from useSafeInfo, no extra RPC). */
export function useIsOwner(safe: string | undefined) {
  const { address: account, isConnected } = useAccount()
  const info = useSafeInfo(safe)
  const isOwner =
    isConnected && !!account && !!info.data && info.data.owners.some((o) => o.toLowerCase() === account.toLowerCase())
  return { isOwner, isConnected, account, isLoading: info.isLoading }
}
