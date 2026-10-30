import type { Address } from 'viem'

const a = (addr: Address | string) => addr.toLowerCase()

/** Central TanStack Query keys so features can invalidate each other's data consistently. */
export const safeKeys = {
  all: (safe: Address) => ['safe', a(safe)] as const,
  info: (safe: Address) => ['safe', a(safe), 'info'] as const,
  queue: (safe: Address) => ['safe', a(safe), 'queue'] as const,
  votes: (safe: Address) => ['safe', a(safe), 'votes'] as const,
  history: (safe: Address) => ['safe', a(safe), 'history'] as const,
}
