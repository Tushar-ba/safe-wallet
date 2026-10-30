import { describe, expect, it, vi } from 'vitest'
import { encodeFunctionResult, getAddress, type PublicClient } from 'viem'
import { multicall3Abi, safeAbi } from './abis'
import { readSafeInfoOrNull, readSafeInfo, isSafe } from './safeReads'

const safe = '0x1111111111111111111111111111111111111111'
const o1 = '0x00000000000000000000000000000000000000a1'
const o2 = '0x00000000000000000000000000000000000000a2'

const ok = (returnData: `0x${string}`) => ({ success: true, returnData })
const fail = { success: false, returnData: '0x' as const }

function clientReturning(results: unknown[]) {
  const readContract = vi.fn(async () => results)
  return { client: { readContract } as unknown as PublicClient, readContract }
}

describe('safeReads', () => {
  it('decodes a Safe in ONE multicall', async () => {
    const { client, readContract } = clientReturning([
      ok(encodeFunctionResult({ abi: safeAbi, functionName: 'getOwners', result: [o1, o2] })),
      ok(encodeFunctionResult({ abi: safeAbi, functionName: 'getThreshold', result: 2n })),
      ok(encodeFunctionResult({ abi: safeAbi, functionName: 'nonce', result: 5n })),
      ok(encodeFunctionResult({ abi: safeAbi, functionName: 'VERSION', result: '1.4.1' })),
      ok(encodeFunctionResult({ abi: multicall3Abi, functionName: 'getEthBalance', result: 10n ** 18n })),
    ])
    const info = await readSafeInfo(client, safe)
    expect(readContract).toHaveBeenCalledTimes(1)
    expect(info).toEqual({ address: safe, owners: [getAddress(o1), getAddress(o2)], threshold: 2, nonce: 5n, balance: 10n ** 18n, version: '1.4.1' })
    expect(await isSafe(client, safe)).toBe(true)
  })

  it('returns null / throws for non-Safes', async () => {
    const { client } = clientReturning([fail, fail, fail, fail, ok('0x')])
    expect(await readSafeInfoOrNull(client, safe)).toBeNull()
    await expect(readSafeInfo(client, safe)).rejects.toThrow(/not a Safe/)
    const garbage = clientReturning([ok('0x1234'), ok('0x1234'), ok('0x1234'), ok('0x1234'), ok('0x')])
    expect(await readSafeInfoOrNull(garbage.client, safe)).toBeNull()
  })
})
