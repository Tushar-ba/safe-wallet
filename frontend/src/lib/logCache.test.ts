import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAbiItem, type AbiEvent } from 'viem'
import { getLogsChunked, loadLogCache, saveLogCache, scanLogsCached, type AnyLog } from './logCache'

class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}
beforeEach(() => {
  vi.stubGlobal('localStorage', new MemStorage())
})

const event = parseAbiItem('event Foo(address indexed a, uint256 v)') as AbiEvent
const addr = '0x2222222222222222222222222222222222222222'
const mkLog = (block: bigint, idx = 0): AnyLog =>
  ({ blockNumber: block, logIndex: idx, transactionHash: '0xabc', args: { v: block * 10n } }) as unknown as AnyLog

describe('getLogsChunked', () => {
  it('splits the range into chunks of maxRange', async () => {
    const calls: Array<[bigint, bigint]> = []
    const client = {
      getLogs: vi.fn(async (a: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([a.fromBlock, a.toBlock])
        return [mkLog(a.fromBlock)]
      }),
    }
    const logs = await getLogsChunked({ client: client as never, address: addr, event, fromBlock: 100n, toBlock: 125n, maxRange: 10n })
    expect(calls).toEqual([[100n, 109n], [110n, 119n], [120n, 125n]])
    expect(logs).toHaveLength(3)
  })

  it('halves the range on range errors and retries rate limits with backoff', async () => {
    let n = 0
    const calls: Array<[bigint, bigint]> = []
    const client = {
      getLogs: vi.fn(async (a: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([a.fromBlock, a.toBlock])
        n++
        if (a.toBlock - a.fromBlock + 1n > 5n) throw new Error('block range is too large')
        if (n === 2) throw new Error('429 Too Many Requests')
        return []
      }),
    }
    await getLogsChunked({
      client: client as never,
      address: addr,
      event,
      fromBlock: 0n,
      toBlock: 9n,
      maxRange: 10n,
      backoff: { sleep: async () => {} },
    })
    expect(calls[0]).toEqual([0n, 9n])
    expect(calls.some(([f, t]) => f === 0n && t === 4n)).toBe(true)
    expect(calls.at(-1)![1]).toBe(9n)
  })
})

describe('cache', () => {
  it('round-trips bigint values', () => {
    saveLogCache('k', { lastBlock: 5n, logs: [mkLog(3n)] })
    const c = loadLogCache('k')!
    expect(c.lastBlock).toBe(5n)
    expect(c.logs[0].blockNumber).toBe(3n)
    expect(c.logs[0].args!.v).toBe(30n)
  })

  it('scanLogsCached only scans new blocks and merges/dedupes', async () => {
    const getLogs = vi.fn(async (a: { fromBlock: bigint; toBlock: bigint }) => [mkLog(a.fromBlock)])
    let latest = 20n
    const client = { getLogs, getBlockNumber: vi.fn(async () => latest) }
    const first = await scanLogsCached({ client: client as never, address: addr, event, cacheKey: 'safe1', startBlock: 10n, maxRange: 100n })
    expect(getLogs.mock.calls[0][0]).toMatchObject({ fromBlock: 10n, toBlock: 20n })
    expect(first.lastBlock).toBe(20n)

    latest = 30n
    const second = await scanLogsCached({ client: client as never, address: addr, event, cacheKey: 'safe1', startBlock: 10n, maxRange: 100n })
    expect(getLogs.mock.calls[1][0]).toMatchObject({ fromBlock: 21n, toBlock: 30n })
    expect(second.logs.map((l) => l.blockNumber)).toEqual([10n, 21n])

    // nothing new: no getLogs call
    await scanLogsCached({ client: client as never, address: addr, event, cacheKey: 'safe1', startBlock: 10n })
    expect(getLogs).toHaveBeenCalledTimes(2)
  })
})
