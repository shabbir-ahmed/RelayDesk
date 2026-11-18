import { maxAttempts, timing } from './timing'

export type Outcome =
  | { kind: 'success'; status: number }
  | { kind: 'retry'; status?: number; error: string; retryAfterMs?: number }
  | { kind: 'permanent'; status?: number; error: string }

const maxRetryAfterMs = 5 * 60 * 1_000

function retryAfterDelay(value: string | undefined, now: number) {
  if (!value) return undefined
  const delay = /^\d+$/.test(value) ? Number(value) * 1_000
    : /^[a-z]{3,9},? /i.test(value) ? Date.parse(value) - now : NaN
  if (Number.isNaN(delay)) return undefined
  return Math.min(maxRetryAfterMs, Math.max(0, delay))
}

export function classifyHttp(status: number, retryAfter?: string, now = Date.now()): Outcome {
  if (status >= 200 && status < 300) return { kind: 'success', status }
  const error = `Receiver returned HTTP ${status}.`
  const transient = status === 408 || status === 429 || (status >= 500 && status <= 599)
  if (!transient) return { kind: 'permanent', status, error }
  const delay = retryAfterDelay(retryAfter, now)
  return { kind: 'retry', status, error, ...(delay !== undefined && { retryAfterMs: delay }) }
}

export function retryAt(now: Date, attempts: number, retryAfterMs?: number, random = Math.random) {
  if (attempts >= maxAttempts) return null
  const base = timing.retryMs[attempts - 1]
  const delay = retryAfterMs === undefined ? base : Math.max(retryAfterMs, Math.round(base * (0.8 + random() * 0.4)))
  return new Date(now.getTime() + delay)
}
