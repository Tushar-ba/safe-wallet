import { decodeFunctionData, isAddressEqual, parseAbi, zeroAddress, type Address, type Hex } from 'viem'
import { computeSafeTxHash } from '../../lib/safeTx'
import { formatNative, shortAddress } from '../../lib/format'

/** Raw-ish shape of a Proposed log (args already decoded). */
export interface ProposedLogLike {
  blockNumber?: bigint | null
  logIndex?: number | null
  args?: Record<string, unknown>
}

export interface Proposal {
  safeTxHash: Hex
  safe: Address
  proposer: Address
  to: Address
  value: bigint
  data: Hex
  nonce: bigint
  blockNumber: bigint
  logIndex: number
}

export interface FlaggedProposal {
  reason: 'hash-mismatch' | 'malformed'
  eventHash?: Hex
  computedHash?: Hex
  nonce?: bigint
}

/**
 * Turn raw logs into proposals: keep only this Safe, nonce >= currentNonce, dedupe by safeTxHash
 * (first occurrence wins), and verify the event's hash against a local recomputation.
 * Events whose hash does not match are returned in `flagged` and never shown as actionable.
 */
export function parseProposals(
  logs: readonly ProposedLogLike[],
  safe: Address,
  currentNonce: bigint,
  chainId?: number,
): { proposals: Proposal[]; flagged: FlaggedProposal[] } {
  const seen = new Set<string>()
  const proposals: Proposal[] = []
  const flagged: FlaggedProposal[] = []
  for (const l of logs) {
    const a = l.args
    if (
      !a ||
      typeof a.safeTxHash !== 'string' ||
      typeof a.to !== 'string' ||
      typeof a.data !== 'string' ||
      typeof a.value !== 'bigint' ||
      typeof a.nonce !== 'bigint' ||
      typeof a.safe !== 'string' ||
      typeof a.proposer !== 'string'
    ) {
      flagged.push({ reason: 'malformed' })
      continue
    }
    if (a.safe.toLowerCase() !== safe.toLowerCase()) continue
    if (a.nonce < currentNonce) continue
    const eventHash = a.safeTxHash as Hex
    const key = eventHash.toLowerCase()
    if (seen.has(key)) continue
    const computed = computeSafeTxHash(
      safe,
      { to: a.to as Address, value: a.value, data: a.data as Hex, nonce: a.nonce },
      chainId,
    )
    if (computed.toLowerCase() !== key) {
      seen.add(key)
      flagged.push({ reason: 'hash-mismatch', eventHash, computedHash: computed, nonce: a.nonce })
      continue
    }
    seen.add(key)
    proposals.push({
      safeTxHash: computed,
      safe,
      proposer: a.proposer as Address,
      to: a.to as Address,
      value: a.value,
      data: a.data as Hex,
      nonce: a.nonce,
      blockNumber: l.blockNumber ?? 0n,
      logIndex: l.logIndex ?? 0,
    })
  }
  return { proposals, flagged }
}

export interface NonceGroup {
  nonce: bigint
  proposals: Proposal[]
  conflicting: boolean
}

/** Group by nonce ascending; proposals inside a group are ordered by block/logIndex. */
export function groupByNonce(proposals: readonly Proposal[]): NonceGroup[] {
  const m = new Map<string, Proposal[]>()
  for (const p of proposals) {
    const k = p.nonce.toString()
    const arr = m.get(k)
    if (arr) arr.push(p)
    else m.set(k, [p])
  }
  return [...m.entries()]
    .map(([k, ps]) => ({
      nonce: BigInt(k),
      proposals: ps.sort((a, b) =>
        a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1,
      ),
      conflicting: ps.length > 1,
    }))
    .sort((a, b) => (a.nonce < b.nonce ? -1 : a.nonce > b.nonce ? 1 : 0))
}

export interface VoteSummary {
  approvers: Address[]
  count: number
  /** per owner, in the owners order */
  byOwner: { owner: Address; confirmed: boolean }[]
}

/** approvals: lowercased owner -> approvedHashes value (nonzero = approved). */
export function countVotes(owners: readonly Address[], approvals: Readonly<Record<string, bigint>>): VoteSummary {
  const byOwner = owners.map((owner) => ({ owner, confirmed: (approvals[owner.toLowerCase()] ?? 0n) > 0n }))
  const approvers = byOwner.filter((x) => x.confirmed).map((x) => x.owner)
  return { approvers, count: approvers.length, byOwner }
}

export interface ExecReadiness {
  ready: boolean
  /** signatures (owner addresses) to pass to buildApprovedHashSignatures */
  signers: Address[]
  /** executor counted via their own msg.sender entry although they have not approved */
  includesExecutor: boolean
  reason?: string
}

/**
 * Execute is possible when nonce == current nonce and approvals (plus the executor's own entry, if
 * the executor is an owner who has not approved) reach the threshold.
 */
export function execReadiness(args: {
  proposalNonce: bigint
  currentNonce: bigint
  threshold: number
  approvers: readonly Address[]
  executor?: Address
  executorIsOwner: boolean
}): ExecReadiness {
  const signers = [...args.approvers]
  const executorApproved =
    !!args.executor && args.approvers.some((a) => isAddressEqual(a, args.executor as Address))
  let includesExecutor = false
  if (args.executor && args.executorIsOwner && !executorApproved && signers.length < args.threshold) {
    signers.push(args.executor)
    includesExecutor = true
  }
  if (!args.executor) return { ready: false, signers, includesExecutor, reason: 'Connect an owner wallet.' }
  if (!args.executorIsOwner) return { ready: false, signers, includesExecutor, reason: 'Only owners can execute.' }
  if (args.proposalNonce !== args.currentNonce) {
    return {
      ready: false,
      signers,
      includesExecutor,
      reason:
        args.proposalNonce > args.currentNonce
          ? `Waiting for nonce ${args.currentNonce} to execute first.`
          : 'Nonce already used.',
    }
  }
  if (signers.length < args.threshold) {
    return {
      ready: false,
      signers,
      includesExecutor,
      reason: `Needs ${args.threshold - signers.length} more confirmation(s).`,
    }
  }
  return { ready: true, signers, includesExecutor }
}

// ---------- action summary ----------

const knownAbi = parseAbi([
  'function transfer(address to, uint256 amount)',
  'function approve(address spender, uint256 amount)',
  'function transferFrom(address from, address to, uint256 amount)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
])

export interface ActionSummary {
  kind: 'send' | 'reject' | 'erc20' | 'call'
  title: string
  detail?: string
}

export function summarizeAction(p: Pick<Proposal, 'safe' | 'to' | 'value' | 'data'>): ActionSummary {
  const isSelf = p.to.toLowerCase() === p.safe.toLowerCase()
  if (p.data === '0x' || p.data === '0x00' || p.data.length <= 2) {
    if (isSelf && p.value === 0n) {
      return { kind: 'reject', title: 'Rejection: on-chain cancel of this nonce', detail: 'Empty self-call' }
    }
    return { kind: 'send', title: `Send ${formatNative(p.value)} POL to ${shortAddress(p.to)}` }
  }
  try {
    const d = decodeFunctionData({ abi: knownAbi, data: p.data })
    const a = d.args as readonly unknown[]
    switch (d.functionName) {
      case 'transfer':
        return {
          kind: 'erc20',
          title: `Transfer (token ${shortAddress(p.to)}): ${(a[1] as bigint).toString()} base units to ${shortAddress(a[0] as Address)}`,
          detail: 'ERC20 transfer(address,uint256); decimals unknown, amount shown in base units',
        }
      case 'approve':
        return {
          kind: 'erc20',
          title: `Approve ${shortAddress(a[0] as Address)} to spend ${(a[1] as bigint).toString()} base units (token ${shortAddress(p.to)})`,
        }
      case 'transferFrom':
        return {
          kind: 'erc20',
          title: `transferFrom ${shortAddress(a[0] as Address)} to ${shortAddress(a[1] as Address)}, amount/id ${(a[2] as bigint).toString()} (${shortAddress(p.to)})`,
        }
      case 'safeTransferFrom':
        return {
          kind: 'erc20',
          title: `NFT safeTransferFrom ${shortAddress(a[0] as Address)} to ${shortAddress(a[1] as Address)}, id ${(a[2] as bigint).toString()} (${shortAddress(p.to)})`,
        }
      case 'setApprovalForAll':
        return {
          kind: 'erc20',
          title: `setApprovalForAll(${shortAddress(a[0] as Address)}, ${String(a[1])}) on ${shortAddress(p.to)}`,
        }
    }
  } catch {
    /* unknown selector */
  }
  const sel = p.data.slice(0, 10)
  return {
    kind: 'call',
    title: `Contract call to ${shortAddress(p.to)} (${sel})`,
    detail: p.value > 0n ? `with ${formatNative(p.value)} POL` : undefined,
  }
}

export function isZeroAddress(a: string): boolean {
  return a.toLowerCase() === zeroAddress
}
