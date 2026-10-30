import { decodeFunctionData, parseAbi, toEventSelector, type Address, type Hex } from 'viem'
import { formatNative, shortAddress } from '../../lib/format'
import type { AnyLog } from '../../lib/logCache'

/**
 * Pure logic for the History tab (no RPC, no React).
 *
 * Note on Safe events: the canonical v1.4.1 singleton declares `ExecutionSuccess(bytes32 txHash, uint256 payment)`
 * with NOTHING indexed (newer sources index txHash). topic0 is identical either way, so we filter by
 * address + topic0 and decode the raw log tolerantly (txHash from data, or from topics[1] if it was indexed).
 */

export const EXECUTION_SUCCESS_TOPIC = toEventSelector('ExecutionSuccess(bytes32,uint256)')
export const EXECUTION_FAILURE_TOPIC = toEventSelector('ExecutionFailure(bytes32,uint256)')

export interface ExecLog {
  blockNumber: bigint
  logIndex: number
  /** the Polygon transaction that executed the Safe tx */
  transactionHash: Hex
  /** the Safe tx hash (EIP-712), as emitted in the event */
  safeTxHash: Hex
  status: 'success' | 'failure'
  payment: bigint
}

export interface Proposal {
  safeTxHash: Hex
  proposer: Address
  to: Address
  value: bigint
  data: Hex
  nonce: bigint
  blockNumber: bigint
}

export interface HistoryItem {
  exec: ExecLog
  proposal: Proposal | null
  /** from the proposal when known, otherwise derived from the Safe's current nonce; undefined if unknown */
  nonce: bigint | undefined
  nonceSource: 'proposal' | 'derived' | 'unknown'
}

export interface BlockRange {
  from: bigint
  to: bigint
}

/** Raw eth_getLogs entry (hex-encoded). */
export interface RawLog {
  blockNumber: Hex
  logIndex: Hex
  transactionHash: Hex
  topics: readonly Hex[]
  data: Hex
}

/**
 * Inclusive block windows covering [floor, toBlock], newest window first, each at most `size` blocks.
 * `limit` caps the number of windows returned.
 */
export function backwardChunks(toBlock: bigint, floor: bigint, size: bigint, limit = Number.POSITIVE_INFINITY): BlockRange[] {
  if (size < 1n) throw new Error('size must be >= 1')
  const out: BlockRange[] = []
  let to = toBlock
  while (to >= floor && out.length < limit) {
    const from = to - size + 1n < floor ? floor : to - size + 1n
    out.push({ from, to })
    to = from - 1n
  }
  return out
}

export function parseRawExecLog(raw: RawLog): ExecLog | null {
  const topic0 = raw.topics[0]
  const status = topic0 === EXECUTION_SUCCESS_TOPIC ? 'success' : topic0 === EXECUTION_FAILURE_TOPIC ? 'failure' : null
  if (!status) return null
  let safeTxHash: string
  let payment: bigint
  const body = raw.data.slice(2)
  const indexed = raw.topics[1]
  if (indexed) {
    safeTxHash = indexed
    payment = body.length >= 64 ? BigInt('0x' + body.slice(0, 64)) : 0n
  } else {
    if (body.length < 128) return null
    safeTxHash = '0x' + body.slice(0, 64)
    payment = BigInt('0x' + body.slice(64, 128))
  }
  return {
    blockNumber: BigInt(raw.blockNumber),
    logIndex: Number(BigInt(raw.logIndex)),
    transactionHash: raw.transactionHash,
    safeTxHash: safeTxHash.toLowerCase() as Hex,
    status,
    payment,
  }
}

const execKey = (l: ExecLog) => `${l.blockNumber}:${l.logIndex}`

/** Merge + dedupe (blockNumber:logIndex), ascending by chain order. */
export function mergeExecLogs(a: readonly ExecLog[], b: readonly ExecLog[]): ExecLog[] {
  const m = new Map<string, ExecLog>()
  for (const l of [...a, ...b]) m.set(execKey(l), l)
  return [...m.values()].sort((x, y) =>
    x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1,
  )
}

/** Decode `Proposed` logs into proposals, deduped by safeTxHash (earliest proposal wins). */
export function parseProposals(logs: readonly AnyLog[]): Proposal[] {
  const map = new Map<string, Proposal>()
  const sorted = [...logs].sort((x, y) => {
    const bx = x.blockNumber ?? 0n
    const by = y.blockNumber ?? 0n
    return bx === by ? (x.logIndex ?? 0) - (y.logIndex ?? 0) : bx < by ? -1 : 1
  })
  for (const l of sorted) {
    const a = l.args
    if (!a || typeof a.safeTxHash !== 'string') continue
    const key = a.safeTxHash.toLowerCase()
    if (map.has(key)) continue
    map.set(key, {
      safeTxHash: key as Hex,
      proposer: a.proposer as Address,
      to: a.to as Address,
      value: a.value as bigint,
      data: a.data as Hex,
      nonce: a.nonce as bigint,
      blockNumber: l.blockNumber ?? 0n,
    })
  }
  return [...map.values()]
}

/**
 * Join executions with proposals by safeTxHash, newest first.
 *
 * Nonce: the proposal's nonce is exact (it is part of the hash). Otherwise, since every execTransaction
 * (success or failure) bumps the Safe nonce by 1 and modules are unsupported, the i-th newest execution has
 * nonce `headNonce - 1 - i`, valid only when `execs` reaches the chain head. If any known proposal nonce
 * disagrees with the derivation (or it goes negative), the derivation is dropped for every item.
 */
export function buildHistory(execs: readonly ExecLog[], proposals: readonly Proposal[], headNonce: bigint | null): HistoryItem[] {
  const byHash = new Map(proposals.map((p) => [p.safeTxHash.toLowerCase(), p]))
  const newestFirst = mergeExecLogs(execs, []).reverse()
  const derived = newestFirst.map((_, i) => (headNonce === null ? undefined : headNonce - 1n - BigInt(i)))
  let derivationOk = headNonce !== null
  newestFirst.forEach((e, i) => {
    const p = byHash.get(e.safeTxHash.toLowerCase())
    const d = derived[i]
    if (d !== undefined && (d < 0n || (p && p.nonce !== d))) derivationOk = false
  })
  return newestFirst.map((exec, i): HistoryItem => {
    const proposal = byHash.get(exec.safeTxHash.toLowerCase()) ?? null
    if (proposal) return { exec, proposal, nonce: proposal.nonce, nonceSource: 'proposal' }
    const d = derived[i]
    if (derivationOk && d !== undefined) return { exec, proposal, nonce: d, nonceSource: 'derived' }
    return { exec, proposal, nonce: undefined, nonceSource: 'unknown' }
  })
}

const knownAbi = parseAbi([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
])

export interface ActionSummary {
  title: string
  /** secondary line (decoded args / selector) */
  detail?: string
}

/** Human summary of a Safe tx (to, value, data) for display. Never throws. */
export function summarizeAction(safe: Address, tx: { to: Address; value: bigint; data: Hex }): ActionSummary {
  const { to, value, data } = tx
  const isSelf = to.toLowerCase() === safe.toLowerCase()
  if (data === '0x') {
    if (isSelf && value === 0n) return { title: 'Rejection (0-value self-call)', detail: 'Cancels a pending transaction at this nonce' }
    return { title: `Send ${formatNative(value)} POL to ${shortAddress(to)}` }
  }
  const selector = data.slice(0, 10)
  try {
    const d = decodeFunctionData({ abi: knownAbi, data })
    const args = (d.args ?? []) as readonly unknown[]
    return {
      title: `${d.functionName} on ${shortAddress(to)}`,
      detail: `${d.functionName}(${args.map((x) => String(x)).join(', ')})`,
    }
  } catch {
    return {
      title: `Contract call ${selector} on ${shortAddress(to)}`,
      detail: value > 0n ? `with ${formatNative(value)} POL` : undefined,
    }
  }
}
