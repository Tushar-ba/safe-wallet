export const SAFE_ERRORS: Record<string, string> = {
  GS000: 'Could not finish Safe initialization.',
  GS001: 'Threshold needs to be defined.',
  GS010: 'Not enough gas to execute the Safe transaction.',
  GS011: 'Could not pay gas costs with ether.',
  GS012: 'Could not pay gas costs with token.',
  GS013: 'The inner call failed (a Safe tx with zero gas price and zero safeTxGas reverts when its call fails). Check the target call, value and Safe balance.',
  GS020: 'Signatures data is too short.',
  GS021: 'Invalid contract signature location: inside the static part.',
  GS022: 'Invalid contract signature location: length not present.',
  GS023: 'Invalid contract signature location: data not complete.',
  GS024: 'Invalid contract signature provided.',
  GS025: 'This hash has not been approved by one of the signers.',
  GS026: 'A signature came from an address that is not an owner (or signers are not sorted/unique).',
  GS030: 'Only owners can approve a hash.',
  GS031: 'This method can only be called by the Safe itself.',
  GS100: 'Modules have already been initialized.',
  GS101: 'Invalid module address provided.',
  GS102: 'Invalid prevModule/module pair provided.',
  GS103: 'Invalid page size provided.',
  GS104: 'This method can only be called from an enabled module.',
  GS105: 'Invalid starting point for fallback handler.',
  GS106: 'Invalid module/handler address provided.',
  GS200: 'Owners have already been set up.',
  GS201: 'Threshold cannot exceed the number of owners.',
  GS202: 'Threshold needs to be greater than 0.',
  GS203: 'Invalid owner address provided.',
  GS204: 'Address is already an owner.',
  GS205: 'Invalid prevOwner/owner pair provided.',
  GS300: 'Guard was set with an invalid address.',
}

export function describeSafeCode(code: string): string {
  return SAFE_ERRORS[code] ?? `Safe error ${code}.`
}

function collectText(err: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 6 || err == null) return out
  if (typeof err === 'string') {
    out.push(err)
    return out
  }
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    for (const k of ['shortMessage', 'reason', 'message', 'details']) {
      if (typeof e[k] === 'string') out.push(e[k] as string)
    }
    if (e.data && typeof e.data === 'object') {
      const d = e.data as Record<string, unknown>
      if (typeof d.errorName === 'string') out.push(d.errorName)
      if (Array.isArray(d.args)) d.args.forEach((a) => typeof a === 'string' && out.push(a))
    }
    collectText(e.cause, depth + 1, out)
  }
  return out
}

/** Returns the first GSxxx code found in an error (walking the cause chain), or null. */
export function extractSafeCode(err: unknown): string | null {
  for (const t of collectText(err)) {
    const m = /GS\d{3}/.exec(t)
    if (m) return m[0]
  }
  return null
}

/** Plain-text message for any error thrown by viem/wagmi/wallets. */
export function friendlyError(err: unknown): string {
  const code = extractSafeCode(err)
  if (code) return `${code}: ${describeSafeCode(code)}`
  const texts = collectText(err)
  const joined = texts.join(' ')
  if (/user rejected|user denied|rejected the request/i.test(joined)) return 'You rejected the request in your wallet.'
  if (/NotSafeOwner/.test(joined)) return 'Only an owner of this Safe can do that.'
  if (/insufficient funds/i.test(joined)) return 'Insufficient funds to pay for gas.'
  return texts[0] ?? 'Unknown error.'
}
