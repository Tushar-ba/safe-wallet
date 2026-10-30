import { decodeFunctionData, encodeFunctionData, getAddress, isAddress, parseEventLogs, zeroAddress, type Address, type Hex, type TransactionReceipt } from 'viem'
import { safeAbi, safeProxyFactoryAbi } from '../../lib/abis'

export interface OwnersValidation {
  /** error message per row index (only rows with problems) */
  rowErrors: Record<number, string>
  thresholdError?: string
  /** true when the form can be submitted */
  valid: boolean
}

export function validateSafeSetup(ownerInputs: readonly string[], threshold: number): OwnersValidation {
  const rowErrors: Record<number, string> = {}
  const seen = new Map<string, number>()
  ownerInputs.forEach((raw, i) => {
    const v = raw.trim()
    if (!v) {
      rowErrors[i] = 'Enter an address.'
      return
    }
    if (!isAddress(v, { strict: false })) {
      rowErrors[i] = 'Not a valid address.'
      return
    }
    // mixed-case input must carry a valid checksum
    if (v !== v.toLowerCase() && !isAddress(v)) {
      rowErrors[i] = 'Invalid checksum (check the capitalisation).'
      return
    }
    const a = getAddress(v)
    if (a === zeroAddress) {
      rowErrors[i] = 'The zero address cannot be an owner.'
      return
    }
    if (a.toLowerCase() === '0x0000000000000000000000000000000000000001') {
      rowErrors[i] = 'This address is reserved by Safe (sentinel).'
      return
    }
    const prev = seen.get(a.toLowerCase())
    if (prev !== undefined) {
      rowErrors[i] = `Duplicate of owner #${prev + 1}.`
      return
    }
    seen.set(a.toLowerCase(), i)
  })
  let thresholdError: string | undefined
  if (ownerInputs.length === 0) thresholdError = 'Add at least one owner.'
  else if (!Number.isInteger(threshold) || threshold < 1) thresholdError = 'Threshold must be at least 1.'
  else if (threshold > ownerInputs.length) thresholdError = 'Threshold cannot exceed the number of owners.'
  return { rowErrors, thresholdError, valid: Object.keys(rowErrors).length === 0 && !thresholdError }
}

/** Safe.setup(owners, threshold, to=0, data=0x, fallbackHandler, paymentToken=0, payment=0, paymentReceiver=0) calldata. */
export function encodeSetupInitializer(owners: readonly Address[], threshold: number, fallbackHandler: Address): Hex {
  return encodeFunctionData({
    abi: safeAbi,
    functionName: 'setup',
    args: [owners.map((o) => getAddress(o)), BigInt(threshold), zeroAddress, '0x', fallbackHandler, zeroAddress, 0n, zeroAddress],
  })
}

export function decodeSetupInitializer(data: Hex) {
  const d = decodeFunctionData({ abi: safeAbi, data })
  if (d.functionName !== 'setup') throw new Error('Not a setup() call')
  return d.args
}

/** Random uint256 salt nonce (crypto-quality when available). */
export function randomSaltNonce(): bigint {
  const bytes = new Uint8Array(32)
  globalThis.crypto.getRandomValues(bytes)
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n
}

/** Find the new Safe address in the receipt's ProxyCreation event (emitted by the factory). */
export function parseProxyCreation(receipt: Pick<TransactionReceipt, 'logs'>, factory: Address): Address | null {
  const logs = receipt.logs.filter((l) => l.address.toLowerCase() === factory.toLowerCase())
  const parsed = parseEventLogs({ abi: safeProxyFactoryAbi, eventName: 'ProxyCreation', logs, strict: false })
  const proxy = parsed[0]?.args?.proxy
  return proxy ? getAddress(proxy) : null
}
