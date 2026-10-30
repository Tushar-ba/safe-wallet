import { createPublicClient, http, type PublicClient } from 'viem'
import { polygonAmoy } from 'viem/chains'
import { env } from '../config/env'
import { deployments } from '../config/deployments'
import { isRateLimitError, isRetryableRpcError } from './backoff'
import { getItem, removeItem, setItem } from './storage'

const RPC_KEY = 'safeapp:rpc:v1'

export function getDefaultRpcUrl(): string {
  return env.defaultRpcUrl || polygonAmoy.rpcUrls.default.http[0]
}

export function getCustomRpcUrl(): string | null {
  return getItem(RPC_KEY)
}

export function getActiveRpcUrl(): string {
  return getCustomRpcUrl() || getDefaultRpcUrl()
}

function buildClient(url: string): PublicClient {
  return createPublicClient({
    chain: polygonAmoy,
    transport: http(url, { retryCount: 2, retryDelay: 600, timeout: 15_000 }),
  }) as PublicClient
}

let client: PublicClient | null = null
let version = 0
const listeners = new Set<() => void>()

/** THE shared public client, built from the active RPC. Rebuilt when the RPC changes. */
export function getPublicClient(): PublicClient {
  if (!client) client = buildClient(getActiveRpcUrl())
  return client
}

export function subscribeRpc(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Increments every time the active RPC changes (for useSyncExternalStore). */
export function getRpcVersion(): number {
  return version
}

function rpcChanged() {
  client = null
  version++
  clearRpcProblem()
  listeners.forEach((l) => l())
}

export type RpcValidation = { ok: true } | { ok: false; error: string }

/** Validate a URL by calling eth_chainId; must equal 80002. */
export async function validateRpcUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<RpcValidation> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { ok: false, error: 'Not a valid URL.' }
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'Only http(s) RPC URLs are supported.' }
  }
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 10_000)
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t))
    if (!res.ok) return { ok: false, error: `RPC responded with HTTP ${res.status}.` }
    const json = (await res.json()) as { result?: string; error?: { message?: string } }
    if (json.error) return { ok: false, error: json.error.message ?? 'RPC returned an error.' }
    if (typeof json.result !== 'string') return { ok: false, error: 'Unexpected RPC response.' }
    const id = Number(BigInt(json.result))
    if (id !== deployments.chainId) {
      return { ok: false, error: `Wrong network: RPC reports chainId ${id}, expected ${deployments.chainId} (Polygon Amoy).` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: `Could not reach the RPC${e instanceof Error ? `: ${e.message}` : '.'}` }
  }
}

/** Validates, persists, and switches the shared client. Throws Error(message) when invalid. */
export async function setCustomRpc(url: string): Promise<void> {
  const trimmed = url.trim()
  const v = await validateRpcUrl(trimmed)
  if (!v.ok) throw new Error(v.error)
  setItem(RPC_KEY, trimmed)
  rpcChanged()
}

export function resetRpcToDefault(): void {
  removeItem(RPC_KEY)
  rpcChanged()
}

// ---- RPC health (drives the "RPC problem" banner) ----

export interface RpcProblem {
  active: boolean
  rateLimited: boolean
  message: string
}
const OK: RpcProblem = { active: false, rateLimited: false, message: '' }
let problem: RpcProblem = OK
const problemListeners = new Set<() => void>()

export function getRpcProblem(): RpcProblem {
  return problem
}
export function subscribeRpcProblem(cb: () => void): () => void {
  problemListeners.add(cb)
  return () => problemListeners.delete(cb)
}
function setProblem(p: RpcProblem) {
  if (p.active === problem.active && p.message === problem.message) return
  problem = p
  problemListeners.forEach((l) => l())
}

/** Call with any read error; flags the banner only for rate-limit/transport problems. */
export function reportRpcError(err: unknown): void {
  if (!isRetryableRpcError(err)) return
  const rateLimited = isRateLimitError(err)
  setProblem({
    active: true,
    rateLimited,
    message: rateLimited ? 'The RPC is rate limiting requests.' : 'The RPC is not responding.',
  })
}
export function reportRpcOk(): void {
  setProblem(OK)
}
export function clearRpcProblem(): void {
  setProblem(OK)
}
