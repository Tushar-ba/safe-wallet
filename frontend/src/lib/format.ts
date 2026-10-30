import { formatEther } from 'viem'

export function shortAddress(address: string, head = 6, tail = 4): string {
  return address.length <= head + tail + 2 ? address : `${address.slice(0, head)}...${address.slice(-tail)}`
}

/** wei -> "1.2345" (trimmed to maxDecimals, no trailing zeros). */
export function formatNative(wei: bigint, maxDecimals = 4): string {
  const s = formatEther(wei)
  const [i, f = ''] = s.split('.')
  const frac = f.slice(0, maxDecimals).replace(/0+$/, '')
  return frac ? `${i}.${frac}` : i
}
