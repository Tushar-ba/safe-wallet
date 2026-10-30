import type { Address, Hex } from 'viem'
import type { DecodedCall } from '../../lib/abi/abiForm'

/** A fully-validated transaction ready to be proposed to the registry. */
export interface TxDraft {
  to: Address
  value: bigint
  data: Hex
  /** One-line description, e.g. "transfer on 0xabc.." or "Send 1 POL to 0x..." */
  summary: string
  decoded?: DecodedCall | null
}
