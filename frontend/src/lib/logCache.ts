import type { AbiEvent, Address, Log, PublicClient } from 'viem'
import { isRangeError, withBackoff, type BackoffOptions } from './backoff'
import { getItem, setItem } from './storage'

export { withBackoff } from './backoff'

/** A log as returned by getLogs with a decoded `args` object. */
export type AnyLog = Log<bigint, number, false> & { args?: Record<string, unknown>; eventName?: string }

export interface LogCacheEntry<T = AnyLog> {
  /** highest block fully scanned (inclusive) */
  lastBlock: bigint
  logs: T[]
}

const PREFIX = 'safeapp:logs:v1:'

function replacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? { $bigint: v.toString() } : v
}
function reviver(_k: string, v: unknown) {
  if (v && typeof v === 'object' && '$bigint' in (v as object)) return BigInt((v as { $bigint: string }).$bigint)
  return v
}

export function loadLogCache<T = AnyLog>(key: string): LogCacheEntry<T> | null {
  const raw = getItem(PREFIX + key)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw, reviver) as LogCacheEntry<T>
    if (typeof parsed.lastBlock !== 'bigint' || !Array.isArray(parsed.logs)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveLogCache<T = AnyLog>(key: string, entry: LogCacheEntry<T>): boolean {
  try {
    return setItem(PREFIX + key, JSON.stringify(entry, replacer))
  } catch {
    return false
  }
}

export function clearLogCache(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export interface GetLogsChunkedParams {
  client: Pick<PublicClient, 'getLogs'>
  address: Address
  event: AbiEvent
  /** indexed-topic filter, e.g. { safe: '0x..' } */
  args?: Record<string, unknown>
  fromBlock: bigint
  toBlock: bigint
  /** max blocks per getLogs call (inclusive range size). Default 10_000. Halved automatically on range errors. */
  maxRange?: bigint
  backoff?: BackoffOptions
  onProgress?: (scannedUpTo: bigint) => void
}

/** getLogs over [fromBlock, toBlock] in chunks, with backoff on rate limits and range shrinking on range errors. */
export async function getLogsChunked(p: GetLogsChunkedParams): Promise<AnyLog[]> {
  let range = p.maxRange ?? 10_000n
  if (range < 1n) throw new Error('maxRange must be >= 1')
  const out: AnyLog[] = []
  let from = p.fromBlock
  while (from <= p.toBlock) {
    let to = from + range - 1n
    if (to > p.toBlock) to = p.toBlock
    try {
      const logs = await withBackoff(
        () =>
          p.client.getLogs({
            address: p.address,
            event: p.event,
            args: p.args,
            fromBlock: from,
            toBlock: to,
            strict: true,
          } as never) as unknown as Promise<AnyLog[]>,
        p.backoff,
      )
      out.push(...logs)
      p.onProgress?.(to)
      from = to + 1n
    } catch (err) {
      if (isRangeError(err) && range > 1n) {
        range = range / 2n || 1n
        continue
      }
      throw err
    }
  }
  return out
}

const logKey = (l: AnyLog) => `${l.blockNumber}:${l.logIndex}`

/** Merge by blockNumber:logIndex and sort ascending. */
export function mergeLogs(a: AnyLog[], b: AnyLog[]): AnyLog[] {
  const m = new Map<string, AnyLog>()
  for (const l of [...a, ...b]) m.set(logKey(l), l)
  return [...m.values()].sort((x, y) =>
    x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1,
  )
}

export interface ScanLogsCachedParams extends Omit<GetLogsChunkedParams, 'fromBlock' | 'toBlock'> {
  /** localStorage cache key, e.g. `${safe}:proposed` */
  cacheKey: string
  /** first block to ever scan (registry deploy block) */
  startBlock: bigint
  /** defaults to client.getBlockNumber() */
  toBlock?: bigint
  /** ignore the cache and rescan from startBlock */
  force?: boolean
}

/**
 * Forward scan with cache: loads cached logs + lastBlock, scans only (lastBlock, latest],
 * persists the merged result, returns all logs ascending.
 */
export async function scanLogsCached(
  p: ScanLogsCachedParams & { client: Pick<PublicClient, 'getLogs' | 'getBlockNumber'> },
): Promise<LogCacheEntry> {
  const cached = p.force ? null : loadLogCache(p.cacheKey)
  const latest = p.toBlock ?? (await withBackoff(() => p.client.getBlockNumber(), p.backoff))
  const from = cached ? cached.lastBlock + 1n : p.startBlock
  if (from > latest) return cached ?? { lastBlock: latest, logs: [] }
  const fresh = await getLogsChunked({ ...p, fromBlock: from, toBlock: latest })
  const entry: LogCacheEntry = { lastBlock: latest, logs: mergeLogs(cached?.logs ?? [], fresh) }
  saveLogCache(p.cacheKey, entry)
  return entry
}
