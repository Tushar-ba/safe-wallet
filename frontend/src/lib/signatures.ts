import { concat, getAddress, isAddress, pad, type Address, type Hex } from 'viem'

/**
 * Build Safe "approved hash" signatures (v = 1): per owner
 * bytes32(owner left-padded) + bytes32(0) + 0x01 (65 bytes each),
 * sorted by owner address ascending (numeric). Throws on duplicates / bad addresses.
 */
export function buildApprovedHashSignatures(owners: readonly Address[]): Hex {
  const seen = new Set<string>()
  const normalized = owners.map((o) => {
    if (!isAddress(o, { strict: false })) throw new Error(`Invalid owner address: ${o}`)
    const a = getAddress(o)
    const k = a.toLowerCase()
    if (seen.has(k)) throw new Error(`Duplicate owner in signatures: ${a}`)
    seen.add(k)
    return a
  })
  normalized.sort((a, b) => {
    const x = BigInt(a)
    const y = BigInt(b)
    return x < y ? -1 : x > y ? 1 : 0
  })
  if (normalized.length === 0) return '0x'
  const parts: Hex[] = normalized.flatMap((o) => [
    pad(o.toLowerCase() as Address, { size: 32 }),
    pad('0x', { size: 32 }),
    '0x01' as Hex,
  ])
  return concat(parts)
}
