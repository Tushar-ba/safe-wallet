import { getAddress, isAddress, type Address, type PublicClient } from 'viem'
import { readSafeInfoOrNull, type SafeInfo } from '../../lib/safeReads'

export type ParseResult = { ok: true; address: Address } | { ok: false; error: string }

/** Validate the pasted text as an address (checksum enforced for mixed-case input). */
export function parseAddressInput(raw: string): ParseResult {
  const v = raw.trim()
  if (!v) return { ok: false, error: 'Paste a Safe address.' }
  if (!isAddress(v, { strict: false })) {
    return { ok: false, error: 'Not a valid address (expected 0x followed by 40 hex characters).' }
  }
  if (v !== v.toLowerCase() && !isAddress(v)) {
    return { ok: false, error: 'Invalid checksum: check the capitalisation of the address.' }
  }
  return { ok: true, address: getAddress(v) }
}

export type OpenResult = { ok: true; address: Address; info: SafeInfo } | { ok: false; error: string }

/** Parse + verify on-chain (VERSION + getOwners in one multicall via readSafeInfoOrNull). */
export async function verifySafeInput(client: PublicClient, raw: string): Promise<OpenResult> {
  const p = parseAddressInput(raw)
  if (!p.ok) return p
  let info: SafeInfo | null
  try {
    info = await readSafeInfoOrNull(client, p.address)
  } catch {
    return { ok: false, error: 'Could not reach the RPC to verify this address. Try again or switch RPC in Settings.' }
  }
  if (!info) {
    return { ok: false, error: 'This address is not a Safe on Polygon Amoy (no VERSION/owners found). Check the address and network.' }
  }
  return { ok: true, address: p.address, info }
}
