import { maxAttempts, timing } from './timing'

export type Outcome =
  | { kind: 'success'; status: number }
  | { kind: 'retry' | 'permanent'; status?: number; error: string }

export function classifyHttp(status: number): Outcome {
  if (status >= 200 && status < 300) return { kind: 'success', status }
  const transient = status === 408 || status === 429 || (status >= 500 && status <= 599)
  return { kind: transient ? 'retry' : 'permanent', status, error: `Receiver returned HTTP ${status}.` }
}

export function retryAt(now: Date, attempts: number) {
  if (attempts >= maxAttempts) return null
  return new Date(now.getTime() + timing.retryMs[attempts - 1])
}
