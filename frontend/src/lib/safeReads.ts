import { decodeFunctionResult, encodeFunctionData, type Address, type PublicClient } from 'viem'
import { multicall3Abi, safeAbi } from './abis'
import { deployments } from '../config/deployments'

export interface SafeInfo {
  address: Address
  owners: Address[]
  threshold: number
  nonce: bigint
  /** native balance (wei) */
  balance: bigint
  version: string
}

/**
 * Reads owners, threshold, nonce, VERSION (+ native balance) in ONE Multicall3.aggregate3
 * call with allowFailure. Returns null if the address is not a Safe
 * (VERSION/getOwners/getThreshold failed or empty owner list).
 */
export async function readSafeInfoOrNull(client: PublicClient, safe: Address): Promise<SafeInfo | null> {
  const mc = deployments.multicall3 as Address
  const enc = (functionName: 'getOwners' | 'getThreshold' | 'nonce' | 'VERSION') => ({
    target: safe,
    allowFailure: true,
    callData: encodeFunctionData({ abi: safeAbi, functionName }),
  })
  const results = await client.readContract({
    address: mc,
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [
      [
        enc('getOwners'),
        enc('getThreshold'),
        enc('nonce'),
        enc('VERSION'),
        {
          target: mc,
          allowFailure: true,
          callData: encodeFunctionData({ abi: multicall3Abi, functionName: 'getEthBalance', args: [safe] }),
        },
      ],
    ],
  })
  const [owners, threshold, nonce, version, balance] = results
  if (!owners.success || !threshold.success || !version.success) return null
  try {
    const o = decodeFunctionResult({ abi: safeAbi, functionName: 'getOwners', data: owners.returnData })
    const t = decodeFunctionResult({ abi: safeAbi, functionName: 'getThreshold', data: threshold.returnData })
    const v = decodeFunctionResult({ abi: safeAbi, functionName: 'VERSION', data: version.returnData })
    if (o.length === 0 || t === 0n) return null
    const n = nonce.success ? decodeFunctionResult({ abi: safeAbi, functionName: 'nonce', data: nonce.returnData }) : 0n
    const b = balance.success
      ? decodeFunctionResult({ abi: multicall3Abi, functionName: 'getEthBalance', data: balance.returnData })
      : 0n
    return { address: safe, owners: [...o], threshold: Number(t), nonce: n, balance: b, version: v }
  } catch {
    return null // garbage return data: not a Safe
  }
}

/** Like readSafeInfoOrNull but throws if the address is not a Safe. */
export async function readSafeInfo(client: PublicClient, safe: Address): Promise<SafeInfo> {
  const info = await readSafeInfoOrNull(client, safe)
  if (!info) throw new Error('This address is not a Safe.')
  return info
}

/** True if the address responds like a Safe (one multicall). */
export async function isSafe(client: PublicClient, address: Address): Promise<boolean> {
  return (await readSafeInfoOrNull(client, address)) !== null
}
