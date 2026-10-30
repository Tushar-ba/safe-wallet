import { describe, expect, it } from 'vitest'
import type { Address, Hex } from 'viem'
import type { AnyLog } from '../../lib/logCache'
import {
  backwardChunks,
  buildHistory,
  EXECUTION_FAILURE_TOPIC,
  EXECUTION_SUCCESS_TOPIC,
  mergeExecLogs,
  parseProposals,
  parseRawExecLog,
  summarizeAction,
  type ExecLog,
  type Proposal,
} from './historyLogic'

const h = (n: number) => ('0x' + n.toString(16).padStart(64, '0')) as Hex
const SAFE = '0x1111111111111111111111111111111111111111' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address

const exec = (block: number, idx: number, safeTxHash: Hex, status: 'success' | 'failure' = 'success'): ExecLog => ({
  blockNumber: BigInt(block),
  logIndex: idx,
  transactionHash: h(1000 + block),
  safeTxHash,
  status,
  payment: 0n,
})

const prop = (safeTxHash: Hex, nonce: bigint): Proposal => ({
  safeTxHash,
  proposer: OTHER,
  to: OTHER,
  value: 5n,
  data: '0x',
  nonce,
  blockNumber: 1n,
})

describe('backwardChunks', () => {
  it('covers range newest first with no gaps or overlap', () => {
    const c = backwardChunks(250n, 0n, 100n)
    expect(c).toEqual([
      { from: 151n, to: 250n },
      { from: 51n, to: 150n },
      { from: 0n, to: 50n },
    ])
  })
  it('clamps to floor and respects limit', () => {
    expect(backwardChunks(120n, 100n, 50n)).toEqual([{ from: 100n, to: 120n }])
    expect(backwardChunks(1000n, 0n, 100n, 2)).toHaveLength(2)
  })
  it('is empty below floor and rejects bad size', () => {
    expect(backwardChunks(5n, 10n, 3n)).toEqual([])
    expect(() => backwardChunks(5n, 0n, 0n)).toThrow()
  })
})

describe('parseRawExecLog', () => {
  const base = { blockNumber: '0x10' as Hex, logIndex: '0x2' as Hex, transactionHash: h(9) }
  it('decodes non-indexed txHash from data', () => {
    const data = ('0x' + 'ab'.repeat(32) + (7).toString(16).padStart(64, '0')) as Hex
    const l = parseRawExecLog({ ...base, topics: [EXECUTION_SUCCESS_TOPIC], data })
    expect(l).toMatchObject({ blockNumber: 16n, logIndex: 2, status: 'success', payment: 7n })
    expect(l?.safeTxHash).toBe('0x' + 'ab'.repeat(32))
  })
  it('decodes indexed variant and failure', () => {
    const l = parseRawExecLog({ ...base, topics: [EXECUTION_FAILURE_TOPIC, h(5)], data: ('0x' + '0'.repeat(64)) as Hex })
    expect(l).toMatchObject({ status: 'failure', safeTxHash: h(5) })
  })
  it('rejects unknown topic / short data', () => {
    expect(parseRawExecLog({ ...base, topics: [h(1)], data: '0x' })).toBeNull()
    expect(parseRawExecLog({ ...base, topics: [EXECUTION_SUCCESS_TOPIC], data: '0x12' })).toBeNull()
  })
})

describe('mergeExecLogs', () => {
  it('dedupes by block:logIndex and sorts ascending', () => {
    const a = [exec(20, 0, h(2)), exec(10, 1, h(1))]
    const b = [exec(10, 1, h(1)), exec(10, 0, h(3)), exec(30, 0, h(4))]
    const m = mergeExecLogs(a, b)
    expect(m.map((l) => `${l.blockNumber}:${l.logIndex}`)).toEqual(['10:0', '10:1', '20:0', '30:0'])
  })
})

describe('parseProposals', () => {
  const log = (block: bigint, hash: Hex, nonce: bigint): AnyLog =>
    ({
      blockNumber: block,
      logIndex: 0,
      args: { safe: SAFE, safeTxHash: hash.toUpperCase().replace('0X', '0x'), proposer: OTHER, to: OTHER, value: 1n, data: '0x', nonce },
    }) as unknown as AnyLog
  it('dedupes by safeTxHash (earliest wins) and lowercases', () => {
    const out = parseProposals([log(9n, h(0xabc), 2n), log(5n, h(0xabc), 1n)])
    expect(out).toHaveLength(1)
    expect(out[0]?.nonce).toBe(1n)
    expect(out[0]?.safeTxHash).toBe(h(0xabc))
  })
})

describe('buildHistory', () => {
  it('orders newest first and joins proposals by hash', () => {
    const execs = [exec(10, 0, h(1)), exec(30, 0, h(3)), exec(20, 0, h(2), 'failure')]
    const items = buildHistory(execs, [prop(h(2), 1n)], null)
    expect(items.map((i) => i.exec.blockNumber)).toEqual([30n, 20n, 10n])
    expect(items[1]?.proposal?.nonce).toBe(1n)
    expect(items[0]?.proposal).toBeNull()
    expect(items[0]?.nonce).toBeUndefined()
  })
  it('derives nonces from the head nonce when consistent', () => {
    const execs = [exec(10, 0, h(1)), exec(20, 0, h(2)), exec(30, 0, h(3))]
    const items = buildHistory(execs, [prop(h(2), 1n)], 3n)
    expect(items.map((i) => i.nonce)).toEqual([2n, 1n, 0n])
    expect(items.map((i) => i.nonceSource)).toEqual(['derived', 'proposal', 'derived'])
  })
  it('drops derivation when a proposal disagrees', () => {
    const execs = [exec(10, 0, h(1)), exec(20, 0, h(2))]
    const items = buildHistory(execs, [prop(h(2), 7n)], 2n)
    expect(items[0]?.nonce).toBe(7n)
    expect(items[1]?.nonce).toBeUndefined()
  })
  it('drops derivation when it would go negative', () => {
    const items = buildHistory([exec(1, 0, h(1)), exec(2, 0, h(2))], [], 1n)
    expect(items.every((i) => i.nonce === undefined)).toBe(true)
  })
})

describe('summarizeAction', () => {
  it('native send, rejection, erc20 and unknown call', () => {
    expect(summarizeAction(SAFE, { to: OTHER, value: 10n ** 18n, data: '0x' }).title).toContain('Send 1 POL')
    expect(summarizeAction(SAFE, { to: SAFE, value: 0n, data: '0x' }).title).toContain('Rejection')
    const transfer = ('0xa9059cbb' + OTHER.slice(2).padStart(64, '0') + (5).toString(16).padStart(64, '0')) as Hex
    expect(summarizeAction(SAFE, { to: OTHER, value: 0n, data: transfer }).detail).toContain('transfer(')
    expect(summarizeAction(SAFE, { to: OTHER, value: 0n, data: '0xdeadbeef' }).title).toContain('0xdeadbeef')
  })
})
