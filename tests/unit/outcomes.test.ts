import { expect, test } from 'vitest'
import { classifyHttp, retryAt } from '../../src/worker/outcomes'

test.each([408, 429, 500, 503, 599])('retries transient HTTP %i', (status) => {
  expect(classifyHttp(status)).toMatchObject({ kind: 'retry', status })
})
test.each([302, 400, 401, 404, 409])('does not retry HTTP %i', (status) => {
  expect(classifyHttp(status)).toMatchObject({ kind: 'permanent', status })
})
test('accepts 2xx and bounds retries to five and fifteen seconds', () => {
  expect(classifyHttp(299)).toEqual({ kind: 'success', status: 299 })
  expect(retryAt(new Date(0), 1)).toEqual(new Date(5_000))
  expect(retryAt(new Date(0), 2)).toEqual(new Date(15_000))
  expect(retryAt(new Date(0), 3)).toBeNull()
})

test('private retries honor numeric and HTTP-date hints within the retry budget', () => {
  const now = Date.UTC(2026, 10, 18)
  expect(classifyHttp(429, '45', now)).toMatchObject({ retryAfterMs: 45_000 })
  expect(classifyHttp(503, new Date(now + 60_000).toUTCString(), now)).toMatchObject({ retryAfterMs: 60_000 })
  expect(classifyHttp(503, '9999999999999999999999', now)).toMatchObject({ retryAfterMs: 300_000 })
  expect(classifyHttp(503, 'a minute', now)).not.toHaveProperty('retryAfterMs')
  expect(classifyHttp(422, '10', now)).not.toHaveProperty('retryAfterMs')
  expect(retryAt(new Date(now), 1, 0, () => 0)).toEqual(new Date(now + 4_000))
  expect(retryAt(new Date(now), 2, 20_000, () => 0.5)).toEqual(new Date(now + 20_000))
  expect(retryAt(new Date(now), 3, 300_000)).toBeNull()
})
