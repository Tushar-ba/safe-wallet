import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isHex,
  parseEther,
  size,
  type Abi,
  type AbiFunction,
  type AbiParameter,
  type Address,
  type Hex,
} from 'viem'

/**
 * Pure ABI-form logic: raw form values (strings / nested arrays) -> typed values -> calldata.
 * No React, no network.
 *
 * FormValue shape per ABI type:
 *  - scalar (address, uintN, intN, bool, bytes, bytesN, string): string
 *  - T[] / T[n]: FormValue[] (one entry per element)
 *  - tuple: FormValue[] (one entry per component, in ABI order)
 */
export type FormValue = string | FormValue[]

export class AbiFormError extends Error {
  path: string
  constructor(path: string, message: string) {
    super(path ? `${path}: ${message}` : message)
    this.name = 'AbiFormError'
    this.path = path
  }
}

const ARRAY_RE = /^(.*)\[(\d*)\]$/

/** Split `uint256[2][]` into element param (`uint256[2]`) and fixed length (undefined = dynamic). */
export function splitArrayType(param: AbiParameter): { element: AbiParameter; length: number | undefined } | null {
  const m = ARRAY_RE.exec(param.type)
  if (!m) return null
  return { element: { ...param, type: m[1] } as AbiParameter, length: m[2] === '' ? undefined : Number(m[2]) }
}

export function isTupleParam(param: AbiParameter): param is AbiParameter & { components: readonly AbiParameter[] } {
  return param.type === 'tuple' && 'components' in param && Array.isArray((param as { components?: unknown }).components)
}

/** Canonical type string with tuples expanded, e.g. `(address,uint256)[]`. */
export function canonicalType(param: AbiParameter): string {
  const arr = splitArrayType(param)
  if (arr) return `${canonicalType(arr.element)}[${arr.length ?? ''}]`
  if (isTupleParam(param)) return `(${param.components.map(canonicalType).join(',')})`
  return param.type
}

export function functionSignature(fn: Pick<AbiFunction, 'name' | 'inputs'>): string {
  return `${fn.name}(${fn.inputs.map(canonicalType).join(',')})`
}

/** Initial (empty) form value for a parameter. Fixed arrays are pre-sized; dynamic arrays start empty. */
export function emptyValue(param: AbiParameter): FormValue {
  const arr = splitArrayType(param)
  if (arr) return arr.length === undefined ? [] : Array.from({ length: arr.length }, () => emptyValue(arr.element))
  if (isTupleParam(param)) return param.components.map(emptyValue)
  if (param.type === 'bool') return 'false'
  return ''
}

const label = (path: string, param: AbiParameter, index: number) =>
  `${path ? path + '.' : ''}${param.name ? param.name : `arg${index}`}`

function parseIntegerString(raw: string, path: string): bigint {
  const s = raw.trim()
  if (s === '') throw new AbiFormError(path, 'value is required')
  if (/^-?\d+$/.test(s) || /^-?0x[0-9a-fA-F]+$/.test(s)) {
    try {
      if (s.startsWith('-0x')) return -BigInt(s.slice(1))
      return BigInt(s)
    } catch {
      /* fallthrough */
    }
  }
  throw new AbiFormError(path, 'must be an integer (decimal or 0x hex)')
}

/** Convert one form value to a typed JS value for viem. Throws AbiFormError with a path on bad input. */
export function parseParam(param: AbiParameter, raw: FormValue | undefined, path = ''): unknown {
  const arr = splitArrayType(param)
  if (arr) {
    if (!Array.isArray(raw)) throw new AbiFormError(path, 'expected a list of values')
    if (arr.length !== undefined && raw.length !== arr.length)
      throw new AbiFormError(path, `expected exactly ${arr.length} items, got ${raw.length}`)
    return raw.map((item, i) => parseParam(arr.element, item, `${path}[${i}]`))
  }
  if (isTupleParam(param)) {
    if (!Array.isArray(raw) || raw.length !== param.components.length)
      throw new AbiFormError(path, `expected ${param.components.length} fields`)
    // Return an object when all components are named, otherwise an array (viem accepts both).
    const values = param.components.map((c, i) => parseParam(c, raw[i], label(path, c, i)))
    if (param.components.every((c) => !!c.name)) {
      return Object.fromEntries(param.components.map((c, i) => [c.name as string, values[i]]))
    }
    return values
  }
  if (typeof raw !== 'string') throw new AbiFormError(path, 'expected a single value')
  const type = param.type

  if (type === 'address') {
    const s = raw.trim()
    if (!isAddress(s)) throw new AbiFormError(path, 'invalid address (bad format or checksum)')
    return getAddress(s)
  }
  if (type === 'bool') {
    const s = raw.trim().toLowerCase()
    if (s === 'true') return true
    if (s === 'false') return false
    throw new AbiFormError(path, 'must be true or false')
  }
  if (type === 'string') return raw
  if (type === 'bytes') {
    const s = raw.trim()
    if (s === '') return '0x' as Hex
    if (!isHex(s, { strict: true }) || s.length % 2 !== 0) throw new AbiFormError(path, 'must be 0x hex with an even number of digits')
    return s as Hex
  }
  const bytesN = /^bytes(\d+)$/.exec(type)
  if (bytesN) {
    const n = Number(bytesN[1])
    const s = raw.trim()
    if (!isHex(s, { strict: true }) || s.length % 2 !== 0) throw new AbiFormError(path, 'must be 0x hex with an even number of digits')
    if (size(s as Hex) !== n) throw new AbiFormError(path, `must be exactly ${n} bytes (${n * 2} hex digits)`)
    return s as Hex
  }
  const intM = /^(u?)int(\d*)$/.exec(type)
  if (intM) {
    const unsigned = intM[1] === 'u'
    const bits = intM[2] === '' ? 256 : Number(intM[2])
    const v = parseIntegerString(raw, path)
    const min = unsigned ? 0n : -(1n << BigInt(bits - 1))
    const max = unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n
    if (v < min || v > max) throw new AbiFormError(path, `out of range for ${type} (${min} to ${max})`)
    return v
  }
  throw new AbiFormError(path, `unsupported type "${type}"`)
}

export function parseInputs(inputs: readonly AbiParameter[], values: readonly FormValue[]): unknown[] {
  return inputs.map((p, i) => parseParam(p, values[i], label('', p, i)))
}

export type EncodeResult =
  | { ok: true; args: unknown[]; data: Hex }
  | { ok: false; error: string }

/** Parse + encode calldata for a function from raw form values. Never throws. */
export function encodeCall(fn: AbiFunction, values: readonly FormValue[]): EncodeResult {
  try {
    const args = parseInputs(fn.inputs, values)
    const data = encodeFunctionData({ abi: [fn] as Abi, functionName: fn.name, args } as never)
    return { ok: true, args, data }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e) }
  }
}

/** Human-readable rendering of a decoded value (bigints as decimal strings, bytes as hex). */
export function formatValue(v: unknown): string {
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return String(v)
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`
  if (v && typeof v === 'object') {
    return `{ ${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${k}: ${formatValue(x)}`)
      .join(', ')} }`
  }
  return String(v)
}

export interface DecodedCall {
  functionName: string
  signature: string
  args: { name: string; type: string; value: string }[]
}

/** Decode calldata against one function (round trip, used for the "decoded preview"). Null if it does not match. */
export function decodeCall(fn: AbiFunction, data: Hex): DecodedCall | null {
  try {
    const d = decodeFunctionData({ abi: [fn] as Abi, data })
    const args = (d.args ?? []) as readonly unknown[]
    return {
      functionName: d.functionName,
      signature: functionSignature(fn),
      args: fn.inputs.map((p, i) => ({ name: p.name || `arg${i}`, type: canonicalType(p), value: formatValue(args[i]) })),
    }
  } catch {
    return null
  }
}

/** Decode calldata against a whole ABI (used for raw calldata preview). */
export function decodeCallWithAbi(abi: Abi, data: Hex): DecodedCall | null {
  try {
    const d = decodeFunctionData({ abi, data })
    const fn = abi.find(
      (x): x is AbiFunction => x.type === 'function' && x.name === d.functionName && x.inputs.length === (d.args?.length ?? 0),
    )
    if (!fn) return null
    return decodeCall(fn, data)
  } catch {
    return null
  }
}

export type ParsedNative = { ok: true; wei: bigint } | { ok: false; error: string }

/** Parse a POL amount (decimal string, up to 18 decimals). Empty = 0. */
export function parseNativeAmount(input: string): ParsedNative {
  const s = input.trim()
  if (s === '') return { ok: true, wei: 0n }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return { ok: false, error: 'Enter a positive decimal number' }
  const frac = s.split('.')[1] ?? ''
  if (frac.length > 18) return { ok: false, error: 'At most 18 decimals' }
  try {
    return { ok: true, wei: parseEther(s.endsWith('.') ? s.slice(0, -1) : s) }
  } catch {
    return { ok: false, error: 'Invalid amount' }
  }
}

export type ParsedRaw = { ok: true; data: Hex } | { ok: false; error: string }

/** Validate raw calldata input. Empty or "0x" = empty data. */
export function parseRawCalldata(input: string): ParsedRaw {
  const s = input.trim()
  if (s === '' || s === '0x') return { ok: true, data: '0x' }
  if (!isHex(s, { strict: true })) return { ok: false, error: 'Calldata must be 0x-prefixed hex' }
  if (s.length % 2 !== 0) return { ok: false, error: 'Calldata has an odd number of hex digits' }
  return { ok: true, data: s as Hex }
}

export type ParsedAddress = { ok: true; address: Address } | { ok: false; error: string }
export function parseAddressInput(input: string): ParsedAddress {
  const s = input.trim()
  if (!isAddress(s)) return { ok: false, error: 'Invalid address (check format and checksum)' }
  return { ok: true, address: getAddress(s) }
}
