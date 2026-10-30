import { describe, expect, it } from 'vitest'
import { encodeFunctionData, parseAbi, type AbiFunction, type AbiParameter, type Hex } from 'viem'
import {
  canonicalType,
  decodeCall,
  emptyValue,
  encodeCall,
  functionSignature,
  parseAddressInput,
  parseNativeAmount,
  parseParam,
  parseRawCalldata,
  type FormValue,
} from './abiForm'
import { implementationFromSlot, parseAbiJson } from './abiSource'

const A = '0x000000000000000000000000000000000000dEaD'
const p = (type: string, extra: object = {}): AbiParameter => ({ type, name: 'x', ...extra }) as AbiParameter
const fn = (inputs: AbiParameter[], name = 'f'): AbiFunction => ({
  type: 'function',
  name,
  inputs,
  outputs: [],
  stateMutability: 'nonpayable',
})

describe('scalars', () => {
  it('address: accepts valid, rejects bad', () => {
    expect(parseParam(p('address'), A.toLowerCase())).toBe(A)
    expect(() => parseParam(p('address'), '0x123')).toThrow(/invalid address/)
    expect(() => parseParam(p('address'), A.replace('dEaD', 'DeAd'))).toThrow(/checksum/)
  })
  it('uint: decimal, hex, bounds', () => {
    expect(parseParam(p('uint256'), '123')).toBe(123n)
    expect(parseParam(p('uint8'), '0xff')).toBe(255n)
    expect(() => parseParam(p('uint8'), '256')).toThrow(/out of range/)
    expect(() => parseParam(p('uint8'), '-1')).toThrow(/out of range/)
    expect(() => parseParam(p('uint256'), '1.5')).toThrow(/integer/)
    expect(() => parseParam(p('uint256'), '')).toThrow(/required/)
    const max = (1n << 256n) - 1n
    expect(parseParam(p('uint256'), max.toString())).toBe(max)
    expect(() => parseParam(p('uint256'), (max + 1n).toString())).toThrow(/out of range/)
  })
  it('int: negative and bounds', () => {
    expect(parseParam(p('int8'), '-128')).toBe(-128n)
    expect(parseParam(p('int8'), '127')).toBe(127n)
    expect(() => parseParam(p('int8'), '128')).toThrow(/out of range/)
    expect(() => parseParam(p('int8'), '-129')).toThrow(/out of range/)
    expect(parseParam(p('int'), '-5')).toBe(-5n)
  })
  it('bool', () => {
    expect(parseParam(p('bool'), 'true')).toBe(true)
    expect(parseParam(p('bool'), 'FALSE')).toBe(false)
    expect(() => parseParam(p('bool'), 'yes')).toThrow(/true or false/)
  })
  it('bytes and bytesN', () => {
    expect(parseParam(p('bytes'), '0xabcd')).toBe('0xabcd')
    expect(parseParam(p('bytes'), '')).toBe('0x')
    expect(() => parseParam(p('bytes'), '0xabc')).toThrow(/even/)
    expect(() => parseParam(p('bytes'), 'abcd')).toThrow()
    expect(parseParam(p('bytes4'), '0xdeadbeef')).toBe('0xdeadbeef')
    expect(() => parseParam(p('bytes4'), '0xdead')).toThrow(/exactly 4 bytes/)
    expect(() => parseParam(p('bytes32'), '0xzz')).toThrow()
  })
  it('string passes through unchanged', () => {
    expect(parseParam(p('string'), '  héllo ')).toBe('  héllo ')
  })
  it('unsupported type', () => {
    expect(() => parseParam(p('function'), 'x')).toThrow(/unsupported/)
  })
})

describe('arrays', () => {
  it('dynamic array', () => {
    expect(parseParam(p('uint256[]'), ['1', '2', '3'])).toEqual([1n, 2n, 3n])
    expect(parseParam(p('uint256[]'), [])).toEqual([])
  })
  it('fixed array length enforced and pre-sized', () => {
    expect(emptyValue(p('address[3]'))).toEqual(['', '', ''])
    expect(() => parseParam(p('uint256[2]'), ['1'])).toThrow(/exactly 2/)
  })
  it('error path points at the failing element', () => {
    expect(() => parseParam(p('uint8[]'), ['1', '999'], 'ids')).toThrow(/ids\[1\]/)
  })
  it('nested arrays', () => {
    expect(parseParam(p('uint256[][2]'), [['1', '2'], []])).toEqual([[1n, 2n], []])
    expect(emptyValue(p('uint256[][2]'))).toEqual([[], []])
  })
  it('rejects scalar for array', () => {
    expect(() => parseParam(p('uint256[]'), '1')).toThrow(/list/)
  })
})

describe('tuples', () => {
  const tuple = p('tuple', {
    components: [
      { type: 'address', name: 'to' },
      { type: 'uint256', name: 'amount' },
    ],
  })
  it('named tuple becomes object', () => {
    expect(parseParam(tuple, [A, '5'])).toEqual({ to: A, amount: 5n })
  })
  it('unnamed tuple becomes array', () => {
    const t = p('tuple', { components: [{ type: 'bool' }, { type: 'uint8' }] })
    expect(parseParam(t, ['true', '2'])).toEqual([true, 2n])
  })
  it('error path nests', () => {
    expect(() => parseParam(tuple, [A, 'abc'], 'order')).toThrow(/order\.amount/)
  })
  it('wrong arity', () => {
    expect(() => parseParam(tuple, [A])).toThrow(/2 fields/)
  })
  it('tuple[] with nested tuple and arrays', () => {
    const t = p('tuple[]', {
      components: [
        { type: 'uint256[]', name: 'ids' },
        { type: 'tuple', name: 'inner', components: [{ type: 'bytes2', name: 'b' }] },
      ],
    })
    expect(parseParam(t, [[['1', '2'], ['0xabcd']], [[], ['0x0001']]])).toEqual([
      { ids: [1n, 2n], inner: { b: '0xabcd' } },
      { ids: [], inner: { b: '0x0001' } },
    ])
    expect(emptyValue(t)).toEqual([])
    expect(canonicalType(t)).toBe('(uint256[],(bytes2))[]')
  })
})

describe('encodeCall', () => {
  it('matches viem encoding for transfer', () => {
    const abi = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])
    const f = abi[0] as AbiFunction
    const r = encodeCall(f, [A, '1000'])
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data).toBe(encodeFunctionData({ abi, functionName: 'transfer', args: [A, 1000n] }))
      expect(r.data.startsWith('0xa9059cbb')).toBe(true)
    }
  })
  it('no-arg function is just the selector', () => {
    const r = encodeCall(fn([], 'pause'), [])
    expect(r.ok && r.data.length).toBe(10)
  })
  it('returns error, never throws', () => {
    const r = encodeCall(fn([p('uint8')]), ['300'])
    expect(r).toEqual({ ok: false, error: expect.stringContaining('out of range') })
  })
  it('complex round trip through decodeCall', () => {
    const f = fn([
      p('tuple[]', {
        name: 'orders',
        components: [
          { type: 'address', name: 'to' },
          { type: 'int16[]', name: 'deltas' },
        ],
      }),
      p('string', { name: 's' }),
      p('bytes', { name: 'b' }),
      p('bool', { name: 'flag' }),
    ])
    const values: FormValue[] = [[[A, ['-1', '2']]], 'hi', '0x01', 'true']
    const r = encodeCall(f, values)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const d = decodeCall(f, r.data)
    expect(d?.args.map((a) => a.name)).toEqual(['orders', 's', 'b', 'flag'])
    expect(d?.args[0].value).toContain('deltas: [-1, 2]')
    expect(d?.args[3].value).toBe('true')
    expect(d?.signature).toBe('f((address,int16[])[],string,bytes,bool)')
  })
  it('decodeCall returns null for mismatched data', () => {
    expect(decodeCall(fn([p('uint256')]), '0xdeadbeef')).toBeNull()
  })
  it('overload signatures differ', () => {
    expect(functionSignature(fn([p('uint256')]))).toBe('f(uint256)')
    expect(functionSignature(fn([p('address')]))).toBe('f(address)')
  })
})

describe('native / raw / address helpers', () => {
  it('parseNativeAmount', () => {
    expect(parseNativeAmount('')).toEqual({ ok: true, wei: 0n })
    expect(parseNativeAmount('1.5')).toEqual({ ok: true, wei: 1_500_000_000_000_000_000n })
    expect(parseNativeAmount('.5')).toEqual({ ok: true, wei: 500_000_000_000_000_000n })
    expect(parseNativeAmount('-1').ok).toBe(false)
    expect(parseNativeAmount('abc').ok).toBe(false)
    expect(parseNativeAmount('1.0000000000000000001').ok).toBe(false)
  })
  it('parseRawCalldata', () => {
    expect(parseRawCalldata('')).toEqual({ ok: true, data: '0x' })
    expect(parseRawCalldata('0xa9059cbb')).toEqual({ ok: true, data: '0xa9059cbb' })
    expect(parseRawCalldata('a9059cbb').ok).toBe(false)
    expect(parseRawCalldata('0xabc').ok).toBe(false)
  })
  it('parseAddressInput', () => {
    expect(parseAddressInput(A.toLowerCase())).toEqual({ ok: true, address: A })
    expect(parseAddressInput('nope').ok).toBe(false)
  })
})

describe('ABI JSON + proxy slot', () => {
  const good = JSON.stringify([{ type: 'function', name: 'a', inputs: [], outputs: [], stateMutability: 'view' }])
  it('accepts array, artifact object, legacy constant flag', () => {
    expect(parseAbiJson(good)).toHaveLength(1)
    expect(parseAbiJson(JSON.stringify({ abi: JSON.parse(good) }))).toHaveLength(1)
    const legacy = parseAbiJson(JSON.stringify([{ type: 'function', name: 'a', constant: true }]))
    expect(legacy[0]).toMatchObject({ stateMutability: 'view', inputs: [] })
  })
  it('rejects bad input with messages', () => {
    expect(() => parseAbiJson('{oops')).toThrow(/valid JSON/)
    expect(() => parseAbiJson('{"a":1}')).toThrow(/array/)
    expect(() => parseAbiJson('[]')).toThrow(/empty/)
    expect(() => parseAbiJson('[{"type":"function"}]')).toThrow(/name/)
    expect(() => parseAbiJson('[{"type":"function","name":"a","inputs":[{"name":"x"}]}]')).toThrow(/type/)
    expect(() => parseAbiJson('[{"type":"function","name":"a","inputs":[{"type":"tuple"}]}]')).toThrow(/components/)
    expect(() => parseAbiJson('[{"type":"event","name":"E","inputs":[]}]')).toThrow(/no functions/)
  })
  it('implementationFromSlot', () => {
    expect(implementationFromSlot(('0x' + '0'.repeat(64)) as Hex)).toBeNull()
    expect(implementationFromSlot(('0x' + '0'.repeat(24) + 'ab'.repeat(20)) as Hex)).toBe('0x' + 'ab'.repeat(20))
    expect(implementationFromSlot(undefined)).toBeNull()
  })
})
