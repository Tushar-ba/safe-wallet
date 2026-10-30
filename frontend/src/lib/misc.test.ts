import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addressUrl, txUrl } from './explorer'
import { getItem, getJSON, setItem, setJSON } from './storage'
import { isRangeError, isRateLimitError, withBackoff } from './backoff'
import { shortAddress, formatNative } from './format'
import { validateRpcUrl } from './rpc'

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

describe('explorer', () => {
  it('builds amoy polygonscan urls', () => {
    expect(txUrl('0xabc')).toBe('https://amoy.polygonscan.com/tx/0xabc')
    expect(addressUrl('0xdef')).toBe('https://amoy.polygonscan.com/address/0xdef')
  })
})

describe('storage', () => {
  it('round-trips and survives bad JSON', () => {
    setJSON('a', { x: 1 })
    expect(getJSON('a', null)).toEqual({ x: 1 })
    setItem('b', '{bad')
    expect(getJSON('b', 'fb')).toBe('fb')
    expect(getItem('missing')).toBeNull()
  })
  it('never throws when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(getItem('a')).toBeNull()
    expect(setItem('a', 'b')).toBe(false)
  })
})

describe('backoff', () => {
  it('classifies errors', () => {
    expect(isRateLimitError(new Error('HTTP request failed. Status: 429'))).toBe(true)
    expect(isRangeError(new Error('block range is too large'))).toBe(true)
    expect(isRateLimitError(new Error('execution reverted'))).toBe(false)
  })
  it('retries retryable errors then succeeds', async () => {
    let n = 0
    const sleeps: number[] = []
    const r = await withBackoff(
      async () => {
        if (++n < 3) throw new Error('429 Too Many Requests')
        return 'ok'
      },
      { sleep: async (ms) => void sleeps.push(ms), baseMs: 100 },
    )
    expect(r).toBe('ok')
    expect(n).toBe(3)
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0])
  })
  it('does not retry non-retryable errors and gives up after max retries', async () => {
    let n = 0
    await expect(withBackoff(async () => { n++; throw new Error('revert') }, { sleep: async () => {} })).rejects.toThrow('revert')
    expect(n).toBe(1)
    n = 0
    await expect(
      withBackoff(async () => { n++; throw new Error('429') }, { retries: 2, sleep: async () => {} }),
    ).rejects.toThrow('429')
    expect(n).toBe(3)
  })
})

describe('format', () => {
  it('formats', () => {
    expect(shortAddress('0x1234567890123456789012345678901234567890')).toBe('0x1234...7890')
    expect(formatNative(1_500_000_000_000_000_000n)).toBe('1.5')
    expect(formatNative(0n)).toBe('0')
  })
})

describe('validateRpcUrl', () => {
  const mk = (body: unknown, ok = true) => (async () => ({ ok, status: ok ? 200 : 500, json: async () => body })) as unknown as typeof fetch
  it('accepts chainId 80002', async () => {
    expect(await validateRpcUrl('https://x.test', mk({ result: '0x13882' }))).toEqual({ ok: true })
  })
  it('rejects wrong chain, bad url, http errors', async () => {
    const wrong = await validateRpcUrl('https://x.test', mk({ result: '0x1' }))
    expect(wrong.ok).toBe(false)
    expect((await validateRpcUrl('nope', mk({}))).ok).toBe(false)
    expect((await validateRpcUrl('https://x.test', mk({}, false))).ok).toBe(false)
  })
})
