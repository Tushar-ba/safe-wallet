import { describe, expect, it } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, getAddress, zeroAddress } from 'viem'
import { decodeSetupInitializer, encodeSetupInitializer, parseProxyCreation, randomSaltNonce, validateSafeSetup } from './logic'
import { parseAddressInput } from '../home/validate'
import { addSafe, removeSafe, renameSafe, sanitizeSavedSafes } from '../home/savedSafes'
import { safeProxyFactoryAbi } from '../../lib/abis'

const A = '0x1111111111111111111111111111111111111111'
const B = '0x2222222222222222222222222222222222222222'
const FH = '0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99'
const FACTORY = '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67'

describe('validateSafeSetup', () => {
  it('accepts valid owners and threshold', () => {
    expect(validateSafeSetup([A, B], 2).valid).toBe(true)
  })
  it('flags invalid, empty, zero, sentinel and duplicate (case-insensitive) owners', () => {
    const r = validateSafeSetup(['0x123', '', zeroAddress, '0x0000000000000000000000000000000000000001', A, A.toUpperCase().replace('0X', '0x')], 1)
    expect(Object.keys(r.rowErrors).map(Number)).toEqual([0, 1, 2, 3, 5])
    expect(r.valid).toBe(false)
  })
  it('rejects bad checksum on mixed-case address', () => {
    const good = getAddress(FH)
    const bad = good.slice(0, 5) + good.slice(5).replace(/[a-f]/, (c) => c.toUpperCase())
    expect(validateSafeSetup([good], 1).valid).toBe(true)
    expect(validateSafeSetup([bad === good ? good.toLowerCase().replace('d', 'D') : bad], 1).valid).toBe(false)
  })
  it('validates threshold bounds', () => {
    expect(validateSafeSetup([A, B], 0).thresholdError).toBeTruthy()
    expect(validateSafeSetup([A, B], 3).thresholdError).toBeTruthy()
    expect(validateSafeSetup([A, B], 1.5).thresholdError).toBeTruthy()
    expect(validateSafeSetup([], 1).valid).toBe(false)
  })
})

describe('setup initializer', () => {
  it('round-trips with fixed zero params and fallback handler', () => {
    const data = encodeSetupInitializer([A, B], 2, FH)
    expect(data.slice(0, 10)).toBe('0xb63e800d') // Safe.setup selector
    const [owners, threshold, to, d, fh, payTok, pay, payRecv] = decodeSetupInitializer(data)
    expect(owners).toEqual([getAddress(A), getAddress(B)])
    expect(threshold).toBe(2n)
    expect(to).toBe(zeroAddress)
    expect(d).toBe('0x')
    expect(fh).toBe(FH)
    expect(payTok).toBe(zeroAddress)
    expect(pay).toBe(0n)
    expect(payRecv).toBe(zeroAddress)
  })
})

describe('parseProxyCreation', () => {
  it('extracts the proxy address from the factory log', () => {
    const topics = encodeEventTopics({ abi: safeProxyFactoryAbi, eventName: 'ProxyCreation', args: { proxy: A } })
    const data = encodeAbiParameters([{ type: 'address' }], [B])
    const logs = [
      { address: '0x9999999999999999999999999999999999999999', topics, data },
      { address: FACTORY, topics, data },
    ] as never
    expect(parseProxyCreation({ logs }, FACTORY)).toBe(getAddress(A))
    expect(parseProxyCreation({ logs: [] as never }, FACTORY)).toBeNull()
  })
  it('random salt nonce differs', () => {
    expect(randomSaltNonce()).not.toBe(randomSaltNonce())
  })
})

describe('home helpers', () => {
  it('parseAddressInput', () => {
    expect(parseAddressInput('').ok).toBe(false)
    expect(parseAddressInput('hello').ok).toBe(false)
    expect(parseAddressInput(` ${A} `)).toEqual({ ok: true, address: getAddress(A) })
    const r = parseAddressInput(FH.toLowerCase())
    expect(r.ok && r.address).toBe(FH)
    expect(parseAddressInput(FH.replace('Dc', 'dC')).ok).toBe(false)
  })
  it('saved list add/rename/remove/sanitize', () => {
    let l = addSafe([], A, '  Treasury ', 1)
    expect(l).toEqual([{ address: getAddress(A), name: 'Treasury', addedAt: 1 }])
    l = addSafe(l, A.toUpperCase().replace('0X', '0x') as `0x${string}`)
    expect(l).toHaveLength(1)
    l = renameSafe(l, A, '')
    expect(l[0].name).toBeUndefined()
    l = renameSafe(l, A, 'x')
    expect(l[0].name).toBe('x')
    expect(removeSafe(l, A)).toEqual([])
    expect(sanitizeSavedSafes([{ address: 'nope' }, { address: A }, { address: A }, 5, null])).toHaveLength(1)
    expect(sanitizeSavedSafes('x')).toEqual([])
  })
})
