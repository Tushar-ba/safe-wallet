import { useSyncExternalStore } from 'react'
import { getAddress, isAddress, type Address } from 'viem'
import { getJSON, setJSON } from '../../lib/storage'

export const SAVED_SAFES_KEY = 'safeapp:saved-safes:v1'

export interface SavedSafe {
  address: Address
  name?: string
  addedAt: number
}

/** Drop malformed entries and duplicates (case-insensitive); normalises to checksum addresses. */
export function sanitizeSavedSafes(raw: unknown): SavedSafe[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedSafe[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const { address, name, addedAt } = r as Record<string, unknown>
    if (typeof address !== 'string' || !isAddress(address, { strict: false })) continue
    const checksummed = getAddress(address)
    if (seen.has(checksummed.toLowerCase())) continue
    seen.add(checksummed.toLowerCase())
    const trimmed = typeof name === 'string' ? name.trim().slice(0, 40) : ''
    out.push({ address: checksummed, ...(trimmed ? { name: trimmed } : {}), addedAt: typeof addedAt === 'number' ? addedAt : 0 })
  }
  return out
}

/** Pure: add (or keep existing) entry. */
export function addSafe(list: SavedSafe[], address: Address, name?: string, now = Date.now()): SavedSafe[] {
  const a = getAddress(address)
  const existing = list.find((s) => s.address.toLowerCase() === a.toLowerCase())
  if (existing) {
    const n = name?.trim()
    return n ? renameSafe(list, a, n) : list
  }
  const n = name?.trim().slice(0, 40)
  return [...list, { address: a, ...(n ? { name: n } : {}), addedAt: now }]
}

export function removeSafe(list: SavedSafe[], address: Address): SavedSafe[] {
  return list.filter((s) => s.address.toLowerCase() !== address.toLowerCase())
}

/** Pure: set/clear nickname (empty clears). Does nothing if the Safe is not in the list. */
export function renameSafe(list: SavedSafe[], address: Address, name: string): SavedSafe[] {
  const n = name.trim().slice(0, 40)
  return list.map((s) => {
    if (s.address.toLowerCase() !== address.toLowerCase()) return s
    const { name: _old, ...rest } = s
    void _old
    return n ? { ...rest, name: n } : rest
  })
}

// ---- tiny external store so Home, header and create flow stay in sync ----
const listeners = new Set<() => void>()
let cache: SavedSafe[] | null = null
let cacheRaw: string | null = null

function read(): SavedSafe[] {
  // re-read from storage each time the snapshot is requested but keep identity stable if unchanged
  const raw = JSON.stringify(getJSON<unknown>(SAVED_SAFES_KEY, []))
  if (cache && raw === cacheRaw) return cache
  cacheRaw = raw
  cache = sanitizeSavedSafes(JSON.parse(raw))
  return cache
}

function write(list: SavedSafe[]) {
  setJSON(SAVED_SAFES_KEY, list)
  cache = null
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  const onStorage = (e: StorageEvent) => {
    if (e.key === SAVED_SAFES_KEY) l()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(l)
    window.removeEventListener('storage', onStorage)
  }
}

export const savedSafesStore = {
  get: read,
  add: (address: Address, name?: string) => write(addSafe(read(), address, name)),
  remove: (address: Address) => write(removeSafe(read(), address)),
  rename: (address: Address, name: string) => write(renameSafe(read(), address, name)),
}

export function useSavedSafes(): SavedSafe[] {
  return useSyncExternalStore(subscribe, read, read)
}
