import type { Abi, AbiFunction, AbiParameter, Address, Hex, PublicClient } from 'viem'

/** EIP-1967 implementation slot: bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1) */
export const EIP1967_IMPL_SLOT: Hex = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'

const ITEM_TYPES = new Set(['function', 'event', 'error', 'constructor', 'fallback', 'receive'])

function validateParam(p: unknown, where: string): AbiParameter {
  if (!p || typeof p !== 'object') throw new Error(`${where}: parameter must be an object`)
  const o = p as { type?: unknown; name?: unknown; components?: unknown }
  if (typeof o.type !== 'string' || o.type === '') throw new Error(`${where}: parameter is missing "type"`)
  if (o.name !== undefined && typeof o.name !== 'string') throw new Error(`${where}: parameter "name" must be a string`)
  if (o.type.startsWith('tuple')) {
    if (!Array.isArray(o.components)) throw new Error(`${where}: tuple parameter needs "components"`)
    o.components.forEach((c, i) => validateParam(c, `${where}.components[${i}]`))
  }
  return p as AbiParameter
}

/**
 * Parse and validate pasted ABI JSON. Accepts a bare ABI array, or an object with an `abi` field
 * (Hardhat/Foundry artifacts) or an Etherscan-style JSON string. Throws Error with a readable message.
 */
export function parseAbiJson(text: string): Abi {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error('Not valid JSON')
  }
  if (typeof json === 'string') {
    try {
      json = JSON.parse(json)
    } catch {
      throw new Error('Not valid JSON')
    }
  }
  if (json && !Array.isArray(json) && typeof json === 'object' && Array.isArray((json as { abi?: unknown }).abi)) {
    json = (json as { abi: unknown }).abi
  }
  if (!Array.isArray(json)) throw new Error('ABI must be a JSON array')
  if (json.length === 0) throw new Error('ABI is empty')
  const out = json.map((item, i): unknown => {
    const where = `ABI item ${i}`
    if (!item || typeof item !== 'object') throw new Error(`${where} is not an object`)
    const it = item as Record<string, unknown>
    if (typeof it.type !== 'string' || !ITEM_TYPES.has(it.type)) throw new Error(`${where} has an invalid "type"`)
    if (it.type === 'function' || it.type === 'event' || it.type === 'error') {
      if (typeof it.name !== 'string' || it.name === '') throw new Error(`${where} is missing "name"`)
    }
    const inputs = it.inputs === undefined ? [] : it.inputs
    if (!Array.isArray(inputs)) throw new Error(`${where}: "inputs" must be an array`)
    inputs.forEach((p, j) => validateParam(p, `${where}.inputs[${j}]`))
    if (it.type === 'function') {
      const outputs = it.outputs === undefined ? [] : it.outputs
      if (!Array.isArray(outputs)) throw new Error(`${where}: "outputs" must be an array`)
      outputs.forEach((p, j) => validateParam(p, `${where}.outputs[${j}]`))
      let sm = it.stateMutability
      if (sm === undefined) sm = it.constant ? 'view' : it.payable ? 'payable' : 'nonpayable'
      if (!['pure', 'view', 'nonpayable', 'payable'].includes(sm as string)) throw new Error(`${where}: invalid stateMutability`)
      return { ...it, inputs, outputs, stateMutability: sm }
    }
    return { ...it, inputs }
  })
  if (!out.some((x) => (x as { type: string }).type === 'function')) throw new Error('ABI has no functions')
  return out as Abi
}

export function abiFunctions(abi: Abi): AbiFunction[] {
  return abi.filter((x): x is AbiFunction => x.type === 'function')
}
export const isReadFunction = (f: AbiFunction) => f.stateMutability === 'view' || f.stateMutability === 'pure'

export type AbiFetchResult = { ok: true; abi: Abi } | { ok: false; error: string }

/**
 * Etherscan v2 getabi (chainid 80002). Never throws. Works without an API key only if the service allows it;
 * otherwise returns a readable failure so the UI can fall back to pasting the ABI.
 */
export async function fetchEtherscanAbi(
  address: Address,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AbiFetchResult> {
  const params = new URLSearchParams({ chainid: '80002', module: 'contract', action: 'getabi', address })
  if (apiKey) params.set('apikey', apiKey)
  let body: { status?: string; message?: string; result?: unknown }
  try {
    const res = await fetchImpl(`https://api.etherscan.io/v2/api?${params.toString()}`)
    if (!res.ok) return { ok: false, error: `Explorer API responded with HTTP ${res.status}` }
    body = await res.json()
  } catch {
    return { ok: false, error: 'Could not reach the Etherscan API (network, CORS or blocked). Paste the ABI instead.' }
  }
  if (body.status !== '1' || typeof body.result !== 'string') {
    const detail = typeof body.result === 'string' ? body.result : (body.message ?? 'unknown error')
    const hint = apiKey ? '' : ' (no VITE_EXPLORER_API_KEY set)'
    return { ok: false, error: `Explorer: ${detail}${hint}` }
  }
  try {
    return { ok: true, abi: parseAbiJson(body.result) }
  } catch (e) {
    return { ok: false, error: `Explorer returned an unusable ABI: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Pure: extract an implementation address from a raw EIP-1967 slot value, or null if empty. */
export function implementationFromSlot(slot: Hex | undefined | null): Address | null {
  if (!slot) return null
  const hex = slot.replace(/^0x/, '').padStart(64, '0')
  const addr = hex.slice(24)
  if (/^0+$/.test(addr)) return null
  return `0x${addr}` as Address
}

/** Read the EIP-1967 implementation slot. Returns null if not a proxy or the read fails. */
export async function detectEip1967Implementation(client: PublicClient, address: Address): Promise<Address | null> {
  try {
    const slot = await client.getStorageAt({ address, slot: EIP1967_IMPL_SLOT })
    return implementationFromSlot(slot)
  } catch {
    return null
  }
}
