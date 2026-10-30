function errorText(err: unknown, depth = 0): string {
  if (err == null || depth > 5) return ''
  if (typeof err === 'string') return err
  if (typeof err === 'object') {
    const e = err as Record<string, unknown>
    return [
      typeof e.shortMessage === 'string' ? e.shortMessage : '',
      typeof e.message === 'string' ? e.message : '',
      typeof e.details === 'string' ? e.details : '',
      typeof e.status === 'number' ? `status ${e.status}` : '',
      typeof e.code === 'number' ? `code ${e.code}` : '',
      errorText(e.cause, depth + 1),
    ].join(' ')
  }
  return String(err)
}

/** HTTP 429 / provider "rate limit" style errors. */
export function isRateLimitError(err: unknown): boolean {
  return /\b429\b|rate.?limit|too many requests|request limit|limit exceeded|code -32005/i.test(errorText(err))
}

/** Provider complaints about eth_getLogs block range / result size. */
export function isRangeError(err: unknown): boolean {
  return /block range|range (is )?too|exceed(s|ed)? (the )?(max|limit|range)|too many (results|logs)|more than \d+ results|query returned more|limited to|max(imum)? (block )?range/i.test(
    errorText(err),
  )
}

/** Transient transport problems worth retrying. */
export function isTransientRpcError(err: unknown): boolean {
  return /timeout|timed out|failed to fetch|network|fetch failed|ECONN|ETIMEDOUT|5\d\d\b|HTTP request failed|temporarily/i.test(
    errorText(err),
  )
}

export function isRetryableRpcError(err: unknown): boolean {
  return isRateLimitError(err) || isTransientRpcError(err)
}

export interface BackoffOptions {
  retries?: number
  baseMs?: number
  maxMs?: number
  shouldRetry?: (err: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Run fn, retrying with exponential backoff (+ jitter) while shouldRetry(err). */
export async function withBackoff<T>(fn: () => Promise<T>, opts: BackoffOptions = {}): Promise<T> {
  const { retries = 4, baseMs = 500, maxMs = 8000, shouldRetry = isRetryableRpcError, sleep = defaultSleep } = opts
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err
      const delay = Math.min(maxMs, baseMs * 2 ** attempt) + Math.floor(Math.random() * 100)
      opts.onRetry?.(err, attempt + 1, delay)
      await sleep(delay)
    }
  }
}
