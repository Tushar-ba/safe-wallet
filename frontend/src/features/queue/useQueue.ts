import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { decodeFunctionResult, encodeFunctionData, zeroAddress, type Address, type Hex } from 'viem'
import { deployments } from '../../config/deployments'
import { multicall3Abi, safeAbi, txProposalRegistryAbi } from '../../lib/abis'
import { scanLogsCached, type AnyLog } from '../../lib/logCache'
import { safeKeys } from '../../lib/queryKeys'
import { useRpcClient } from '../../hooks/useRpcClient'
import { useSafeInfo } from '../../hooks/useSafeInfo'
import { groupByNonce, parseProposals, type Proposal } from './queueLogic'

export const registryDeployed = deployments.txProposalRegistry.toLowerCase() !== zeroAddress

const proposedEvent = txProposalRegistryAbi.find((x) => x.type === 'event' && x.name === 'Proposed')!

/** Proposed logs for this Safe (indexed on `safe`), chunked + cached per Safe in localStorage. */
export function useProposedLogs(safe: Address) {
  const client = useRpcClient()
  return useQuery({
    queryKey: [...safeKeys.queue(safe), 'logs'],
    enabled: registryDeployed,
    queryFn: async (): Promise<AnyLog[]> => {
      const entry = await scanLogsCached({
        client,
        address: deployments.txProposalRegistry as Address,
        event: proposedEvent,
        args: { safe },
        cacheKey: `${safe.toLowerCase()}:proposed`,
        startBlock: BigInt(deployments.registryDeployBlock),
      })
      return entry.logs
    },
  })
}

/** approvedHashes(owner, hash) for every owner x proposal in ONE multicall. */
export function useVotes(safe: Address, owners: readonly Address[] | undefined, hashes: readonly Hex[]) {
  const client = useRpcClient()
  const sig = hashes.join(',')
  const ownersSig = owners?.join(',') ?? ''
  return useQuery({
    queryKey: [...safeKeys.votes(safe), sig, ownersSig],
    enabled: !!owners && owners.length > 0 && hashes.length > 0,
    queryFn: async (): Promise<Record<string, Record<string, bigint>>> => {
      const os = owners as readonly Address[]
      const calls = hashes.flatMap((h) =>
        os.map((o) => ({
          target: safe,
          allowFailure: true,
          callData: encodeFunctionData({ abi: safeAbi, functionName: 'approvedHashes', args: [o, h] }),
        })),
      )
      const res = await client.readContract({
        address: deployments.multicall3 as Address,
        abi: multicall3Abi,
        functionName: 'aggregate3',
        args: [calls],
      })
      const out: Record<string, Record<string, bigint>> = {}
      let i = 0
      for (const h of hashes) {
        const per: Record<string, bigint> = {}
        for (const o of os) {
          const r = res[i++]
          per[o.toLowerCase()] = r.success
            ? decodeFunctionResult({ abi: safeAbi, functionName: 'approvedHashes', data: r.returnData })
            : 0n
        }
        out[h.toLowerCase()] = per
      }
      return out
    },
  })
}

const EMPTY: Proposal[] = []

export function useQueueData(safe: Address) {
  const info = useSafeInfo(safe)
  const logs = useProposedLogs(safe)
  const parsed = useMemo(() => {
    if (!info.data || !logs.data) return null
    return parseProposals(logs.data, safe, info.data.nonce)
  }, [info.data, logs.data, safe])
  const proposals: Proposal[] = parsed?.proposals ?? EMPTY
  const groups = useMemo(() => groupByNonce(proposals), [proposals])
  const votes = useVotes(
    safe,
    info.data?.owners,
    proposals.map((p) => p.safeTxHash),
  )
  return { info, logs, votes, proposals, groups, flagged: parsed?.flagged ?? [] }
}
