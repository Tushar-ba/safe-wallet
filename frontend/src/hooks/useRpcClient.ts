import { useSyncExternalStore } from 'react'
import type { PublicClient } from 'viem'
import { getPublicClient, getRpcVersion, subscribeRpc } from '../lib/rpc'

/** The shared viem public client; re-renders when the active RPC changes. */
export function useRpcClient(): PublicClient {
  useSyncExternalStore(subscribeRpc, getRpcVersion)
  return getPublicClient()
}
