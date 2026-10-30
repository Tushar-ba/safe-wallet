import { describe, expect, it } from 'vitest'
import { buildApprovedHashSignatures } from './signatures'

const A = '0x000000000000000000000000000000000000000A'
const B = '0x00000000000000000000000000000000000000b0'
const C = '0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF'

describe('buildApprovedHashSignatures', () => {
  it('encodes 65 bytes per owner: bytes32 owner + bytes32 0 + 0x01', () => {
    const sig = buildApprovedHashSignatures([A])
    expect(sig).toBe(
      '0x' + '0'.repeat(24) + '000000000000000000000000000000000000000a' + '0'.repeat(64) + '01',
    )
    expect((sig.length - 2) / 2).toBe(65)
  })

  it('sorts ascending numerically regardless of input order or case', () => {
    const s1 = buildApprovedHashSignatures([C, A, B])
    const s2 = buildApprovedHashSignatures([B, C, A])
    expect(s1).toBe(s2)
    expect((s1.length - 2) / 2).toBe(195)
    const owners = [0, 1, 2].map((i) => '0x' + s1.slice(2 + i * 130 + 24, 2 + i * 130 + 64))
    expect(owners).toEqual([A, B, C].map((x) => x.toLowerCase()))
  })

  it('throws on duplicates (case-insensitive) and invalid addresses', () => {
    expect(() => buildApprovedHashSignatures([A, A.toLowerCase() as `0x${string}`])).toThrow(/Duplicate/)
    expect(() => buildApprovedHashSignatures(['0x123' as `0x${string}`])).toThrow(/Invalid/)
  })

  it('empty list gives 0x', () => {
    expect(buildApprovedHashSignatures([])).toBe('0x')
  })
})
