import { describe, expect, it } from 'vitest'
import { encodeFunctionData, parseAbi, type Address, type Hex } from 'viem'
import { computeSafeTxHash } from '../../lib/safeTx'
import { countVotes, execReadiness, groupByNonce, parseProposals, summarizeAction } from './queueLogic'

const SAFE = '0x1111111111111111111111111111111111111111' as Address
const O1 = '0x00000000000000000000000000000000000000a1' as Address
const O2 = '0x00000000000000000000000000000000000000a2' as Address
const O3 = '0x00000000000000000000000000000000000000a3' as Address
const TO = '0x2222222222222222222222222222222222222222' as Address

function log(nonce: bigint, opts: { to?: Address; value?: bigint; data?: Hex; hash?: Hex; block?: bigint; idx?: number; safe?: Address } = {}) {
  const to = opts.to ?? TO
  const value = opts.value ?? 0n
  const data = opts.data ?? '0x'
  return {
    blockNumber: opts.block ?? 1n,
    logIndex: opts.idx ?? 0,
    args: {
      safe: opts.safe ?? SAFE,
      safeTxHash: opts.hash ?? computeSafeTxHash(SAFE, { to, value, data, nonce }),
      proposer: O1,
      to,
      value,
      data,
      nonce,
    },
  }
}

describe('parseProposals', () => {
  it('keeps only nonce >= current and dedupes by hash', () => {
    const { proposals, flagged } = parseProposals([log(1n), log(2n), log(2n, { block: 5n }), log(3n, { value: 1n })], SAFE, 2n)
    expect(flagged).toEqual([])
    expect(proposals.map((p) => p.nonce)).toEqual([2n, 3n])
  })
  it('flags events whose hash does not match the recomputed one', () => {
    const bad = ('0x' + 'ab'.repeat(32)) as Hex
    const { proposals, flagged } = parseProposals([log(2n, { hash: bad })], SAFE, 0n)
    expect(proposals).toHaveLength(0)
    expect(flagged).toHaveLength(1)
    expect(flagged[0].reason).toBe('hash-mismatch')
    expect(flagged[0].eventHash).toBe(bad)
  })
  it('ignores other safes and flags malformed', () => {
    const other = '0x3333333333333333333333333333333333333333' as Address
    const r = parseProposals([log(1n, { safe: other }), { args: {} }], SAFE, 0n)
    expect(r.proposals).toHaveLength(0)
    expect(r.flagged).toHaveLength(1)
    expect(r.flagged[0].reason).toBe('malformed')
  })
})

describe('groupByNonce', () => {
  it('groups, sorts, and marks conflicts', () => {
    const { proposals } = parseProposals(
      [log(5n, { value: 1n }), log(3n), log(5n, { value: 2n, block: 9n }), log(5n, { value: 3n, block: 2n })],
      SAFE,
      0n,
    )
    const g = groupByNonce(proposals)
    expect(g.map((x) => x.nonce)).toEqual([3n, 5n])
    expect(g[0].conflicting).toBe(false)
    expect(g[1].conflicting).toBe(true)
    expect(g[1].proposals.map((p) => p.value)).toEqual([1n, 3n, 2n])
  })
})

describe('countVotes', () => {
  it('counts nonzero approvals per owner', () => {
    const v = countVotes([O1, O2, O3], { [O1.toLowerCase()]: 1n, [O3.toLowerCase()]: 1n, [O2.toLowerCase()]: 0n })
    expect(v.count).toBe(2)
    expect(v.approvers).toEqual([O1, O3])
    expect(v.byOwner.map((x) => x.confirmed)).toEqual([true, false, true])
  })
})

describe('execReadiness', () => {
  const base = { proposalNonce: 4n, currentNonce: 4n, threshold: 2, approvers: [O1, O2], executor: O3, executorIsOwner: true }
  it('ready with enough approvals at current nonce', () => {
    const r = execReadiness(base)
    expect(r.ready).toBe(true)
    expect(r.signers).toEqual([O1, O2])
    expect(r.includesExecutor).toBe(false)
  })
  it('executor owner can fill the last slot', () => {
    const r = execReadiness({ ...base, approvers: [O1] })
    expect(r.ready).toBe(true)
    expect(r.includesExecutor).toBe(true)
    expect(r.signers).toEqual([O1, O3])
  })
  it('not ready below threshold', () => {
    expect(execReadiness({ ...base, approvers: [O1], executorIsOwner: false }).ready).toBe(false)
  })
  it('not ready when nonce is ahead', () => {
    const r = execReadiness({ ...base, currentNonce: 3n })
    expect(r.ready).toBe(false)
    expect(r.reason).toMatch(/nonce 3/)
  })
  it('not ready for non-owner or disconnected', () => {
    expect(execReadiness({ ...base, executorIsOwner: false }).ready).toBe(false)
    expect(execReadiness({ ...base, executor: undefined }).ready).toBe(false)
  })
})

describe('summarizeAction', () => {
  it('native send, reject, erc20 transfer, generic call', () => {
    expect(summarizeAction({ safe: SAFE, to: TO, value: 10n ** 18n, data: '0x' }).title).toMatch(/^Send 1 POL to 0x2222/)
    expect(summarizeAction({ safe: SAFE, to: SAFE, value: 0n, data: '0x' }).kind).toBe('reject')
    const data = encodeFunctionData({
      abi: parseAbi(['function transfer(address to, uint256 amount)']),
      functionName: 'transfer',
      args: [O1, 5n],
    })
    expect(summarizeAction({ safe: SAFE, to: TO, value: 0n, data }).kind).toBe('erc20')
    expect(summarizeAction({ safe: SAFE, to: TO, value: 0n, data: '0xdeadbeef' }).kind).toBe('call')
  })
})
