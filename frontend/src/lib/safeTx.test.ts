import { describe, expect, it } from 'vitest'
import { keccak256, toBytes } from 'viem'
import {
  computeSafeTxHash,
  computeSafeTxHashManual,
  SAFE_TX_TYPEHASH,
  DOMAIN_SEPARATOR_TYPEHASH,
  SAFE_TX_TYPE_STRING,
} from './safeTx'

const safe = '0x1111111111111111111111111111111111111111'
const tx = { to: '0x2222222222222222222222222222222222222222', value: 123n, data: '0xdeadbeef', nonce: 7 } as const

describe('safeTx', () => {
  it('type hashes match Safe v1.4.1 constants', () => {
    expect(SAFE_TX_TYPEHASH).toBe('0xbb8310d486368db6bd6f849402fdd73ad53d316b5a4b2644ad6efe0f941286d8')
    expect(DOMAIN_SEPARATOR_TYPEHASH).toBe('0x47e79534a245952e8b16893a336b85a3d9ea9fa8c573f3d803afb92a79469218')
    expect(SAFE_TX_TYPEHASH).toBe(keccak256(toBytes(SAFE_TX_TYPE_STRING)))
  })

  it('typed-data hash equals manual getTransactionHash semantics', () => {
    for (const t of [
      { ...tx, nonce: 7n },
      { ...tx, data: '0x' as const, value: 0n, nonce: 0n },
    ]) {
      expect(computeSafeTxHash(safe, t)).toBe(computeSafeTxHashManual(safe, t))
    }
  })

  it('hash depends on safe, chain, nonce and fields', () => {
    const base = { ...tx, nonce: 7n }
    const h = computeSafeTxHash(safe, base)
    expect(h).toMatch(/^0x[0-9a-f]{64}$/)
    expect(computeSafeTxHash(safe, { ...base, nonce: 8n })).not.toBe(h)
    expect(computeSafeTxHash('0x3333333333333333333333333333333333333333', base)).not.toBe(h)
    expect(computeSafeTxHash(safe, base, 1)).not.toBe(h)
    expect(computeSafeTxHash(safe, { ...base, value: 1n })).not.toBe(h)
  })
})
