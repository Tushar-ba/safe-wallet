/** localStorage helpers that never throw (private mode, blocked storage, bad JSON). */

export function getItem(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export function setItem(key: string, value: string): boolean {
  try {
    globalThis.localStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

export function removeItem(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function getJSON<T>(key: string, fallback: T): T {
  const raw = getItem(key)
  if (raw === null) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function setJSON(key: string, value: unknown): boolean {
  try {
    return setItem(key, JSON.stringify(value))
  } catch {
    return false
  }
}
