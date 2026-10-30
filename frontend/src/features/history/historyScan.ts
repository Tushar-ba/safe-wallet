import { getAbiItem, type Address, type PublicClient } from 'viem'
import { deployments } from '../../config/deployments'
import { isRangeError, withBackoff } from '../../lib/backoff'
import { safeAbi, txProposalRegistryAbi } from '../../lib/abis'
import { loadLogCache, saveLogCache, scanLogsCached, type LogCacheEntry } from '../../lib/logCache'
import {
  backwardChunks,
  EXECUTION_FAILURE_TOPIC,
  EXECUTION_SUCCESS_TOPIC,
  mergeExecLogs,
  parseProposals,
  parseRawExecLog,
  type ExecLog,
  type Proposal,
  type RawLog,
} from './historyLogic'

/** Tunables. */
export const HISTORY_WINDOW_BLOCKS = 50_000n
/** max windows scanned per step (initial load / each "Load more") */
export const MAX_WINDOWS_PER_STEP = 10
export const PAGE_SIZE = 10
/** lowest block ever scanned; Safes may predate the registry, so registryDeployBlock is NOT used as a floor here */
export const HISTORY_FLOOR = 0n
/** if registryDeployBlock is unknown (0), only look this far back for proposals */
const PROPOSAL_FALLBACK_LOOKBACK = 500_000n

export type HistClient = Pick<PublicClient, 'getBlockNumber' | 'getLogs' | 'request' | 'readContract'>

/** Contiguous scanned range [oldestBlock, lastBlock] plus the executions found in it. */
export interface HistoryCache extends LogCacheEntry<ExecLog> {
  oldestBlock: bigint
}

export interface HistoryData {
  execs: ExecLog[]
  oldestBlock: bigint
  lastBlock: bigint
  proposals: Proposal[]
  headNonce: bigint | null
  reachedFloor: boolean
}

const execCacheKey = (safe: Address) => `${safe.toLowerCase()}:history:exec`
const proposedCacheKey = (safe: Address) => `${safe.toLowerCase()}:history:proposed`

function loadExecCache(safe: Address): HistoryCache | null {
  const c = loadLogCache<ExecLog>(execCacheKey(safe)) as (LogCacheEntry<ExecLog> & { oldestBlock?: bigint }) | null
  if (!c || typeof c.oldestBlock !== 'bigint') return null
  return { lastBlock: c.lastBlock, logs: c.logs, oldestBlock: c.oldestBlock }
}
const saveExecCache = (safe: Address, c: HistoryCache) => saveLogCache<ExecLog>(execCacheKey(safe), c)

/** One address+topic0 getLogs over [from,to], splitting the range when the RPC rejects it as too large. */
async function fetchExecRange(client: HistClient, safe: Address, from: bigint, to: bigint): Promise<ExecLog[]> {
  try {
    const raw = await withBackoff(
      () =>
        client.request({
          method: 'eth_getLogs',
          params: [
            {
              address: safe,
              fromBlock: `0x${from.toString(16)}`,
              toBlock: `0x${to.toString(16)}`,
              topics: [[EXECUTION_SUCCESS_TOPIC, EXECUTION_FAILURE_TOPIC]],
            },
          ],
        } as never) as unknown as Promise<RawLog[]>,
    )
    return raw.map(parseRawExecLog).filter((l): l is ExecLog => l !== null)
  } catch (err) {
    if (isRangeError(err) && to > from) {
      const mid = from + (to - from) / 2n
      const a = await fetchExecRange(client, safe, from, mid)
      const b = await fetchExecRange(client, safe, mid + 1n, to)
      return [...a, ...b]
    }
    throw err
  }
}

/** Scan new blocks (cache.lastBlock, latest] forward, saving after each window. */
async function scanForward(client: HistClient, safe: Address, cache: HistoryCache, latest: bigint): Promise<HistoryCache> {
  let from = cache.lastBlock + 1n
  while (from <= latest) {
    const end = from + HISTORY_WINDOW_BLOCKS - 1n
    const to = end > latest ? latest : end
    const found = await fetchExecRange(client, safe, from, to)
    cache = { ...cache, logs: mergeExecLogs(cache.logs, found), lastBlock: to }
    saveExecCache(safe, cache)
    from = to + 1n
  }
  return cache
}

/**
 * Scan backwards below cache.oldestBlock, newest window first, until the cache holds `targetCount` executions,
 * `maxWindows` windows were scanned, or the floor is reached. Progress is saved after every window.
 */
export async function scanBack(
  client: HistClient,
  safe: Address,
  cache: HistoryCache,
  targetCount: number,
  opts: { windowBlocks?: bigint; maxWindows?: number; floor?: bigint } = {},
): Promise<HistoryCache> {
  const chunks = backwardChunks(
    cache.oldestBlock - 1n,
    opts.floor ?? HISTORY_FLOOR,
    opts.windowBlocks ?? HISTORY_WINDOW_BLOCKS,
    opts.maxWindows ?? MAX_WINDOWS_PER_STEP,
  )
  for (const c of chunks) {
    if (cache.logs.length >= targetCount) break
    const found = await fetchExecRange(client, safe, c.from, c.to)
    cache = { ...cache, logs: mergeExecLogs(cache.logs, found), oldestBlock: c.from }
    saveExecCache(safe, cache)
  }
  return cache
}

async function loadProposals(client: HistClient, safe: Address, latest: bigint): Promise<Proposal[]> {
  const registry = deployments.txProposalRegistry as string
  if (/^0x0{40}$/i.test(registry)) return []
  const event = getAbiItem({ abi: txProposalRegistryAbi, name: 'Proposed' })
  const deploy = BigInt(deployments.registryDeployBlock)
  const start = deploy > 0n ? deploy : latest > PROPOSAL_FALLBACK_LOOKBACK ? latest - PROPOSAL_FALLBACK_LOOKBACK : 0n
  const entry = await scanLogsCached({
    client,
    address: registry as Address,
    event,
    args: { safe },
    cacheKey: proposedCacheKey(safe),
    startBlock: start,
    toBlock: latest,
    maxRange: HISTORY_WINDOW_BLOCKS,
  })
  return parseProposals(entry.logs)
}

async function readHeadNonce(client: HistClient, safe: Address): Promise<bigint | null> {
  try {
    return await withBackoff(() => client.readContract({ address: safe, abi: safeAbi, functionName: 'nonce' }) as Promise<bigint>)
  } catch {
    return null
  }
}

function toData(cache: HistoryCache, proposals: Proposal[], headNonce: bigint | null): HistoryData {
  return {
    execs: cache.logs,
    oldestBlock: cache.oldestBlock,
    lastBlock: cache.lastBlock,
    proposals,
    headNonce,
    reachedFloor: cache.oldestBlock <= HISTORY_FLOOR,
  }
}

/**
 * Initial load / Refresh: cheap forward scan of new blocks when a cache exists, else a backwards scan from latest.
 * Always re-reads proposals (forward, cached) and the Safe's nonce.
 */
export async function loadHistory(client: HistClient, safe: Address, targetCount: number = PAGE_SIZE): Promise<HistoryData> {
  const latest = await withBackoff(() => client.getBlockNumber())
  let cache = loadExecCache(safe)
  if (cache) {
    cache = await scanForward(client, safe, cache, latest)
  } else {
    cache = await scanBack(client, safe, { lastBlock: latest, oldestBlock: latest + 1n, logs: [] }, targetCount)
  }
  const [proposals, headNonce] = await Promise.all([loadProposals(client, safe, latest), readHeadNonce(client, safe)])
  return toData(cache, proposals, headNonce)
}

/** "Load more": scan further back, reusing proposals/nonce from `prev`. */
export async function loadMore(client: HistClient, safe: Address, prev: HistoryData, targetCount: number): Promise<HistoryData> {
  const cache = await scanBack(client, safe, { lastBlock: prev.lastBlock, oldestBlock: prev.oldestBlock, logs: prev.execs }, targetCount)
  return toData(cache, prev.proposals, prev.headNonce)
}
