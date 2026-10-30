import { describe, expect, it } from 'vitest'
import { describeSafeCode, extractSafeCode, friendlyError } from './safeErrors'

describe('safeErrors', () => {
  it('describes known and unknown codes', () => {
    expect(describeSafeCode('GS026')).toMatch(/not an owner/)
    expect(describeSafeCode('GS999')).toBe('Safe error GS999.')
  })
  it('extracts code from nested viem-like errors', () => {
    const err = { shortMessage: 'x', cause: { cause: { reason: 'GS025' } } }
    expect(extractSafeCode(err)).toBe('GS025')
    expect(friendlyError(new Error('execution reverted: GS013'))).toMatch(/^GS013: /)
  })
  it('maps wallet rejection and fallback', () => {
    expect(friendlyError({ message: 'User rejected the request.' })).toMatch(/rejected/)
    expect(friendlyError({})).toBe('Unknown error.')
  })
})
